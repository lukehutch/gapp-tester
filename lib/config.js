/**
 * gapp.config.json, with defaults that fit an ordinary clasp project.
 *
 * Everything is optional. A project with src/ and test/ needs no config
 * file at all.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  src: 'src',
  serverFiles: null,        // null = every .js/.gs in src, alphabetically
  local: ['test'],          // files, or directories searched for *.test.js
  live: {
    entry: 'gappRunInGas',  // script function that runs the live suites
    push: true,             // clasp push before running
    clasp: 'clasp',         // command name, in case it is not on PATH
    user: null              // clasp named credential; null = clasp's "default"
  }
};

function load(dir, explicitPath) {
  const file = explicitPath
    ? path.resolve(explicitPath)
    : path.join(dir, 'gapp.config.json');

  let raw = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error('Could not parse ' + file + ': ' + e.message);
    }
  } else if (explicitPath) {
    throw new Error('No config file at ' + file);
  }

  const cfg = Object.assign({}, DEFAULTS, raw);
  cfg.live = Object.assign({}, DEFAULTS.live, raw.live);
  cfg.dir = dir;
  cfg.configFile = fs.existsSync(file) ? file : null;
  return cfg;
}

/** Turn the `local` entries into a concrete, ordered list of suite files. */
function localSuiteFiles(cfg) {
  const out = [];
  (cfg.local || []).forEach((entry) => {
    const p = path.resolve(cfg.dir, entry);
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) {
      fs.readdirSync(p).sort().forEach((f) => {
        if (/\.test\.js$/.test(f)) out.push(path.join(p, f));
      });
    } else {
      out.push(p);
    }
  });
  return out;
}

module.exports = { load, localSuiteFiles, DEFAULTS };
