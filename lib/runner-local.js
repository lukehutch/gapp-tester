/**
 * Local mode: the tests run here, against mocked services.
 *
 * A suite file exports one function and is handed the whole API:
 *
 *   module.exports = ({ suite, test, sandbox }) => {
 *     const sb = sandbox();                    // project files loaded
 *     suite('Unit conversion');
 *     test('an inch is 72 points', (t) => t.near(sb.toPt_(1, 'IN'), 72));
 *   };
 *
 * Registration happens when the file is required; nothing runs until every
 * file has been read, so a failure to load one suite does not half-run the
 * others.
 */
const path = require('path');
const core = require('../gas/GappTester.js');
const { sandbox } = require('./sandbox');
const { localSuiteFiles } = require('./config');

function runLocal(cfg, options) {
  options = options || {};
  const files = localSuiteFiles(cfg);
  core.gappReset();

  const api = {
    suite: core.suite,
    test: core.test,
    /** A sandbox with the project's own defaults already applied. */
    sandbox: (opts) => sandbox(Object.assign({
      dir: cfg.dir,
      src: cfg.src,
      files: cfg.serverFiles,
      quiet: true
    }, opts)),
    config: cfg
  };

  files.forEach((file) => {
    const mod = require(path.resolve(file));
    if (typeof mod !== 'function') {
      throw new Error(file + ' must export a function: module.exports = (api) => { … }');
    }
    core.suite('');
    mod(api);
  });

  const run = core.gappRun(options.filter);
  run.mode = 'local';
  run.files = files;
  return run;
}

module.exports = { runLocal };
