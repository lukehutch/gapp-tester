# gapp-tester

Tests for Google Apps Script projects — the same tests, run twice: locally
against mocked services, and inside Apps Script itself where the real ones
answer.

That split is the whole idea. Local tests are fast, offline and free, and
they can check every request your code builds — but they cannot tell you
whether Google *accepts* those requests. Only Google can. So gapp-tester
gives you one test format, one assertion set, one report format, and two
places to run them.

```bash
npm install --save-dev gapp-tester

npx gapp-test           # local suites: fast, offline, no quota
npx gapp-test live      # push with clasp, run inside Apps Script, print the report
npx gapp-test all       # local first; live only if local passed
```

Nothing to configure for an ordinary clasp project with `src/` and `test/`.

## A local suite

```js
// test/units.test.js
module.exports = ({ suite, test, sandbox }) => {
  const sb = sandbox();                 // your script files, in one shared scope

  suite('Units');
  test('an inch is 72 points', (t) => t.near(sb.toPt_(1, 'IN'), 72));

  suite('Requests');
  test('the margin request carries a field mask', (t) => {
    sb.widenMargins(36);
    const [payload] = sb.$.args('Docs.Documents.batchUpdate')[0];
    t.equal(payload.requests[0].updateDocumentStyle.fields, 'marginLeft');
  });
};
```

`sb` is the script's global scope: every top-level function in `src/` is on
it, exactly as Apps Script sees them. `sb.$` is the tester's side of the
glass — recorded calls, stubs, logs.

## A live suite

A live suite is an ordinary `.gs` file in `src/`, so `clasp push` sends it
with everything else:

```js
// src/LiveTests.js
suite('Runtime');

test('the Docs advanced service is enabled', function (t) {
  t.ok(typeof Docs !== 'undefined' && Docs.Documents,
    'enable the Docs advanced service in the editor');
});

test('the field mask we build is accepted', function (t) {
  var res = writeNamedStyle(currentNormalTextStyle());   // re-asserts existing values
  t.ok(res.applied > 0);
  t.comment(res.applied + ' request(s) accepted, document unchanged');
});
```

Run `gapp-test install` once to copy `GappTester.js` into `src/` (commit
it — it is what defines `suite`, `test` and the assertions inside Apps
Script), then:

```bash
npx gapp-test live
```

which pushes, calls one script function, and prints the TAP that comes back.

Write live tests that re-assert values the document already has. A passing
run then changes nothing, and a failing one is the interesting case.

## Assertions

The same object in both places.

| | |
|---|---|
| `t.ok(v, msg)` / `t.notOk(v, msg)` | truthiness |
| `t.equal(a, b, msg)` / `t.notEqual` | `===` |
| `t.deepEqual(a, b, msg)` | structural, key order ignored, array order kept |
| `t.near(a, b, epsilon, msg)` | floating point |
| `t.match(value, /re/, msg)` | regular expression |
| `t.throws(fn, /re/, msg)` | returns the error it caught |
| `t.fail(msg)` | unconditional |
| `t.comment(text)` | a note on the record; not a pass or a fail |

Deliberately small, and deliberately including `near` and `deepEqual`:
points-to-inches never lands exactly, and values built inside a Node VM
carry that realm's prototypes, so a prototype-sensitive comparison rejects
structures that match. `deepEqual` compares the data.

**A test that makes no assertion fails.** A test that cannot fail is not a
test, and the commonest way to write one by accident is to assert inside a
callback that never runs.

## What the sandbox gives you

| Service | Behaviour |
|---|---|
| `PropertiesService`, `CacheService` | really store, per scope |
| `Logger` | captured in `sb.$.logs`, not printed |
| `HtmlService` | reads your real `.html` files and expands `<?!= include('X') ?>` recursively |
| `LockService`, `Session`, `Utilities` | plausible values, no side effects |
| `UrlFetchApp` | **throws**, until you stub it — a local test that reaches the network is a test that depends on something it does not control |
| `DocumentApp`, `SpreadsheetApp`, `Docs`, `Drive`, `Gmail`, … | auto-mocked: every call recorded, every chain keeps chaining |

The auto-mock answers any path. `SpreadsheetApp.getActive().getSheetByName('x').getRange('A1')`
does not throw in a test that is not about spreadsheets, and
`DocumentApp.ElementType.TEXT` is `'TEXT'` without anyone enumerating Apps
Script's several hundred enum values — an ALL_CAPS member answers with its
own name.

```js
sb.$.args('Docs.Documents.batchUpdate')   // [[payload, docId], …]
sb.$.calls_for(path)                      // full records
sb.$.paths()                              // every path touched, deduped
sb.$.stub(path, fnOrValue)                // decide what a call returns
sb.$.logs                                 // Logger output
sb.$.reset()                              // forget calls and logs
sb.$.eval(code)                           // run more code in the same scope
```

When a recording mock is not enough — a test that drives a real text
selection, say — hand-write that one service and let the rest stay
auto-mocked:

```js
sandbox({ globals: { DocumentApp: myDocumentApp } })
```

## Configuration

`gapp.config.json` in the project root, all of it optional:

```json
{
  "src": "src",
  "serverFiles": ["Units.js", "Code.js"],
  "local": ["test"],
  "live": { "entry": "gappRunInGas", "push": true, "clasp": "clasp" }
}
```

- `serverFiles` sets the load order. Apps Script loads files alphabetically
  and hoists function declarations, so order rarely matters — but naming the
  files is also how you keep test-only files out of the sandbox.
- `local` takes files, or directories searched for `*.test.js`.
- `live.entry` is the script function that runs the live suites.

Options: `--dir`, `--config`, `--filter <text>`, `--tap`, `--dry-run`.

## Live mode requirements

These come from Google's Execution API (`scripts.run`), not from clasp, so
speaking to the API directly instead of shelling out would not remove one of
them. [Google's own list](https://developers.google.com/apps-script/api/how-tos/execute):

- the Apps Script API turned on at
  [script.google.com/home/usersettings](https://script.google.com/home/usersettings);
- the script linked to a **standard** Cloud project — "default projects
  created for Apps Script projects are insufficient";
- an OAuth client of type Desktop App **in that same Cloud project**, and
  `clasp login --creds client_secret.json --use-project-scopes`. The token
  must cover every scope the script declares, not only the ones the function
  you call happens to touch;
- the project deployed once as an API Executable. `devMode` — clasp's
  default, and what makes `gapp-test live` run the code you just pushed
  rather than the last deployed version — does not remove that;
- `clasp` installed and logged in, and a `.clasp.json` in the project.

That setup is the real cost of live mode, and it is one-time per project.

`gapp-test live --dry-run` prints the commands it would run without running
them.

**Live mode has not been exercised against a real script project by its
author** — `clasp` was not installed on the machine where it was written.
The local runner, the sandbox, the assertions, the TAP round trip and the
CLI all have tests. Live mode's command construction and TAP parsing have
tests; the round trip through Google does not. Treat the first
`gapp-test live` on your project as the thing that proves it.

## Why it looks like this

Everything here is a lesson from an existing tool, and the design is mostly
about which of their trade-offs to refuse.

**[clasp](https://github.com/google/clasp)** already solves getting code to
Google and calling a function there. Live mode shells out to it rather than
speaking to the Apps Script API itself.

The two calls involved are small — `projects.updateContent` for the push and
`scripts.run` for the call, one HTTP request each — so porting them was
considered and rejected. The reason is that the code is not the cost. The
cost is OAuth: an authorisation-code flow on a loopback port, a refresh-token
exchange, and a credential file on disk that has to be written with the right
permissions and kept out of git. clasp already does all of that, is Google's
own, and tracks the API when it moves. Reimplementing it would buy one saved
`npm i -g` and take on the one part of this whole design where a mistake has
consequences beyond a red test.

It costs nothing at install time either: clasp is invoked as a command, not
imported, so gapp-tester still has no npm dependencies. The command is
`clasp run-function --json`, and `--json` is why the return value comes back
as data rather than as text scraped out of spinner output.

**[QUnit](https://qunitjs.com/)** got the shape of an assertion object
right — a per-test handle, messages on every assertion, grouping by module.
gapp-tester borrows the shape and leaves the rest: QUnit is a browser test
framework, and its DOM reporter, lifecycle hooks and async plumbing are
weight an Apps Script project has no use for.

**[QUnitGS2](https://github.com/artofthesmart/QUnitGS2)** saw the real
problem — results have to escape the sandbox — and solved it by deploying a
web app you visit to read them. That works, and it costs a deployment, a
`doGet`, a URL and a browser round trip per run. Returning a string from the
function you already call is enough, so live mode does that.

**[GasT](https://github.com/huan/gast)** chose TAP, which is the right
answer: line-oriented, no escaping rules, readable by eye and by every CI,
and it survives being printed by a remote runtime and read back out of a
log. gapp-tester's wire format is TAP for exactly that reason. What it does
not copy is GasT's loader, which `eval`s a script fetched from raw
GitHub at runtime — remote code executing with your project's OAuth scopes.
gapp-tester has no dependencies and fetches nothing.

**[Aside](https://github.com/google/aside)** shows how good the local loop
can be: TypeScript, linting, Jest, CI, all off the shelf. The catch is that
it is a project scaffold — you get the loop by adopting its whole toolchain,
and the tests still never touch Google. gapp-tester adds itself to a project
that already exists, in plain JavaScript, and keeps the local loop *and* the
real one.

The two things none of them do: run the same test file in both places, and
fail a test that asserted nothing.

## Its own tests

```bash
npm test
```

`test/self-test.js` checks gapp-tester from the outside, with Node's
`assert` rather than with gapp-tester — a framework that reports on itself
with itself reports green when its reporting is what broke. It runs the CLI
end to end against `test/fixture/`, a small Apps Script project, and
includes tests that deliberately fail to prove failures are detected and
that the exit code follows.

## Licence

Apache 2.0.
