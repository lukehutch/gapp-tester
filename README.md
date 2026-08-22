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
  "live": {
    "entry": "gappRunInGas",
    "push": true,
    "clasp": "clasp",
    "user": null
  }
}
```

- `serverFiles` sets the load order. Apps Script loads files alphabetically
  and hoists function declarations, so order rarely matters — but naming the
  files is also how you keep test-only files out of the sandbox.
- `local` takes files, or directories searched for `*.test.js`.
- `live.entry` is the script function that runs the live suites.
- `live.push` set to `false` runs against whatever is already in the project.
- `live.clasp` is the command name, for a clasp that is not on `PATH`.
- `live.user` is the clasp named credential to use — see
  [Live mode setup](#live-mode-setup). `null` means clasp's `default` login,
  which is almost certainly not the one that can run functions.

Options: `--dir`, `--config`, `--filter <text>`, `--tap`, `--dry-run`.

## Live mode setup

**You may not need any of this.** Push the project and run the entry function
from the Apps Script editor — open the script, pick `gappRunInGas` in the
function list, press Run, read the TAP in the execution log:

```bash
gapp-test install      # copies GappTester.js into src/, once
clasp push
clasp open-script
```

That is the whole story if you just want to see the results. The setup below
buys one thing: the same report in your terminal and in CI, via `gapp-test
live`. It is one-time per script project, and every step is Google's
requirement for the Execution API (`scripts.run`), not clasp's —
[their list](https://developers.google.com/apps-script/api/how-tos/execute).
Writing our own HTTP client instead of shelling out to clasp would not remove
a single one.

### 1. clasp, and the Apps Script API

```bash
npm install -g @google/clasp
clasp login
```

Then turn the Apps Script API on for your account, once ever, at
[script.google.com/home/usersettings](https://script.google.com/home/usersettings).

This much already gives you `clasp push`. Everything below is only for
`scripts.run`.

### 2. A standard Cloud project, attached to the script

> "The Cloud project must be a standard Cloud project; default projects created
> for Apps Script projects are insufficient."

Create one in the [Cloud console](https://console.cloud.google.com/projectcreate)
and note its **project number** (not its id). Then:

```bash
clasp open-script
```

Project Settings → Google Cloud Platform (GCP) Project → Change project →
paste the project number → Set project.

Enable the Apps Script API inside *that* project too, at
`https://console.cloud.google.com/apis/library/script.googleapis.com?project=<PROJECT_ID>`
— or `clasp open-apis`, which opens the same console for the linked project.

(Not `clasp enable-api script`. That command only knows Apps Script *advanced
services*, and it works by editing `appsscript.json` — it would reject the name
and, for a name it did accept, would change your manifest rather than the Cloud
project.)

### 3. An OAuth client of your own, in that same project

The client and the script have to share the Cloud project, which is why
clasp's built-in client cannot be used here.

```bash
clasp open-credentials
```

Configure the consent screen if the console asks (internal is fine, and for a
personal Google account choose external and add yourself as a test user).
Then **Create credentials → OAuth client ID → Desktop app**, download the JSON,
and save it in the project as `client_secret.json`.

**Keep it out of git.** gapp-tester's `.gitignore` covers `client_secret*.json`;
if your project has its own, add it there.

### 4. Log in with it

```bash
clasp login --user gapp-tests \
            --creds client_secret.json \
            --use-project-scopes \
            --include-clasp-scopes
```

Three details in that command, each of which will cost you a debugging session
if dropped:

- **`--include-clasp-scopes` is not optional.** On its own,
  `--use-project-scopes` *replaces* clasp's scopes with your manifest's rather
  than adding to them (`buildScopes` in clasp's `src/commands/login.ts`). The
  token then lacks `script.projects`, and the `clasp push` that `gapp-test
  live` runs first fails — which reads like a push problem, not a login one.
- **`--use-project-scopes` is also not optional.** The token has to cover every
  scope your `appsscript.json` declares, not just the ones the function you
  call happens to touch.
- **`--user gapp-tests`** stores this as a *named* credential, leaving your
  everyday `clasp login` untouched. Any name will do; `default` overwrites the
  ordinary one, which you probably do not want.

Credentials land in `~/.clasprc.json`, not in your project.

If your manifest gains a scope later, run this command again — the token is
fixed at login time.

### 5. Point gapp-tester at that credential

```json
{
  "live": { "user": "gapp-tests" }
}
```

in `gapp.config.json`. Omit it and clasp's `default` login is used, which is
the one without the project scopes. gapp-tester passes `--user` to both the
push and the run.

### 6. Deploy once as an API Executable

`clasp open-script` → Deploy → New deployment → type ⚙ → **API Executable** →
Deploy.

Needed even though gapp-tester runs in devMode: devMode executes the code you
just pushed rather than the deployed version, but a deployment still has to
exist.

### 7. If it still says the API executable is not published

Add this to your `appsscript.json` and push again:

```json
"executionApi": { "access": "ANYONE" }
```

clasp's docs call for it; Google's page does not mention it, and the API
Executable deployment in step 6 normally sets it for you. Worth knowing about
when step 6 looks done and the error persists.

If you are building a Workspace add-on, take it back out before publishing —
`executionApi` is a permanent execution surface on your add-on, and a test
suite is a poor reason to ship one.

### Then

```bash
gapp-test live
gapp-test live --dry-run    # print the clasp commands without running them
```

### Known failures, and what they mean

| Message | Cause |
|---|---|
| `Script API executable not published/deployed` | Step 6 missing, or step 7 |
| `PERMISSION_DENIED` / `Request had insufficient authentication scopes` | Step 4 without `--use-project-scopes`, or the manifest gained a scope since you logged in |
| `clasp push` fails on a login that worked before | `--use-project-scopes` without `--include-clasp-scopes` |
| `User has not enabled the Apps Script API` | Step 1's usersettings toggle |
| Runs the old code | The credential is fine; you skipped `clasp push`, or `live.push` is `false` in the config |

**Live mode has not been exercised against a real script project by its
author** — `clasp` was not installed on the machine where it was written. The
local runner, the sandbox, the assertions, the TAP round trip and the CLI all
have tests. Live mode's command construction, its JSON handling and its TAP
parsing have tests; the round trip through Google does not. The setup above is
read out of clasp 3.4.0's source and Google's documentation, not out of a run
that succeeded. Treat your first `gapp-test live` as the thing that proves it.

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
