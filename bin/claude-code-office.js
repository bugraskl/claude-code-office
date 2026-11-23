#!/usr/bin/env node
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { startServer } = require('../src/server');
const pkg = require('../package.json');

const HELP = `
claude-code-office ${pkg.version}
A live 3D office for your Claude Code sessions and subagents.

Usage
  npx claude-code-office [options]

Options
  -p, --port <n>      Port to listen on (default 4777)
      --host <addr>   Interface to bind (default 127.0.0.1)
  -d, --dir <path>    Claude Code projects folder
                      (default $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects)
      --hide <regex>  Hide project folders matching this pattern (repeatable)
      --demo          Show a simulated office instead of your real sessions
      --no-open       Don't open the browser
  -v, --version       Print the version
  -h, --help          Show this help
`;

function parseArgs(argv) {
  const o = { port: Number(process.env.PORT) || 4777, host: process.env.HOST || '127.0.0.1', dir: null, hide: [], demo: false, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) { console.error(`Missing value for ${a}`); process.exit(2); }
      return v;
    };
    switch (a) {
      case '-p': case '--port': o.port = Number(next()); break;
      case '--host': o.host = next(); break;
      case '-d': case '--dir': o.dir = next(); break;
      case '--hide': o.hide.push(next()); break;
      case '--demo': o.demo = true; break;
      case '--open': o.open = true; break;
      case '--no-open': o.open = false; break;
      case '-v': case '--version': console.log(pkg.version); process.exit(0); break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default: console.error(`Unknown option: ${a}\n${HELP}`); process.exit(2);
    }
  }
  return o;
}

function defaultRoot() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* no browser available */ }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = path.resolve(o.dir || process.env.CLAUDE_PROJECTS || defaultRoot());
  // claude-mem runs its own background sessions; they are noise in an office view.
  const hide = [/claude-mem-observer/i, ...o.hide.map((h) => new RegExp(h, 'i'))];

  if (!o.demo && !fs.existsSync(root)) {
    console.warn(`! ${root} does not exist yet. Start a Claude Code session, or try --demo.`);
  }
  if (o.host !== '127.0.0.1' && o.host !== 'localhost' && o.host !== '::1') {
    console.warn('! Listening beyond localhost: anyone who can reach this port can read your prompts and tool calls.');
  }

  let server;
  try {
    server = await startServer({ port: o.port, host: o.host, root, hide, demo: o.demo });
  } catch (e) {
    if (e.code === 'EADDRINUSE') console.error(`Port ${o.port} is in use. Try --port ${o.port + 1}.`);
    else console.error(e.message);
    process.exit(1);
  }
  const shownHost = o.host === '0.0.0.0' || o.host === '::' ? 'localhost' : o.host;
  const url = `http://${shownHost.includes(':') ? `[${shownHost}]` : shownHost}:${server.address().port}`;
  console.log(`\n  Claude Code Office ${o.demo ? '(demo) ' : ''}→ ${url}`);
  if (!o.demo) console.log(`  reading ${root}`);
  console.log('  Ctrl+C to stop\n');
  if (o.open) openBrowser(url);
}

main();
