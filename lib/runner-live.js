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
 * Requirements. Every one of these is imposed by Google's Execution API
 * (scripts.run), not by clasp, so writing our own HTTP client instead of
 * shelling out would not remove a single one of them:
 *   - the Apps Script API turned on at script.google.com/home/usersettings;
 *   - the script linked to a *standard* GCP project -- the default project
 *     Apps Script creates for you is explicitly not enough;
 *   - an OAuth client of type Desktop App **in that same GCP project**, and
 *     `clasp login --creds client_secret.json --use-project-scopes`. The
 *     token has to cover every scope the script declares, not just the ones
 *     the called function touches;
 *   - the project deployed once as an API Executable. devMode (which is
 *     clasp's default) runs the latest saved code rather than the deployed
 *     version, but a deployment still has to exist.
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
  // --json is a global clasp flag: run-function then prints
  // {"response": <return value>, "error": ...} instead of the return value
  // wrapped in spinner output. Parsing that is far steadier than scraping.
  const runArgs = ['run-function', cfg.live.entry, '--json'];
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

  const run = parseTap(tapFrom(output));
  run.mode = 'live';
  run.raw = output;
  if (!run.results.length) {
    throw new Error('No TAP came back from ' + cfg.live.entry + '. Output was:\n' + output);
  }
  return run;
}

/**
 * Pull the script function's return value out of `clasp run-function --json`.
 *
 * Falls back to the raw text, because parseTap can find TAP in clasp's plain
 * output too. That covers a clasp too old for --json, and a clasp that prints
 * something non-JSON before the JSON. An execution error is raised here
 * rather than left to surface as "no TAP came back", which says nothing.
 */
function tapFrom(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (e) {
    return output;
  }
  if (parsed && parsed.error) {
    const d = (parsed.error.details && parsed.error.details[0]) || {};
    throw new Error('The script function threw inside Apps Script: ' +
      (d.errorMessage || parsed.error.message || JSON.stringify(parsed.error)) +
      (d.scriptStackTraceElements
        ? '\n' + d.scriptStackTraceElements
            .map((f) => '  at ' + f.function + ':' + f.lineNumber).join('\n')
        : ''));
  }
  if (parsed && typeof parsed.response === 'string') return parsed.response;
  return output;
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

module.exports = { runLive, parseTap, tapFrom };
