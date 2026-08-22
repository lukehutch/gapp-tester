/**
 * A Node stand-in for the Apps Script server runtime.
 *
 * Apps Script has no modules: every .gs file contributes its top-level
 * functions to one shared global scope, and the services are globals too.
 * A Node VM context reproduces that exactly -- which is why this is a
 * sandbox and not a bundler. Files are evaluated in order into one context,
 * so `Code.js` can call a function declared in `Units.js` with no imports,
 * the same way it does on Google's side.
 *
 * What it cannot do is tell you whether Google accepts a request. Nothing
 * running on your machine can. That is what live suites are for.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildServices } = require('./services');

/**
 * @param {object} opts
 *   dir       project root (default: cwd)
 *   src       directory holding the script files, relative to dir
 *   files     script file names in load order; default: every .js/.gs in src
 *   globals   extra or replacement globals (a hand-written DocumentApp, a
 *             fixture, anything the project's tests need)
 *   stubs     { 'Docs.Documents.get': fn } return values for mocked calls
 *   quiet     swallow console output from the script under test
 */
function sandbox(opts) {
  opts = opts || {};
  const dir = path.resolve(opts.dir || process.cwd());
  const srcDir = path.resolve(dir, opts.src || 'src');
  const files = opts.files && opts.files.length ? opts.files : defaultFiles(srcDir);

  const calls = [];
  const logs = [];
  const stubs = Object.assign({}, opts.stubs);
  const props = { script: {}, user: {}, document: {} };
  const cache = { script: {}, user: {}, document: {} };
  const record = (c) => { calls.push(c); };

  const services = buildServices({
    srcDir, record, stubs, logs, props, cache, overrides: opts.globals
  });

  const context = Object.assign({}, services);
  context.console = opts.quiet
    ? { log() {}, warn() {}, error() {}, info() {} }
    : console;
  context.global = context;
  context.globalThis = context;

  vm.createContext(context);

  const loaded = [];
  files.forEach((name) => {
    const file = path.resolve(srcDir, name);
    if (!fs.existsSync(file)) throw new Error('No such script file: ' + file);
    const code = fs.readFileSync(file, 'utf8');
    try {
      vm.runInContext(code, context, { filename: file });
    } catch (e) {
      e.message = 'While loading ' + name + ': ' + e.message;
      throw e;
    }
    loaded.push(name);
  });

  /** Tester-side handles, kept off the script's own namespace. */
  const $ = {
    dir, srcDir, files: loaded, logs, calls,
    properties: props,
    cacheStore: cache,

    /** Every recorded call to a mocked path, in order. */
    calls_for(callPath) { return calls.filter((c) => c.path === callPath); },
    lastCall(callPath) {
      const list = $.calls_for(callPath);
      return list.length ? list[list.length - 1] : null;
    },
    /** Arguments of every call to a path: [[arg0, arg1], …] */
    args(callPath) { return $.calls_for(callPath).map((c) => c.args); },
    /** Paths touched, deduped -- useful when a test does not know the shape yet. */
    paths() { return Array.from(new Set(calls.map((c) => c.path))); },

    stub(callPath, value) { stubs[callPath] = value; return $; },
    unstub(callPath) { delete stubs[callPath]; return $; },

    /** Forget recorded calls and logs; keeps stubs and loaded code. */
    reset() { calls.length = 0; logs.length = 0; return $; },

    /** Evaluate more code in the same context, e.g. a test helper. */
    eval(code, filename) { return vm.runInContext(code, context, { filename: filename || 'eval' }); }
  };
  Object.defineProperty(context, '$', { value: $, enumerable: false });

  return context;
}

function defaultFiles(srcDir) {
  return fs.readdirSync(srcDir)
    .filter((f) => /\.(js|gs)$/.test(f))
    .sort();
}

module.exports = { sandbox };
