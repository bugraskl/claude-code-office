'use strict';
// Reads Claude Code session transcripts and turns them into a small state object
// that the 3D office renders.
//
// Layout on disk (Claude Code 2.x):
//   <projects>/<project-dir>/<session-id>.jsonl                      main agent
//   <projects>/<project-dir>/<session-id>/subagents/agent-*.jsonl    subagents
//   <projects>/<project-dir>/<session-id>/subagents/agent-*.meta.json
//   <projects>/<project-dir>/<session-id>/subagents/workflows/<wf>/agent-*.jsonl
//
// Files are read incrementally: for every file we remember the last byte offset
// and only parse lines appended since the previous scan. Nothing is ever written.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  doneKeepMinutes: 20,   // finished subagents stay at their desk this long
  awayMinutes: 30,       // a main agent quiet this long is shown as "away"
  stuckMinutes: 15,      // a tool call without a result this long is "blocked"
  thinkingStaleMinutes: 10,
};

function newFileState() {
  return {
    offset: 0, rest: null, title: null, cwd: null, branch: null, model: null,
    prompt: null, brief: null, lastText: null, lastTs: 0, firstTs: 0, lastKind: null,
    pending: new Map(), history: [], plan: null, outTok: 0, ctx: 0, lastMsgId: null,
    toolCount: 0, errors: 0, seen: false,
  };
}

const clip = (s, n) => {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const baseName = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() || '' : '');

function shortToolName(name) {
  if (!name) return '?';
  if (name.startsWith('mcp__')) { const p = name.split('__'); return p[p.length - 1]; }
  return name;
}

function toolDetail(name, input) {
  const i = input || {};
  switch (shortToolName(name)) {
    case 'Bash': case 'PowerShell': return clip(i.description || i.command, 80);
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return baseName(i.file_path || i.notebook_path);
    case 'Grep': case 'Glob': return clip(i.pattern, 60);
    case 'Agent': case 'Task': return clip(i.description || i.prompt, 70);
    case 'WebFetch': try { return new URL(i.url).host; } catch { return ''; }
    case 'WebSearch': return clip(i.query, 60);
    case 'Skill': return clip(i.skill, 50);
    case 'TodoWrite': case 'update_plan': case 'wrap_up': return '';
    default: return clip(i.description || i.query || i.url || i.title || i.name || i.prompt, 60);
  }
}

// Rebuilds the task list from TodoWrite (CLI) or update_plan (desktop app) calls.
function applyPlan(st, name, input) {
  const n = shortToolName(name);
  const i = input || {};
  if (n === 'TodoWrite' && Array.isArray(i.todos)) {
    st.plan = i.todos.map((t) => ({ text: clip(t.content || t.activeForm, 90), status: t.status }));
    return;
  }
  if (n === 'wrap_up') { if (st.plan) st.plan.forEach((p) => { p.status = 'completed'; }); return; }
  if (n !== 'update_plan') return;
  if (Array.isArray(i.items)) { st.plan = i.items.map((t) => ({ text: clip(t.content, 90), status: t.status })); return; }
  if (!st.plan) return;
  if (i.advance) {
    const a = st.plan.findIndex((p) => p.status === 'in_progress');
    if (a >= 0) st.plan[a].status = 'completed';
    const b = st.plan.findIndex((p) => p.status === 'pending');
    if (b >= 0) st.plan[b].status = 'in_progress';
  }
  if (Array.isArray(i.done)) i.done.forEach((k) => { if (st.plan[k - 1]) st.plan[k - 1].status = 'completed'; });
  if (i.start && st.plan[i.start - 1]) st.plan[i.start - 1].status = 'in_progress';
}

function textParts(content) {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((x) => x && x.type === 'text' && x.text).map((x) => x.text);
}

// Large records we never need; skipping them before JSON.parse keeps scans cheap.
const SKIP_PREFIXES = ['{"type":"api-request', '{"type":"file-history', '{"type":"atis', '{"type":"queue-operation'];

function processLine(st, line) {
  if (line.length < 2 || SKIP_PREFIXES.some((p) => line.startsWith(p))) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  switch (o.type) {
    case 'custom-title': st.title = o.customTitle || st.title; return;
    case 'agent-name': if (!st.title) st.title = o.agentName; return;
    case 'summary': if (!st.title) st.title = o.summary; return;
    case 'last-prompt': st.prompt = clip(o.lastPrompt, 240); return;
    default: break;
  }
  const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
  if (ts) {
    if (!st.firstTs) st.firstTs = ts;
    if (ts > st.lastTs) st.lastTs = ts;
  }
  if (o.cwd) st.cwd = o.cwd;
  if (o.gitBranch) st.branch = o.gitBranch;

  if (o.type === 'assistant' && o.message) {
    const m = o.message;
    if (m.model && m.model !== '<synthetic>') st.model = m.model;
    // One API message is written as several lines (one per content block) sharing an id.
    if (m.id && m.id !== st.lastMsgId) {
      st.lastMsgId = m.id;
      const u = m.usage;
      if (u) {
        st.outTok += u.output_tokens || 0;
        st.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
    }
    for (const c of m.content || []) {
      if (!c) continue;
      if (c.type === 'thinking') st.lastKind = 'thinking';
      else if (c.type === 'text' && c.text && c.text.trim()) { st.lastText = clip(c.text, 420); st.lastKind = 'text'; }
      else if (c.type === 'tool_use') {
        const entry = { tool: shortToolName(c.name), detail: toolDetail(c.name, c.input), ts };
        st.pending.set(c.id, entry);
        st.toolCount++;
        st.history.push({ ...entry });
        if (st.history.length > 14) st.history.shift();
        st.lastKind = 'tool';
        applyPlan(st, c.name, c.input);
      }
    }
    if (m.stop_reason === 'end_turn') { st.lastKind = 'end'; st.pending.clear(); }
    return;
  }

  if (o.type === 'user' && o.message) {
    const c = o.message.content;
    let hadResult = false;
    if (Array.isArray(c)) {
      for (const x of c) {
        if (x && x.type === 'tool_result') {
          hadResult = true;
          st.pending.delete(x.tool_use_id);
          if (x.is_error) {
            st.errors++;
            const h = [...st.history].reverse().find((e) => !e.error);
            if (h) h.error = true;
          }
        }
      }
    }
    if (hadResult) { st.lastKind = 'result'; return; }
    if (o.isMeta) return;
    const text = textParts(c).join(' ').trim();
    if (!text) return;
    if (text.startsWith('<task-notification')) { st.lastKind = 'notification'; return; }
    if (text.startsWith('<')) return; // system reminders, command output
    if (!st.brief) st.brief = clip(text, 420);
    st.prompt = clip(text, 240);
    st.pending.clear(); // a new prompt interrupts whatever was running
    st.lastKind = 'prompt';
    return;
  }

  if (o.type === 'system' && o.subtype === 'stop_hook_summary') { st.lastKind = 'end'; st.pending.clear(); }
}

function deriveStatus(st, meta, isSub, now, mtime, opt) {
  const age = (now - Math.max(st.lastTs || 0, mtime || 0)) / 1000;
  if (meta && meta.finished) return 'done';
  if (st.pending.size) return age > opt.stuckMinutes * 60 ? 'blocked' : 'tool';
  if (st.lastKind === 'end') return isSub ? 'done' : (age > opt.awayMinutes * 60 ? 'away' : 'waiting');
  if (age > opt.thinkingStaleMinutes * 60) return isSub ? 'done' : 'away';
  return 'thinking';
}

function currentAction(st, status) {
  if (st.pending.size) {
    const p = [...st.pending.values()].pop();
    return { kind: 'tool', tool: p.tool, detail: p.detail, ts: p.ts };
  }
  if (status === 'thinking') return { kind: st.lastKind === 'notification' ? 'notification' : 'thinking', ts: st.lastTs };
  return null;
}

function agentView(st, status) {
  return {
    status,
    action: currentAction(st, status),
    model: st.model,
    lastText: st.lastText,
    history: st.history.slice(-10),
    outTok: st.outTok,
    ctx: st.ctx,
    toolCount: st.toolCount,
    errors: st.errors,
    lastTs: st.lastTs,
    startTs: st.firstTs,
  };
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function findSubagentFiles(dir, workflow, out) {
  for (const e of safeReaddir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'workflows') findSubagentFiles(p, null, out);
      else if (workflow === null && path.basename(dir) === 'workflows') findSubagentFiles(p, e.name, out);
      continue;
    }
    if (e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) out.push({ file: p, workflow: workflow || null });
  }
  return out;
}

function createScanner(options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const root = opt.root;
  const hide = opt.hide || [];
  const states = new Map();

  function readFile(file, size) {
    let st = states.get(file);
    if (!st || size < st.offset) { st = newFileState(); states.set(file, st); }
    st.seen = true;
    if (size === st.offset) return st;
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return st; }
    try {
      const CHUNK = 1 << 20;
      const buf = Buffer.allocUnsafe(CHUNK);
      while (st.offset < size) {
        const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - st.offset), st.offset);
        if (n <= 0) break;
        st.offset += n;
        let chunk = buf.subarray(0, n);
        if (st.rest && st.rest.length) chunk = Buffer.concat([st.rest, chunk]);
        // Split on the newline byte: it never occurs inside a UTF-8 multi-byte sequence.
        const last = chunk.lastIndexOf(10);
        if (last < 0) { st.rest = Buffer.from(chunk); continue; }
        st.rest = Buffer.from(chunk.subarray(last + 1));
        for (const line of chunk.subarray(0, last).toString('utf8').split('\n')) processLine(st, line);
      }
    } finally { fs.closeSync(fd); }
    return st;
  }

  function scan(hours = 3, now = Date.now()) {
    const since = now - hours * 3600e3;
    for (const st of states.values()) st.seen = false;
    const sessions = [];

    for (const dirent of safeReaddir(root)) {
      if (!dirent.isDirectory() || hide.some((r) => r.test(dirent.name))) continue;
      const projectDir = path.join(root, dirent.name);
      for (const f of safeReaddir(projectDir)) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const file = path.join(projectDir, f.name);
        let stat;
        try { stat = fs.statSync(file); } catch { continue; }
        const id = f.name.slice(0, -6);

        // Subagents can be busy even when the main transcript has been quiet for a while.
        const subagents = [];
        for (const s of findSubagentFiles(path.join(projectDir, id, 'subagents'), null, [])) {
          let ss;
          try { ss = fs.statSync(s.file); } catch { continue; }
          if (ss.mtimeMs < since) continue;
          let meta = null;
          try { meta = JSON.parse(fs.readFileSync(s.file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* none */ }
          const sst = readFile(s.file, ss.size);
          const status = deriveStatus(sst, meta, true, now, ss.mtimeMs, opt);
          if (status === 'done' && now - Math.max(sst.lastTs, ss.mtimeMs) > opt.doneKeepMinutes * 60e3) continue;
          subagents.push({
            id: path.basename(s.file, '.jsonl').replace(/^agent-/, ''),
            name: clip((meta && (meta.description || meta.agentType)) || 'subagent', 48),
            type: (meta && meta.agentType) || 'agent',
            phase: (meta && meta.workflowPhase) || null,
            workflow: s.workflow,
            background: !!(meta && meta.requestShape === 'background'),
            brief: sst.brief,
            ...agentView(sst, status),
          });
        }

        if (stat.mtimeMs < since && !subagents.length) continue;
        const st = readFile(file, stat.size);
        const status = deriveStatus(st, null, false, now, stat.mtimeMs, opt);
        subagents.sort((a, b) => (a.startTs || 0) - (b.startTs || 0));
        sessions.push({
          id,
          title: clip(st.title || st.prompt || '', 60),
          project: baseName(st.cwd) || dirent.name,
          cwd: st.cwd,
          branch: st.branch,
          prompt: st.prompt,
          plan: st.plan,
          ...agentView(st, status),
          subagents,
        });
      }
    }
    for (const [k, st] of states) if (!st.seen) states.delete(k);
    sessions.sort((a, b) => (a.startTs || 0) - (b.startTs || 0));
    return { now, hours, sessions };
  }

  return { scan };
}

module.exports = { createScanner, processLine, newFileState, deriveStatus, DEFAULTS };
