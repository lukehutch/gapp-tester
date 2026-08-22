/**
 * gapp-tester core.
 *
 * One file, ES5, no dependencies, and it runs unchanged in both places a
 * Google Apps Script project has to be tested:
 *
 *   - in Node, loaded by the local runner into a sandbox with the Google
 *     services mocked (fast, offline, no quota);
 *   - in Apps Script itself, pushed with the rest of the project and called
 *     as a script function, where the real services answer.
 *
 * Because it is the same file, a test written against it reads the same in
 * both places, and the report it produces is the same TAP either way.
 *
 * Apps Script has no module system, so the file defines plain globals. The
 * export tail at the bottom is invisible to Apps Script (`module` is not
 * defined there) and is how Node picks the same code up.
 */

/** All registered tests, in declaration order. */
var GAPP_TESTS = [];
var GAPP_SUITE = '';

/** Group the tests declared after it. Cosmetic; it only labels the report. */
function suite(name) {
  GAPP_SUITE = name || '';
}

/**
 * Register a test. `fn` is called with an assertion object and fails by
 * throwing -- from an assertion, or from the code under test.
 */
function test(name, fn) {
  GAPP_TESTS.push({ suite: GAPP_SUITE, name: name, fn: fn });
}

function gappReset() {
  GAPP_TESTS = [];
  GAPP_SUITE = '';
}

/* ------------------------------------------------------------------ *
 * Assertions
 *
 * Deliberately small. Every one of them takes an optional message and
 * throws a GappAssertion carrying what was expected and what arrived, so
 * the report can show both without the test having to spell them out.
 * ------------------------------------------------------------------ */

function GappAssertion(message) {
  this.name = 'GappAssertion';
  this.message = message;
}
GappAssertion.prototype = new Error();

/**
 * A stable serialisation: objects rebuilt with their keys in sorted order,
 * recursively. Without this, comparing two structures through JSON would
 * make { a: 1, b: 2 } differ from { b: 2, a: 1 }, which is not what any
 * test means by "deeply equal".
 */
function gappCanon_(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Object.prototype.toString.call(v) === '[object Array]') {
    var arr = [];
    for (var i = 0; i < v.length; i++) arr.push(gappCanon_(v[i]));
    return arr;
  }
  var keys = [];
  for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) keys.push(k);
  keys.sort();
  var out = {};
  for (var j = 0; j < keys.length; j++) out[keys[j]] = gappCanon_(v[keys[j]]);
  return out;
}

function gappShow_(v) {
  if (v === undefined) return 'undefined';
  try {
    var s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch (e) {
    return String(v);
  }
}

function gappFail_(message) {
  throw new GappAssertion(message);
}

/** The assertion object handed to every test. */
function gappAssert_(record) {
  function pass(label) { record({ ok: true, label: label }); }

  var t = {
    /** Notes on the record; TAP comments, no pass/fail meaning. */
    comment: function (text) { record({ comment: String(text) }); },

    ok: function (v, msg) {
      if (!v) gappFail_((msg || 'expected a truthy value') + ' — got ' + gappShow_(v));
      pass(msg || 'ok');
    },
    notOk: function (v, msg) {
      if (v) gappFail_((msg || 'expected a falsy value') + ' — got ' + gappShow_(v));
      pass(msg || 'notOk');
    },
    equal: function (actual, expected, msg) {
      if (actual !== expected) {
        gappFail_((msg || 'not equal') + ' — expected ' + gappShow_(expected) +
                  ', got ' + gappShow_(actual));
      }
      pass(msg || 'equal');
    },
    notEqual: function (actual, expected, msg) {
      if (actual === expected) {
        gappFail_((msg || 'unexpectedly equal') + ' — both ' + gappShow_(actual));
      }
      pass(msg || 'notEqual');
    },
    /**
     * Structural comparison through JSON.
     *
     * Not a convenience: values built inside a Node VM carry that realm's
     * prototypes, so a prototype-sensitive comparison rejects structures
     * that match. Comparing the serialised form compares the data, which
     * is what a test of an Apps Script payload is about.
     */
    deepEqual: function (actual, expected, msg) {
      var a = gappShow_(gappCanon_(actual)), b = gappShow_(gappCanon_(expected));
      if (a !== b) {
        gappFail_((msg || 'not deeply equal') + '\n    expected: ' + b + '\n    actual:   ' + a);
      }
      pass(msg || 'deepEqual');
    },
    /** Floating point, because points-to-inches never lands exactly. */
    near: function (actual, expected, epsilon, msg) {
      var eps = epsilon === undefined || epsilon === null ? 1e-9 : epsilon;
      if (!(Math.abs(actual - expected) <= eps)) {
        gappFail_((msg || 'not near enough') + ' — expected ' + expected +
                  ' ±' + eps + ', got ' + actual);
      }
      pass(msg || 'near');
    },
    match: function (value, re, msg) {
      if (!re.test(String(value))) {
        gappFail_((msg || 'no match') + ' — ' + gappShow_(String(value)) +
                  ' does not match ' + String(re));
      }
      pass(msg || 'match');
    },
    /** Asserts fn throws; `expected` may be a RegExp tested on the message. */
    throws: function (fn, expected, msg) {
      var threw = null;
      try { fn(); } catch (e) { threw = e; }
      if (!threw) gappFail_((msg || 'expected a throw') + ' — nothing was thrown');
      if (expected && expected.test && !expected.test(String(threw.message || threw))) {
        gappFail_((msg || 'wrong error') + ' — ' + gappShow_(String(threw.message || threw)) +
                  ' does not match ' + String(expected));
      }
      pass(msg || 'throws');
      return threw;
    },
    fail: function (msg) { gappFail_(msg || 'failed'); }
  };
  return t;
}

/* ------------------------------------------------------------------ *
 * Running
 * ------------------------------------------------------------------ */

/**
 * Run every registered test whose name matches `filter` (a string that must
 * appear in "suite name", or nothing for all of them).
 *
 * Returns { results, passed, failed } where each result is
 * { suite, name, ok, error, assertions, comments, ms }.
 */
function gappRun(filter) {
  var results = [];
  var passed = 0, failed = 0;

  for (var i = 0; i < GAPP_TESTS.length; i++) {
    var spec = GAPP_TESTS[i];
    var label = (spec.suite ? spec.suite + ' ' : '') + spec.name;
    if (filter && label.indexOf(filter) === -1) continue;

    var assertions = 0;
    var comments = [];
    var started = new Date().getTime();
    var t = gappAssert_(function (rec) {
      if (rec.comment !== undefined) comments.push(rec.comment);
      else assertions++;
    });

    var ok = true, error = null;
    try {
      spec.fn(t);
      if (assertions === 0) {
        ok = false;
        error = 'the test made no assertions — a test that cannot fail is not a test';
      }
    } catch (e) {
      ok = false;
      error = (e && (e.message || e.toString())) || String(e);
      if (e && e.stack && e.name !== 'GappAssertion') error += '\n' + e.stack;
    }

    if (ok) passed++; else failed++;
    results.push({
      suite: spec.suite, name: spec.name, ok: ok, error: error,
      assertions: assertions, comments: comments,
      ms: new Date().getTime() - started
    });
  }

  return { results: results, passed: passed, failed: failed };
}

/**
 * TAP 13. Chosen because it is the one test format that survives being
 * printed by a remote runtime and read back out of a log: line-oriented,
 * no escaping rules, parseable by eye and by every CI.
 */
function gappTap(run) {
  var lines = ['TAP version 13', '1..' + run.results.length];
  var lastSuite = null;
  for (var i = 0; i < run.results.length; i++) {
    var r = run.results[i];
    if (r.suite !== lastSuite) {
      if (r.suite) lines.push('# ' + r.suite);
      lastSuite = r.suite;
    }
    lines.push((r.ok ? 'ok ' : 'not ok ') + (i + 1) + ' - ' + r.name);
    for (var c = 0; c < r.comments.length; c++) lines.push('  # ' + r.comments[c]);
    if (!r.ok) {
      lines.push('  ---');
      var detail = String(r.error === null ? '' : r.error).split('\n');
      for (var d = 0; d < detail.length; d++) lines.push('  ' + (d === 0 ? 'message: ' : '  ') + detail[d]);
      lines.push('  ...');
    }
  }
  lines.push('# pass ' + run.passed);
  lines.push('# fail ' + run.failed);
  return lines.join('\n');
}

/**
 * The entry point to call inside Apps Script -- by hand from the editor, or
 * with `clasp run-function`. Returns TAP as a string so the caller sees the
 * whole report, and logs it too so it lands in the execution transcript
 * even when the call itself times out.
 */
function gappRunInGas(filter) {
  var run = gappRun(filter);
  var tap = gappTap(run);
  if (typeof Logger !== 'undefined') Logger.log(tap);
  return tap;
}

/* Node picks up the same file; Apps Script never sees this. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    suite: suite, test: test, gappReset: gappReset,
    gappRun: gappRun, gappTap: gappTap, gappAssert_: gappAssert_,
    tests: function () { return GAPP_TESTS; }
  };
}
