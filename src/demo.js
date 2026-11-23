'use strict';
// Synthetic office for `--demo`: a few made-up sessions whose agents cycle through
// every status, finish, and get replaced by new hires walking in. No real data is read.

const T0 = Date.now();

const TOOLS = [
  ['Read', 'src/router.ts'], ['Grep', 'useSession'], ['Edit', 'checkout.tsx'], ['Bash', 'Run unit tests'],
  ['Glob', '**/*.test.ts'], ['Bash', 'Install dependencies'], ['Write', 'migration_042.sql'], ['WebFetch', 'docs.stripe.com'],
  ['Read', 'README.md'], ['Edit', 'api/orders.py'], ['Bash', 'Build production bundle'], ['Grep', 'TODO'],
  ['Read', 'pyproject.toml'], ['Bash', 'Lint changed files'], ['Edit', 'styles.css'], ['WebSearch', 'pgvector index tuning'],
];

const SCENARIOS = [
  {
    title: 'Checkout redesign', project: 'web-shop', branch: 'feat/checkout', model: 'claude-opus-4-1',
    prompt: 'Redesign the checkout flow: single page, saved cards, better error states.',
    plan: ['Audit current checkout', 'Design single-page layout', 'Wire saved cards', 'Error and empty states', 'E2E tests', 'Ship behind a flag'],
    team: [
      { name: 'Audit payment errors', type: 'Explore' },
      { name: 'Build card picker', type: 'general-purpose' },
      { name: 'Write E2E tests', type: 'general-purpose' },
      { name: 'Review accessibility', type: 'general-purpose' },
      { name: 'Plan rollout', type: 'Plan' },
    ],
    main: 'lead',
  },
  {
    title: 'Migrate API to v2', project: 'api-gateway', branch: 'main', model: 'claude-sonnet-4-5',
    prompt: 'Move every endpoint to the v2 router and keep v1 responses byte-identical.',
    plan: ['Inventory endpoints', 'Port auth middleware', 'Port order endpoints', 'Contract tests'],
    team: [
      { name: 'Port order endpoints', type: 'general-purpose' },
      { name: 'Contract test sweep', type: 'workflow-subagent', phase: 'Verify' },
      { name: 'Find v1-only callers', type: 'Explore' },
    ],
    main: 'lead',
  },
  {
    title: 'Fix flaky nightly job', project: 'ml-pipeline', branch: 'fix/nightly', model: 'claude-sonnet-4-5',
    prompt: 'The nightly training job fails about once a week. Find out why.',
    plan: ['Collect failing runs', 'Reproduce locally', 'Fix and add a guard'],
    team: [],
    main: 'solo',
  },
  {
    title: 'Docs search', project: 'docs-site', branch: 'main', model: 'claude-haiku-4-5',
    prompt: 'Add full-text search to the docs site.',
    plan: ['Pick an index', 'Build the search page'],
    team: [{ name: 'Index build script', type: 'general-purpose' }],
    main: 'blocked',
  },
  {
    title: 'Release notes', project: 'mobile-app', branch: 'release/3.2', model: 'claude-opus-4-1',
    prompt: 'Draft the 3.2 release notes from merged PRs.',
    plan: null,
    team: [],
    main: 'away',
  },
];

const CYCLE = 75; // seconds a demo subagent lives before a replacement walks in

function history(seed, n, now) {
  const out = [];
  for (let i = n; i > 0; i--) {
    const [tool, detail] = TOOLS[(seed + i * 7) % TOOLS.length];
    out.push({ tool, detail, ts: now - i * 9000 - (seed % 5) * 1000, error: (seed + i) % 17 === 0 });
  }
  return out;
}

function agentStatus(phase) {
  if (phase < 0.08) return 'thinking';
  if (phase < 0.72) return Math.floor(phase * 40) % 4 === 3 ? 'thinking' : 'tool';
  return 'done';
}

function demoState(hours = 3, now = Date.now()) {
  const t = (now - T0) / 1000;
  const sessions = SCENARIOS.map((sc, si) => {
    const step = Math.floor(t / 4) + si * 3;
    const subagents = sc.team.map((m, ai) => {
      const offset = ai * 17 + si * 11;
      const generation = Math.floor((t + offset) / CYCLE);
      const phase = ((t + offset) % CYCLE) / CYCLE;
      const status = agentStatus(phase);
      const seed = si * 31 + ai * 13 + step;
      const [tool, detail] = TOOLS[seed % TOOLS.length];
      const born = now - phase * CYCLE * 1000;
      return {
        id: `demo-${si}-${ai}-${generation}`,
        name: m.name, type: m.type, phase: m.phase || null, workflow: m.phase ? 'wf_demo' : null, background: true,
        brief: `${m.name}. Report findings with file paths and keep changes minimal.`,
        status,
        action: status === 'tool' ? { kind: 'tool', tool, detail, ts: now - 2000 } : status === 'thinking' ? { kind: 'thinking', ts: now } : null,
        model: ai % 2 ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
        lastText: status === 'done' ? `Done: ${m.name.toLowerCase()}. 3 files changed, tests pass.` : `Looking at ${detail}…`,
        history: history(seed, 8, now),
        outTok: Math.round(phase * 18000), ctx: 22000 + Math.round(phase * 60000),
        toolCount: Math.round(phase * 40), errors: seed % 3 === 0 ? 1 : 0,
        lastTs: status === 'done' ? born + 0.72 * CYCLE * 1000 : now - 1500, startTs: born,
      };
    });

    let status;
    if (sc.main === 'blocked') status = 'blocked';
    else if (sc.main === 'away') status = 'away';
    else if (sc.main === 'solo') status = ['tool', 'tool', 'thinking', 'tool', 'waiting'][Math.floor(t / 6) % 5];
    else status = subagents.some((s) => s.status !== 'done') ? 'waiting' : 'tool';

    const [tool, detail] = TOOLS[(step + 5) % TOOLS.length];
    let plan = null;
    if (sc.plan) {
      const doneCount = Math.floor(t / 25 + si) % (sc.plan.length + 1);
      plan = sc.plan.map((text, i) => ({ text, status: i < doneCount ? 'completed' : i === doneCount ? 'in_progress' : 'pending' }));
    }
    const lastTs = status === 'away' ? now - 52 * 60e3 : status === 'blocked' ? now - 17 * 60e3 : now - 1200;
    return {
      id: `demo-session-${si}`,
      title: sc.title, project: sc.project, cwd: `~/code/${sc.project}`, branch: sc.branch, prompt: sc.prompt, plan,
      status,
      action: status === 'tool' ? { kind: 'tool', tool, detail, ts: now - 3000 }
        : status === 'blocked' ? { kind: 'tool', tool: 'Bash', detail: 'npm run build:search-index', ts: lastTs }
          : status === 'thinking' ? { kind: 'thinking', ts: now } : null,
      model: sc.model,
      lastText: status === 'waiting' ? `Started ${subagents.length} agents in the background. I'll summarise when they report back.` : `Checking ${detail}.`,
      history: history(si * 5 + step, 10, now),
      outTok: 40000 + si * 9000, ctx: 60000 + si * 15000, toolCount: 120 + si * 37, errors: si,
      lastTs, startTs: T0 - (si + 1) * 40 * 60e3,
      subagents,
    };
  });
  return { now, hours, demo: true, sessions };
}

module.exports = { demoState };
