/**
 * Mocks for the Google services an Apps Script project sees as globals.
 *
 * Two kinds:
 *
 *   - a handful with real behaviour, because tests depend on it:
 *     PropertiesService and CacheService actually store, Logger actually
 *     records, HtmlService actually reads and expands your template files.
 *   - everything else is auto-mocked by `recorder`, which answers any call
 *     on any path, records it, and returns something chainable -- so
 *     `SpreadsheetApp.getActive().getSheetByName('x').getRange('A1')`
 *     does not throw in a test that is not about spreadsheets.
 *
 * A test that cares what a service returns stubs the exact path:
 *   sb.$.stub('Docs.Documents.get', () => fixtureDoc)
 */
const fs = require('fs');
const path = require('path');

/** Service globals that get an auto-mock unless the project overrides them. */
const AUTO_MOCKED = [
  'AdminDirectory', 'Analytics', 'BigQuery', 'Browser', 'CalendarApp',
  'CardService', 'Charts', 'ContactsApp', 'ContentService', 'DataStudioApp',
  'Docs', 'DocumentApp', 'Drive', 'DriveApp', 'FormApp', 'GmailApp',
  'GroupsApp', 'Jdbc', 'LanguageApp', 'MailApp', 'Maps', 'People',
  'ScriptApp', 'Sheets', 'SitesApp', 'Slides', 'SlidesApp', 'SpreadsheetApp',
  'Tasks', 'XmlService'
];

/**
 * A proxy that answers every property access and every call.
 *
 * Calls are recorded as a dotted path, which is what a test asserts on.
 * An ALL_CAPS property is treated as an enum member and answers with its
 * own name, so `DocumentApp.ElementType.TEXT === 'TEXT'` without anyone
 * having to enumerate Apps Script's several hundred enum values.
 */
function recorder(root, record, stubs) {
  const cache = new Map();

  function node(nodePath) {
    if (cache.has(nodePath)) return cache.get(nodePath);

    const target = function (...args) {
      record({ path: nodePath, args: args });
      if (Object.prototype.hasOwnProperty.call(stubs, nodePath)) {
        const s = stubs[nodePath];
        return typeof s === 'function' ? s(...args) : s;
      }
      return node(nodePath + '()');
    };

    const proxy = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'symbol') return Reflect.get(t, prop);
        if (prop === '__path') return nodePath;
        if (prop === 'toJSON') return () => '[mock ' + nodePath + ']';
        if (prop === 'inspect' || prop === 'name') return nodePath;
        if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return prop;   // enum member
        return node(nodePath + '.' + prop);
      },
      has() { return true; }
    });

    cache.set(nodePath, proxy);
    return proxy;
  }

  return node(root);
}

/** getProperty/setProperty storage, shared shape for Properties and Cache. */
function keyValueStore(backing) {
  const store = {
    getProperty: (k) => (k in backing ? backing[k] : null),
    setProperty: (k, v) => { backing[k] = String(v); return store; },
    deleteProperty: (k) => { delete backing[k]; },
    getProperties: () => Object.assign({}, backing),
    setProperties: (obj) => { Object.keys(obj).forEach((k) => { backing[k] = String(obj[k]); }); },
    deleteAllProperties: () => { Object.keys(backing).forEach((k) => delete backing[k]); },
    getKeys: () => Object.keys(backing),
    // Cache flavour
    get: (k) => (k in backing ? backing[k] : null),
    put: (k, v) => { backing[k] = String(v); },
    remove: (k) => { delete backing[k]; },
    getAll: (keys) => {
      const out = {};
      keys.forEach((k) => { if (k in backing) out[k] = backing[k]; });
      return out;
    },
    putAll: (obj) => { Object.keys(obj).forEach((k) => { backing[k] = String(obj[k]); }); }
  };
  return store;
}

/**
 * HtmlService against the real files.
 *
 * `createTemplateFromFile('Sidebar').evaluate().getContent()` reads
 * src/Sidebar.html and expands `<?!= include('X') ?>` recursively, which is
 * the standard Apps Script include idiom. That makes "does the sidebar
 * still contain this control" a thing a local test can check.
 */
function htmlService(srcDir, record) {
  function readFile(name) {
    for (const ext of ['.html', '.htm']) {
      const p = path.join(srcDir, name + ext);
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    }
    throw new Error('No HTML file named "' + name + '" in ' + srcDir);
  }

  function expand(text, depth) {
    if (depth > 20) throw new Error('include() nested more than 20 deep — a template includes itself');
    return text.replace(/<\?!?=?\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g,
      (_, name) => expand(readFile(name), depth + 1));
  }

  function output(html) {
    const o = {
      getContent: () => html,
      getRawContent: () => html,
      setTitle: (t) => { o.__title = t; return o; },
      setWidth: (w) => { o.__width = w; return o; },
      setHeight: (h) => { o.__height = h; return o; },
      setXFrameOptionsMode: () => o,
      addMetaTag: () => o,
      append: (more) => { html += more; return o; },
      __isHtmlOutput: true
    };
    return o;
  }

  return {
    createHtmlOutput: (html) => output(String(html === undefined ? '' : html)),
    createHtmlOutputFromFile: (name) => output(expand(readFile(name), 0)),
    createTemplateFromFile: (name) => {
      const tpl = {
        evaluate: () => {
          record({ path: 'HtmlService.template.evaluate', args: [name] });
          return output(expand(readFile(name), 0));
        }
      };
      return tpl;
    },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    SandboxMode: { IFRAME: 'IFRAME' }
  };
}

/**
 * Build the global service objects for one sandbox.
 * `overrides` wins over everything, so a project can hand-write the one
 * service its tests actually exercise.
 */
function buildServices({ srcDir, record, stubs, logs, props, cache, overrides }) {
  const services = {};

  AUTO_MOCKED.forEach((name) => {
    services[name] = recorder(name, record, stubs);
  });

  services.Logger = {
    log: (...args) => {
      let msg;
      if (typeof args[0] === 'string' && /%s|%d/.test(args[0]) && args.length > 1) {
        const rest = args.slice(1);
        msg = args[0].replace(/%s|%d/g, () => String(rest.shift()));
      } else {
        msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      }
      logs.push(msg);
      return services.Logger;
    },
    clear: () => { logs.length = 0; },
    getLog: () => logs.join('\n')
  };

  services.PropertiesService = {
    getScriptProperties: () => keyValueStore(props.script),
    getUserProperties: () => keyValueStore(props.user),
    getDocumentProperties: () => keyValueStore(props.document)
  };

  services.CacheService = {
    getScriptCache: () => keyValueStore(cache.script),
    getUserCache: () => keyValueStore(cache.user),
    getDocumentCache: () => keyValueStore(cache.document)
  };

  services.LockService = {
    getScriptLock: () => lock(), getUserLock: () => lock(), getDocumentLock: () => lock()
  };
  function lock() {
    return { tryLock: () => true, waitLock: () => undefined, releaseLock: () => undefined, hasLock: () => true };
  }

  services.Session = {
    getActiveUser: () => ({ getEmail: () => 'test@example.com' }),
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }),
    getScriptTimeZone: () => 'Etc/GMT',
    getActiveUserLocale: () => 'en'
  };

  services.Utilities = {
    sleep: () => undefined,
    getUuid: () => 'uuid-' + (services.Utilities.__n = (services.Utilities.__n || 0) + 1),
    formatString: (fmt, ...args) => fmt.replace(/%s|%d/g, () => String(args.shift())),
    base64Encode: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
    base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
    newBlob: (content, type, name) => ({
      getDataAsString: () => String(content),
      getContentType: () => type || 'text/plain',
      getName: () => name || 'blob'
    })
  };

  // Deliberately fatal: a local test that reaches the network is a test
  // whose result depends on something it does not control.
  services.UrlFetchApp = {
    fetch: () => {
      throw new Error(
        'UrlFetchApp.fetch is not available in the local sandbox. ' +
        "Stub it: sb.$.stub('UrlFetchApp.fetch', () => ({ getContentText: () => '…' }))");
    },
    fetchAll: () => { throw new Error('UrlFetchApp.fetchAll is not available in the local sandbox.'); }
  };
  // A stub registered for either path takes over.
  ['UrlFetchApp.fetch', 'UrlFetchApp.fetchAll'].forEach((p) => {
    const real = services.UrlFetchApp[p.split('.')[1]];
    services.UrlFetchApp[p.split('.')[1]] = (...args) => {
      record({ path: p, args });
      if (Object.prototype.hasOwnProperty.call(stubs, p)) {
        const s = stubs[p];
        return typeof s === 'function' ? s(...args) : s;
      }
      return real(...args);
    };
  });

  services.HtmlService = htmlService(srcDir, record);

  Object.keys(overrides || {}).forEach((k) => { services[k] = overrides[k]; });
  return services;
}

module.exports = { buildServices, recorder, AUTO_MOCKED };
