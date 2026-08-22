/**
 * Live mode: the same tests run inside Apps Script, where the real services
 * answer.
 *
 * This is the half no local mock can replace. A field mask the Docs API
 * rejects, a scope you forgot to declare, an advanced service that is not
 * enabled -- none of that is visible until Google runs the code.
 *
 * How it works: your live suites are ordinary .gs files in the project's
 * src directory, so `clasp push` sends them along with everything else.
 * They register tests with the same `test()` the local suites use, because
 * GappTester.js is pushed too (run `gapp-test install` once). A single
 * script function -- gappRunInGas by default -- runs them and returns TAP,
 * and `clasp run-function` brings that string back to your terminal.
 *
 * Requirements, all of them Google's and none of them avoidable:
 *   - clasp installed and logged in;
 *   - the project linked to a standard GCP project;
 *   - the Apps Script API turned on at script.google.com/home/usersettings.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runLive(cfg, options) {
  options = options || {};
  const clasp = cfg.live.clasp || 'clasp';
  const steps = [];

  if (cfg.live.push !== false) {
    steps.push([clasp, ['push', '--force']]);
  }
  const runArgs = ['run-function', cfg.live.entry];
  if (options.filter) runArgs.push('--params', JSON.stringify([options.filter]));
  steps.push([clasp, runArgs]);

  if (options.dryRun) {
    return {
      mode: 'live', dryRun: true, results: [], passed: 0, failed: 0,
      commands: steps.map(([cmd, args]) => [cmd].concat(args).join(' '))
    };
  }

  if (!fs.existsSync(path.join(cfg.dir, '.clasp.json'))) {
    throw new Error('No .clasp.json in ' + cfg.dir +
      ' -- live mode needs a clasp project (clasp create, or clone an existing script).');
  }

  let output = '';
  steps.forEach(([cmd, args]) => {
    try {
      output = execFileSync(cmd, args, { cwd: cfg.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
      throw new Error('`' + [cmd].concat(args).join(' ') + '` failed:\n' + (detail || e.message));
    }
  });

  const run = parseTap(output);
  run.mode = 'live';
  run.raw = output;
  if (!run.results.length) {
    throw new Error('No TAP came back from ' + cfg.live.entry + '. Output was:\n' + output);
  }
  return run;
}

/**
 * Read TAP back out of whatever clasp printed around it.
 *
 * Line-oriented on purpose: clasp wraps the return value in its own
 * formatting, and a parser that ignores everything it does not recognise
 * survives that without caring which clasp version produced it.
 */
function parseTap(text) {
  const results = [];
  let suiteName = '';
  let current = null;
  let inYaml = false;

  String(text).split('\n').forEach((line) => {
    const l = line.replace(/\r$/, '');
    if (/^\s*---\s*$/.test(l)) { inYaml = true; return; }
    if (/^\s*\.\.\.\s*$/.test(l)) { inYaml = false; return; }
    if (inYaml && current) {
      current.error = (current.error ? current.error + '\n' : '') +
        l.replace(/^\s*(message:\s*)?/, '');
      return;
    }
    const m = /^\s*(not ok|ok)\s+(\d+)\s*-?\s*(.*)$/.exec(l);
    if (m) {
      current = {
        suite: suiteName, name: m[3].trim(), ok: m[1] === 'ok',
        error: null, assertions: 1, comments: [], ms: 0
      };
      results.push(current);
      return;
    }
    const s = /^\s*#\s+(.*)$/.exec(l);
    if (s && !/^(pass|fail|skip)\b/.test(s[1])) suiteName = s[1].trim();
  });

  return {
    results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length
  };
}

module.exports = { runLive, parseTap };
