/** Console rendering. TAP is the wire format; this is the readable one. */
const core = require('../gas/GappTester.js');

const ESC = String.fromCharCode(27);
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColour ? ESC + '[' + code + 'm' + s + ESC + '[0m' : s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const dim = (s) => paint('2', s);
const bold = (s) => paint('1', s);

function pretty(run) {
  const lines = [];
  let suiteName = null;
  run.results.forEach((r) => {
    if (r.suite !== suiteName) {
      suiteName = r.suite;
      if (suiteName) lines.push('', bold(suiteName));
    }
    if (r.ok) {
      lines.push('  ' + green('ok') + '   ' + r.name + (r.ms > 50 ? dim(' (' + r.ms + 'ms)') : ''));
    } else {
      lines.push('  ' + red('FAIL') + ' ' + r.name);
      String(r.error === null ? '' : r.error).split('\n').forEach((d) => {
        lines.push('       ' + dim(d));
      });
    }
    (r.comments || []).forEach((m) => lines.push('       ' + dim('# ' + m)));
  });

  const tally = run.passed + ' passed, ' + run.failed + ' failed';
  lines.push('', (run.failed ? red(tally) : green(tally)) + dim('  [' + run.mode + ']'));
  return lines.join('\n');
}

function tap(run) { return core.gappTap(run); }

module.exports = { pretty, tap };
