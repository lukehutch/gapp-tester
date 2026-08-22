/**
 * gapp-tester's own tests.
 *
 * Written with Node's assert rather than with gapp-tester, on purpose: a
 * framework that reports on itself with itself will report green when its
 * reporting is what broke. Everything here checks the framework from the
 * outside, and the last group deliberately breaks things to prove failures
 * are actually detected.
 *
 *   node test/self-test.js
 */
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const fixture = path.join(__dirname, 'fixture');
const core = require(path.join(root, 'gas', 'GappTester.js'));
const { sandbox } = require(path.join(root, 'lib', 'sandbox'));
const { parseTap, tapFrom } = require(path.join(root, 'lib', 'runner-live'));
const configLib = require(path.join(root, 'lib', 'config'));
const { runLocal } = require(path.join(root, 'lib', 'runner-local'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function group(name) { console.log('\n' + name); }

/* ------------------------------------------------------------------ */
group('Assertions');

function runOne(fn) {
  core.gappReset();
  core.test('x', fn);
  return core.gappRun().results[0];
}

t('a passing assertion passes', () => {
  assert.strictEqual(runOne((a) => a.equal(1, 1)).ok, true);
});

t('a failing assertion fails, and says what it expected', () => {
  const r = runOne((a) => a.equal(1, 2, 'sizes'));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /sizes/);
  assert.match(r.error, /expected 2, got 1/);
});

t('deepEqual compares structure, not prototypes', () => {
  const made = sandbox({ dir: fixture }).$.eval('({ a: [1, 2], b: { c: 3 } })');
  assert.strictEqual(runOne((a) => a.deepEqual(made, { a: [1, 2], b: { c: 3 } })).ok, true);
});

t('deepEqual does not care what order the keys were written in', () => {
  assert.strictEqual(runOne((a) => a.deepEqual({ b: 1, a: { d: 2, c: 3 } },
                                               { a: { c: 3, d: 2 }, b: 1 })).ok, true);
  assert.strictEqual(runOne((a) => a.deepEqual({ a: 1 }, { a: 2 })).ok, false);
  assert.strictEqual(runOne((a) => a.deepEqual([1, 2], [2, 1])).ok, false,
    'array order still matters');
});

t('near takes an epsilon', () => {
  assert.strictEqual(runOne((a) => a.near(1.0000001, 1, 1e-3)).ok, true);
  assert.strictEqual(runOne((a) => a.near(1.5, 1, 1e-3)).ok, false);
});

t('throws needs something to be thrown', () => {
  assert.strictEqual(runOne((a) => a.throws(() => { throw new Error('boom'); }, /boom/)).ok, true);
  assert.strictEqual(runOne((a) => a.throws(() => 1)).ok, false);
});

t('a test that asserts nothing is a failure, not a pass', () => {
  const r = runOne(() => { /* nothing */ });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no assertions/);
});

t('a throw from the code under test is a failure, not a crash', () => {
  const r = runOne(() => { null.x; });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.length > 0);
});

/* ------------------------------------------------------------------ */
group('Sandbox');

t('script files share one global scope, as they do in Apps Script', () => {
  const sb = sandbox({ dir: fixture });
  // widenMargins lives in Code.js and calls toPt_ from Units.js.
  assert.ok(typeof sb.widenMargins === 'function');
  assert.ok(typeof sb.toPt_ === 'function');
});

t('calls to mocked services are recorded with their arguments', () => {
  const sb = sandbox({ dir: fixture });
  sb.widenMargins(10);
  const args = sb.$.args('Docs.Documents.batchUpdate');
  assert.strictEqual(args.length, 1);
  assert.strictEqual(args[0][0].requests[0].updateDocumentStyle.fields, 'marginLeft');
});

t('a stub decides what a mocked call returns', () => {
  const sb = sandbox({ dir: fixture, stubs: { 'Docs.Documents.batchUpdate': () => ({ replies: [1] }) } });
  assert.deepStrictEqual(sb.widenMargins(10), { replies: [1] });
});

t('unstubbed chains keep chaining instead of throwing', () => {
  const sb = sandbox({ dir: fixture });
  const v = sb.$.eval('SpreadsheetApp.getActive().getSheetByName("s").getRange("A1").getValue()');
  assert.notStrictEqual(v, undefined);
});

t('ALL_CAPS members answer as enum values', () => {
  const sb = sandbox({ dir: fixture });
  assert.strictEqual(sb.$.eval('DocumentApp.ElementType.TEXT'), 'TEXT');
  assert.strictEqual(sb.$.eval('DocumentApp.Attribute.FONT_SIZE'), 'FONT_SIZE');
});

t('properties and cache actually store and delete', () => {
  const sb = sandbox({ dir: fixture });
  sb.saveUnit('MM');
  assert.strictEqual(sb.readUnit(), 'MM');
  sb.$.eval('PropertiesService.getUserProperties().deleteProperty("unit")');
  assert.strictEqual(sb.readUnit(), null);
});

t('HtmlService reads real files and expands include()', () => {
  const sb = sandbox({ dir: fixture });
  assert.match(sb.showSidebar(), /id="root"[\s\S]*id="part"/);
});

t('Logger is captured rather than printed', () => {
  const sb = sandbox({ dir: fixture });
  sb.$.eval('Logger.log("hello %s", "world")');
  assert.deepStrictEqual(sb.$.logs, ['hello world']);
});

t('UrlFetchApp refuses to reach the network unless stubbed', () => {
  const sb = sandbox({ dir: fixture });
  assert.throws(() => sb.$.eval('UrlFetchApp.fetch("https://example.com")'), /not available in the local sandbox/);
  sb.$.stub('UrlFetchApp.fetch', () => ({ getContentText: () => 'ok' }));
  assert.strictEqual(sb.$.eval('UrlFetchApp.fetch("https://example.com").getContentText()'), 'ok');
});

t('a project can hand-write the service its tests care about', () => {
  const sb = sandbox({ dir: fixture, globals: { DocumentApp: { getActiveDocument: () => ({ getId: () => 'REAL_ID' }) } } });
  sb.$.stub('Docs.Documents.batchUpdate', (payload, id) => id);
  assert.strictEqual(sb.widenMargins(1), 'REAL_ID');
});

t('a syntax error names the file it came from', () => {
  const fs = require('fs'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gapp-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'Bad.js'), 'function (){');
  assert.throws(() => sandbox({ dir }), /While loading Bad\.js/);
});

/* ------------------------------------------------------------------ */
group('TAP');

t('the report is TAP 13 with a plan and a tally', () => {
  core.gappReset();
  core.suite('Group');
  core.test('one', (a) => a.ok(true));
  core.test('two', (a) => a.fail('nope'));
  const tap = core.gappTap(core.gappRun());
  assert.match(tap, /^TAP version 13\n1\.\.2\n/);
  assert.match(tap, /# Group/);
  assert.match(tap, /ok 1 - one/);
  assert.match(tap, /not ok 2 - two/);
  assert.match(tap, /# pass 1/);
  assert.match(tap, /# fail 1/);
});

t('TAP survives a round trip through the live-mode parser', () => {
  core.gappReset();
  core.suite('Group');
  core.test('one', (a) => a.ok(true));
  core.test('two', (a) => a.fail('nope'));
  const back = parseTap(core.gappTap(core.gappRun()));
  assert.strictEqual(back.passed, 1);
  assert.strictEqual(back.failed, 1);
  assert.strictEqual(back.results[0].suite, 'Group');
  assert.strictEqual(back.results[1].name, 'two');
  assert.match(back.results[1].error, /nope/);
});

t('the parser ignores whatever clasp prints around the TAP', () => {
  const back = parseTap([
    'Running function…', 'TAP version 13', '1..1', 'ok 1 - fine', '# pass 1', '# fail 0', 'Done.'
  ].join('\n'));
  assert.strictEqual(back.results.length, 1);
  assert.strictEqual(back.passed, 1);
});

t('the return value is taken from clasp --json, not scraped', () => {
  const tap = 'TAP version 13\n1..1\nok 1 - fine\n';
  assert.strictEqual(tapFrom(JSON.stringify({ response: tap })), tap);
});

t('output that is not JSON is passed through for scraping', () => {
  assert.match(tapFrom('Running…\nok 1 - fine\n'), /ok 1 - fine/);
});

t('a script exception is reported with its message and stack', () => {
  assert.throws(
    () => tapFrom(JSON.stringify({
      error: {
        message: 'wrapped',
        details: [{
          errorMessage: 'Docs is not defined',
          scriptStackTraceElements: [{ function: 'gappRunInGas', lineNumber: 12 }]
        }]
      }
    })),
    /Docs is not defined[\s\S]*at gappRunInGas:12/
  );
});

/* ------------------------------------------------------------------ */
group('Config and runner');

t('a project with no config file still runs', () => {
  const cfg = configLib.load(fixture);
  assert.strictEqual(cfg.configFile, null);
  const run = runLocal(cfg, {});
  assert.strictEqual(run.failed, 0);
  assert.ok(run.passed >= 4);
});

t('--filter selects by suite and name', () => {
  const run = runLocal(configLib.load(fixture), { filter: 'Units' });
  assert.strictEqual(run.results.length, 2);
});

t('a suite file that does not export a function says so', () => {
  const fs = require('fs'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gapp-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'src', 'A.js'), 'function a(){}');
  fs.writeFileSync(path.join(dir, 'test', 'x.test.js'), 'module.exports = 42;');
  assert.throws(() => runLocal(configLib.load(dir), {}), /must export a function/);
});

/* ------------------------------------------------------------------ */
group('The CLI, end to end');

function cli(args, opts) {
  return execFileSync(process.execPath,
    [path.join(root, 'bin', 'gapp-test.js')].concat(args),
    Object.assign({ encoding: 'utf8', env: Object.assign({}, process.env, { NO_COLOR: '1' }) }, opts));
}

t('a passing project exits 0 and prints the tally', () => {
  const out = cli(['--dir', fixture]);
  assert.match(out, /4 passed, 0 failed/);
});

t('--tap prints machine-readable output', () => {
  const out = cli(['--dir', fixture, '--tap']);
  assert.match(out, /^TAP version 13/);
});

t('a failing test exits 1', () => {
  const fs = require('fs'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gapp-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'src', 'A.js'), 'function a(){ return 1 }');
  fs.writeFileSync(path.join(dir, 'test', 'x.test.js'),
    'module.exports = ({ test, sandbox }) => { const sb = sandbox();' +
    ' test("wrong", (t) => t.equal(sb.a(), 2)); };');
  let code = 0;
  try { cli(['--dir', dir]); } catch (e) { code = e.status; }
  assert.strictEqual(code, 1);
});

t('live mode without clasp does not pretend to have run', () => {
  let err = '';
  try { cli(['live', '--dir', fixture], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr || ''); }
  assert.ok(/No \.clasp\.json|clasp/.test(err), 'expected a clasp-related message, got: ' + err);
});

t('live --dry-run shows the commands it would run', () => {
  const out = cli(['live', '--dir', fixture, '--dry-run']);
  assert.match(out, /clasp push/);
  assert.match(out, /clasp run-function gappRunInGas/);
});

t('install puts the core where clasp will push it', () => {
  const fs = require('fs'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gapp-'));
  fs.mkdirSync(path.join(dir, 'src'));
  cli(['install', '--dir', dir]);
  const written = fs.readFileSync(path.join(dir, 'src', 'GappTester.js'), 'utf8');
  assert.match(written, /function gappRunInGas/);
});

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
