'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createScanner } = require('../src/transcripts');

const NOW = Date.parse('2026-01-10T12:00:00.000Z');
const iso = (secondsAgo) => new Date(NOW - secondsAgo * 1000).toISOString();

// Minimal transcript records in the shape Claude Code writes them.
const rec = {
  title: (t) => ({ type: 'custom-title', customTitle: t, sessionId: 's' }),
  prompt: (text, ago) => ({ type: 'user', timestamp: iso(ago), cwd: '/home/dev/web-shop', gitBranch: 'main', message: { role: 'user', content: text } }),
  toolUse: (id, name, input, ago, msgId = `m-${id}`) => ({
    type: 'assistant', timestamp: iso(ago),
    message: { id: msgId, model: 'claude-sonnet-4-5', role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { output_tokens: 10, input_tokens: 5, cache_read_input_tokens: 100 } },
  }),
  result: (id, ago, isError = false) => ({ type: 'user', timestamp: iso(ago), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] } }),
  text: (text, ago, stop = 'end_turn') => ({
    type: 'assistant', timestamp: iso(ago),
    message: { id: `t-${ago}`, model: 'claude-sonnet-4-5', role: 'assistant', content: [{ type: 'text', text }], stop_reason: stop, usage: { output_tokens: 20 } },
  }),
  thinking: (ago) => ({ type: 'assistant', timestamp: iso(ago), message: { id: `th-${ago}`, role: 'assistant', content: [{ type: 'thinking', thinking: '' }], stop_reason: null } }),
};

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cco-'));
  const project = path.join(root, '-home-dev-web-shop');
  fs.mkdirSync(project);
  const write = (rel, records, mtimeAgo = 1) => {
    const file = path.join(project, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const t = new Date(NOW - mtimeAgo * 1000);
    fs.utimesSync(file, t, t);
    return file;
  };
  const append = (file, records, mtimeAgo = 1) => {
    fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const t = new Date(NOW - mtimeAgo * 1000);
    fs.utimesSync(file, t, t);
  };
  return { root, project, write, append };
}

test('a pending tool call means the agent is working', () => {
  const { root, write } = setup();
  write('s1.jsonl', [rec.title('Checkout'), rec.prompt('Fix checkout', 30), rec.toolUse('a', 'Bash', { description: 'Run tests', command: 'npm test' }, 5)]);
  const s = createScanner({ root }).scan(3, NOW).sessions[0];
  assert.equal(s.title, 'Checkout');
  assert.equal(s.project, 'web-shop');
  assert.equal(s.branch, 'main');
  assert.equal(s.status, 'tool');
  assert.deepEqual([s.action.tool, s.action.detail], ['Bash', 'Run tests']);
  assert.equal(s.model, 'claude-sonnet-4-5');
  assert.equal(s.ctx, 105);
});

test('end of turn means waiting for the user, then away after 30 minutes', () => {
  const { root, write } = setup();
  write('s1.jsonl', [rec.prompt('hi', 60), rec.toolUse('a', 'Read', { file_path: '/x/y/app.ts' }, 50), rec.result('a', 49), rec.text('Done.', 48)], 48);
  const scanner = createScanner({ root });
  const s = scanner.scan(3, NOW).sessions[0];
  assert.equal(s.status, 'waiting');
  assert.equal(s.lastText, 'Done.');
  assert.equal(s.history[0].detail, 'app.ts');
  assert.equal(scanner.scan(3, NOW + 31 * 60e3).sessions[0].status, 'away');
});

test('a tool call without a result for 15 minutes is shown as blocked', () => {
  const { root, write } = setup();
  write('s1.jsonl', [rec.prompt('build', 20 * 60), rec.toolUse('a', 'Bash', { command: 'make' }, 16 * 60)], 16 * 60);
  assert.equal(createScanner({ root }).scan(3, NOW).sessions[0].status, 'blocked');
});

test('thinking after a tool result; a new prompt clears interrupted tool calls', () => {
  const { root, write, append } = setup();
  const f = write('s1.jsonl', [rec.prompt('go', 30), rec.toolUse('a', 'Grep', { pattern: 'TODO' }, 20), rec.result('a', 10, true)]);
  const scanner = createScanner({ root });
  let s = scanner.scan(3, NOW).sessions[0];
  assert.equal(s.status, 'thinking');
  assert.equal(s.errors, 1);
  assert.equal(s.history[0].error, true);
  append(f, [rec.toolUse('b', 'Bash', { command: 'sleep 99' }, 8), rec.prompt('stop, do something else', 2)]);
  s = scanner.scan(3, NOW).sessions[0];
  assert.equal(s.status, 'thinking');
  assert.equal(s.prompt, 'stop, do something else');
});

test('files are read incrementally, including lines split across writes', () => {
  const { root, write, project } = setup();
  const f = write('s1.jsonl', [rec.prompt('go', 30)]);
  const scanner = createScanner({ root });
  assert.equal(scanner.scan(3, NOW).sessions[0].status, 'thinking');
  const line = JSON.stringify(rec.toolUse('a', 'Edit', { file_path: 'ünïcödé.ts' }, 3));
  const cut = Buffer.from(line).length - 7; // split in the middle of the record
  const bytes = Buffer.from(line + '\n');
  fs.appendFileSync(f, bytes.subarray(0, cut));
  assert.equal(scanner.scan(3, NOW).sessions[0].status, 'thinking');
  fs.appendFileSync(f, bytes.subarray(cut));
  const s = scanner.scan(3, NOW).sessions[0];
  assert.equal(s.status, 'tool');
  assert.equal(s.action.detail, 'ünïcödé.ts');
  assert.ok(project);
});

test('subagents: meta, finished flag, workflows and the done window', () => {
  const { root, write } = setup();
  write('s1.jsonl', [rec.prompt('team work', 100), rec.text('Started agents.', 90)]);
  write('s1/subagents/agent-a1.jsonl', [rec.prompt('Audit the API', 60), rec.toolUse('x', 'Glob', { pattern: '**/*.ts' }, 3)]);
  write('s1/subagents/agent-a1.meta.json', [{ agentType: 'Explore', description: 'Audit API', requestShape: 'background' }]);
  write('s1/subagents/agent-a2.jsonl', [rec.prompt('Write docs', 60), rec.text('Docs written.', 40)]);
  write('s1/subagents/agent-a2.meta.json', [{ agentType: 'general-purpose', description: 'Write docs', finished: true }]);
  write('s1/subagents/workflows/wf_1/agent-a3.jsonl', [rec.prompt('verify', 30), rec.thinking(2)]);
  write('s1/subagents/workflows/wf_1/agent-a3.meta.json', [{ agentType: 'workflow-subagent', description: 'verify:web', workflowPhase: 'Verify' }]);
  write('s1/subagents/agent-old.jsonl', [rec.prompt('old', 3600), rec.text('done long ago', 3500)], 3500);

  const s = createScanner({ root }).scan(3, NOW).sessions[0];
  assert.equal(s.status, 'waiting');
  const byId = Object.fromEntries(s.subagents.map((a) => [a.id, a]));
  assert.deepEqual(Object.keys(byId).sort(), ['a1', 'a2', 'a3']); // finished an hour ago: left the office
  assert.equal(byId.a1.status, 'tool');
  assert.equal(byId.a1.name, 'Audit API');
  assert.equal(byId.a1.type, 'Explore');
  assert.equal(byId.a1.background, true);
  assert.equal(byId.a1.brief, 'Audit the API');
  assert.equal(byId.a2.status, 'done');
  assert.equal(byId.a3.status, 'thinking');
  assert.equal(byId.a3.workflow, 'wf_1');
  assert.equal(byId.a3.phase, 'Verify');
});

test('task list is rebuilt from update_plan and TodoWrite', () => {
  const { root, write } = setup();
  const plan = (input, ago, id) => rec.toolUse(id, 'mcp__ccd_turn__update_plan', input, ago);
  write('s1.jsonl', [
    rec.prompt('go', 100),
    plan({ items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }, { content: 'C', status: 'pending' }] }, 90, 'p1'),
    plan({ advance: true }, 80, 'p2'),
    plan({ done: [2], start: 3 }, 70, 'p3'),
  ]);
  write('s2.jsonl', [rec.prompt('cli', 100), rec.toolUse('t', 'TodoWrite', { todos: [{ content: 'X', status: 'completed' }, { content: 'Y', status: 'in_progress' }] }, 50)]);
  const sessions = createScanner({ root }).scan(3, NOW).sessions;
  const s1 = sessions.find((s) => s.id === 's1');
  const s2 = sessions.find((s) => s.id === 's2');
  assert.deepEqual(s1.plan.map((p) => p.status), ['completed', 'completed', 'in_progress']);
  assert.deepEqual(s2.plan.map((p) => p.text), ['X', 'Y']);
});

test('time window and hidden projects', () => {
  const { root, write } = setup();
  write('old.jsonl', [rec.prompt('old', 5 * 3600)], 5 * 3600);
  fs.mkdirSync(path.join(root, 'hidden-project'));
  fs.writeFileSync(path.join(root, 'hidden-project', 'h.jsonl'), JSON.stringify(rec.prompt('x', 5)) + '\n');
  const scanner = createScanner({ root, hide: [/hidden/] });
  assert.equal(scanner.scan(3, NOW).sessions.length, 0);
  assert.equal(scanner.scan(6, NOW).sessions.length, 1);
});

test('usage is counted once per API message even when split over several lines', () => {
  const { root, write } = setup();
  write('s1.jsonl', [rec.prompt('go', 30), rec.toolUse('a', 'Read', { file_path: 'a' }, 20, 'same'), rec.toolUse('b', 'Read', { file_path: 'b' }, 20, 'same')]);
  const s = createScanner({ root }).scan(3, NOW).sessions[0];
  assert.equal(s.outTok, 10);
  assert.equal(s.toolCount, 2);
});
