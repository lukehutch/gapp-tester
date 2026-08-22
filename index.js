/**
 * gapp-tester: tests for Google Apps Script projects, run locally against
 * mocked services and inside the real runtime, from one set of tests.
 */
const { sandbox } = require('./lib/sandbox');
const { runLocal } = require('./lib/runner-local');
const { runLive, parseTap } = require('./lib/runner-live');
const config = require('./lib/config');
const report = require('./lib/report');
const core = require('./gas/GappTester.js');

module.exports = {
  sandbox, runLocal, runLive, parseTap, config, report,
  suite: core.suite, test: core.test, gappRun: core.gappRun, gappTap: core.gappTap
};
