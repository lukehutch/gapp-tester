#!/usr/bin/env node
/**
 * gapp-test — run an Apps Script project's tests.
 *
 *   gapp-test              local suites (the default: fast, offline)
 *   gapp-test live         push and run the live suites inside Apps Script
 *   gapp-test all          local first; live only if local passed
 *   gapp-test install      copy GappTester.js into the project's src dir
 *
 * Options
 *   --dir <path>       project root (default: the working directory)
 *   --config <file>    config file (default: <dir>/gapp.config.json)
 *   --filter <text>    only tests whose "suite name" contains this
 *   --tap              raw TAP instead of the readable report
 *   --dry-run          with `live`, print the clasp commands and stop
 */
const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const { runLocal } = require('../lib/runner-local');
const { runLive } = require('../lib/runner-live');
const report = require('../lib/report');

function parseArgs(argv) {
  const opts = { mode: 'local', dir: process.cwd() };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--config') opts.config = argv[++i];
    else if (a === '--filter') opts.filter = argv[++i];
    else if (a === '--tap') opts.tap = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else rest.push(a);
  }
  if (rest.length) opts.mode = rest[0];
  opts.dir = path.resolve(opts.dir);
  return opts;
}

function usage() {
  const lines = [];
  for (const line of fs.readFileSync(__filename, 'utf8').split('\n').slice(2)) {
    if (/^\s*\*\//.test(line)) break;
    lines.push(line.replace(/^ \* ?/, ''));
  }
  console.log(lines.join('\n'));
}

/** Put the shared core where clasp will push it. */
function install(cfg) {
  const target = path.resolve(cfg.dir, cfg.src, 'GappTester.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'gas', 'GappTester.js'), target);
  console.log('Wrote ' + path.relative(cfg.dir, target) +
    '\nCommit it: clasp pushes everything in ' + cfg.src + ', and the live suites need it.');
}

function emit(run, opts) {
  console.log(opts.tap ? report.tap(run) : report.pretty(run));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage();

  if (!['local', 'live', 'all', 'install'].includes(opts.mode)) {
    console.error('Unknown mode "' + opts.mode + '".');
    usage();
    process.exitCode = 2;
    return;
  }

  const cfg = config.load(opts.dir, opts.config);

  if (opts.mode === 'install') return install(cfg);

  let failed = 0;

  if (opts.mode === 'local' || opts.mode === 'all') {
    const run = runLocal(cfg, opts);
    if (!run.results.length) {
      console.error('No local tests found. Looked in: ' + (cfg.local || []).join(', '));
      process.exitCode = 1;
      return;
    }
    emit(run, opts);
    failed += run.failed;
  }

  if (opts.mode === 'live' || (opts.mode === 'all' && failed === 0)) {
    const run = runLive(cfg, opts);
    if (run.dryRun) {
      console.log('Would run:\n  ' + run.commands.join('\n  '));
      return;
    }
    emit(run, opts);
    failed += run.failed;
  } else if (opts.mode === 'all' && failed !== 0) {
    console.log('\nSkipping the live suites: the local ones have to pass first.');
  }

  process.exitCode = failed ? 1 : 0;
}

try {
  main();
} catch (e) {
  console.error(String((e && e.message) || e));
  process.exitCode = 2;
}
