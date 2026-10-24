'use strict';

// Convert a Selenium IDE project (.side, plain JSON) into SKILL.md.
//
// Same reasoning as the Chrome Recorder converter: the expensive part of authoring a skill is
// recording the workflow, and Selenium IDE users already did it. A .side project holds one or more
// tests, each a list of Selenese commands { command, target, targets, value }.
//
// Locators are prefixed by strategy: id=, name=, css=, xpath=, linkText=, partialLinkText=.
// linkText and name read like something a person would say; css and xpath do not.

// Commands that assert or wait rather than describe an action a person takes. Assertions are a
// test concern; a skill is a procedure, so they are summarised rather than emitted as steps.
const ASSERTIONS = new Set([
  'assert', 'assertText', 'assertValue', 'assertTitle', 'assertElementPresent',
  'assertNotText', 'assertChecked', 'assertAlert', 'assertConfirmation',
  'verify', 'verifyText', 'verifyValue', 'verifyTitle', 'verifyElementPresent',
]);

// Commands that are pure test scaffolding with no user-visible meaning.
const NOISE = new Set([
  'setWindowSize', 'setSpeed', 'store', 'storeText', 'storeValue', 'storeJson',
  'executeScript', 'executeAsyncScript', 'runScript', 'echo', 'pause', 'close',
]);

const STRATEGY_RANK = ['linkText', 'partialLinkText', 'name', 'id', 'css', 'xpath'];

/**
 * Pick the most human-readable locator for a command.
 * Prefers linkText/name (words a person sees) over css/xpath (machine selectors).
 */
function pickLocator(cmd) {
  const candidates = [];
  if (Array.isArray(cmd.targets)) {
    for (const t of cmd.targets) {
      const raw = Array.isArray(t) ? t[0] : t;
      if (typeof raw === 'string' && raw) candidates.push(raw);
    }
  }
  if (typeof cmd.target === 'string' && cmd.target) candidates.push(cmd.target);
  if (!candidates.length) return null;

  const parsed = candidates.map(raw => {
    const i = raw.indexOf('=');
    if (i === -1) return { strategy: 'css', value: raw };
    const strategy = raw.slice(0, i);
    // Selenium writes "css:finder" style suffixes in the targets array.
    const base = strategy.split(':')[0];
    return { strategy: base, value: raw.slice(i + 1) };
  }).filter(p => p.value);

  if (!parsed.length) return null;
  parsed.sort((a, b) => {
    const ra = STRATEGY_RANK.indexOf(a.strategy); const rb = STRATEGY_RANK.indexOf(b.strategy);
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
  return parsed[0];
}

function describe(locator) {
  if (!locator) return null;
  const readable = ['linkText', 'partialLinkText', 'name'].includes(locator.strategy);
  return readable ? `"${locator.value}"` : `\`${locator.value}\``;
}

function resolveUrl(target, baseUrl) {
  if (!target) return baseUrl || null;
  if (/^https?:\/\//i.test(target)) return target;
  if (!baseUrl) return target;
  try { return new URL(target, baseUrl).toString(); } catch (_) { return target; }
}

function commandToSentence(cmd, baseUrl) {
  const loc = pickLocator(cmd);
  const what = describe(loc);
  const value = typeof cmd.value === 'string' ? cmd.value : '';
  switch (cmd.command) {
    case 'open':
      return `Navigate to ${resolveUrl(cmd.target, baseUrl)}.`;
    case 'click':
    case 'clickAt':
      return what ? `Click ${what}.` : 'Click the element.';
    case 'doubleClick':
    case 'doubleClickAt':
      return what ? `Double-click ${what}.` : 'Double-click the element.';
    case 'type':
    case 'editContent':
      if (what && value) return `Type "${value}" into ${what}.`;
      return what ? `Clear ${what}.` : null;
    case 'sendKeys': {
      // Values arrive as ${KEY_ENTER}; say the key, not the macro.
      const key = value.replace(/^\$\{KEY_(.+)\}$/, (_, k) => k.charAt(0) + k.slice(1).toLowerCase());
      if (!key) return null;
      return what ? `Press ${key} in ${what}.` : `Press ${key}.`;
    }
    case 'select':
    case 'addSelection': {
      const opt = value.replace(/^(label|value|index)=/, '');
      if (what && opt) return `Select "${opt}" from ${what}.`;
      return what ? `Choose an option in ${what}.` : null;
    }
    case 'check':
      return what ? `Tick ${what}.` : null;
    case 'uncheck':
      return what ? `Untick ${what}.` : null;
    case 'mouseOver':
      return what ? `Hover over ${what}.` : null;
    case 'submit':
      return what ? `Submit ${what}.` : 'Submit the form.';
    case 'selectWindow':
    case 'selectFrame':
      return null; // frame/window bookkeeping, not a user action
    case 'waitForElementVisible':
    case 'waitForElementPresent':
      return what ? `Wait for ${what} to appear.` : 'Wait for the page to update.';
    case 'waitForElementNotVisible':
      return what ? `Wait for ${what} to disappear.` : null;
    default:
      return null;
  }
}

function headingFor(cmd, baseUrl) {
  const loc = pickLocator(cmd);
  const readable = loc && ['linkText', 'partialLinkText', 'name'].includes(loc.strategy)
    ? loc.value : null;
  switch (cmd.command) {
    case 'open': {
      const url = resolveUrl(cmd.target, baseUrl);
      try { return `Open ${new URL(url).host}`; } catch (_) { return 'Open the page'; }
    }
    case 'click': case 'clickAt': case 'doubleClick': case 'doubleClickAt':
      return readable ? `Click ${readable}` : 'Click the control';
    case 'type': case 'editContent':
      return readable ? `Fill in ${readable}` : 'Fill in the field';
    case 'select': case 'addSelection':
      return readable ? `Choose from ${readable}` : 'Choose an option';
    case 'check': case 'uncheck':
      return readable ? `Toggle ${readable}` : 'Toggle the checkbox';
    case 'mouseOver':
      return readable ? `Hover ${readable}` : 'Hover the control';
    case 'sendKeys':
      return 'Press a key';
    case 'submit':
      return 'Submit the form';
    case 'waitForElementVisible':
    case 'waitForElementPresent':
      return readable ? `Wait for ${readable}` : 'Wait for the page';
    case 'waitForElementNotVisible':
      return readable ? `Wait for ${readable} to go` : 'Wait for the page';
    default:
      return 'Continue';
  }
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    || 'selenium-workflow';
}

/**
 * @param {object} project Parsed .side JSON.
 * @param {{test?: string, name?: string}} [opts] test = name or id of the test to convert.
 */
function convertSide(project, opts) {
  opts = opts || {};
  if (!project || typeof project !== 'object') throw new Error('project must be an object');
  const tests = Array.isArray(project.tests) ? project.tests : null;
  if (!tests || !tests.length) throw new Error('project has no tests — is this a Selenium IDE .side file?');

  let test;
  if (opts.test) {
    test = tests.find(t => t && (t.name === opts.test || t.id === opts.test));
    if (!test) {
      throw new Error(`no test named "${opts.test}" (available: ${tests.map(t => t && t.name).filter(Boolean).join(', ')})`);
    }
  } else {
    test = tests[0];
  }
  const commands = Array.isArray(test.commands) ? test.commands : [];
  const baseUrl = project.url || '';

  const kept = [];
  let dropped = 0, assertions = 0;
  for (const cmd of commands) {
    if (!cmd || typeof cmd.command !== 'string' || !cmd.command) { dropped++; continue; }
    if (ASSERTIONS.has(cmd.command)) { assertions++; continue; }
    if (NOISE.has(cmd.command)) { dropped++; continue; }
    const sentence = commandToSentence(cmd, baseUrl);
    if (!sentence) { dropped++; continue; }
    kept.push({ sentence, heading: headingFor(cmd, baseUrl), comment: cmd.comment || '' });
  }

  const hosts = [];
  for (const c of commands) {
    if (c && c.command === 'open') {
      try { const h = new URL(resolveUrl(c.target, baseUrl)).host; if (h && !hosts.includes(h)) hosts.push(h); }
      catch (_) { /* ignore unparseable */ }
    }
  }
  if (!hosts.length && baseUrl) {
    try { hosts.push(new URL(baseUrl).host); } catch (_) { /* ignore */ }
  }

  const title = opts.name || test.name || project.name || 'Selenium workflow';
  const lines = [];
  lines.push('---');
  lines.push(`name: ${slugify(opts.name || test.name || project.name)}`);
  lines.push(`description: ${hosts.length ? `Replay a ${hosts.join(' and ')} workflow recorded in Selenium IDE` : 'Replay a workflow recorded in Selenium IDE'}`);
  if (hosts.length) lines.push(`apps: [${hosts.join(', ')}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('> Converted from a Selenium IDE .side project by skill-md.');
  lines.push('');
  lines.push('## Prerequisites');
  lines.push('');
  for (const h of hosts) lines.push(`- Access to ${h}`);
  if (!hosts.length) lines.push('- A web browser');
  lines.push('');
  lines.push('## Workflow Steps');
  lines.push('');
  kept.forEach((k, i) => {
    lines.push(`### Step ${i + 1}: ${k.heading}`);
    lines.push('');
    lines.push(k.comment ? `${k.sentence} (${k.comment})` : k.sentence);
    lines.push('');
  });

  const notes = [];
  if (assertions > 0) {
    notes.push(assertions === 1
      ? '1 assertion from the original test was omitted — a skill describes what to do, not what to verify. Re-add it as a Note if the check matters to you.'
      : `${assertions} assertions from the original test were omitted — a skill describes what to do, not what to verify. Re-add them as Notes if the checks matter to you.`);
  }
  if (dropped > 0) {
    notes.push(dropped === 1
      ? '1 scaffolding command (window sizing, stored variables, scripts, frame switching) was omitted.'
      : `${dropped} scaffolding commands (window sizing, stored variables, scripts, frame switching) were omitted.`);
  }
  if (notes.length) {
    lines.push('## Notes');
    lines.push('');
    for (const n of notes) { lines.push(n); lines.push(''); }
  }

  return {
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n',
    stats: { test: test.name || null, total: commands.length, kept: kept.length, dropped, assertions, apps: hosts,
             available: tests.map(t => t && t.name).filter(Boolean) },
  };
}

module.exports = { convertSide, pickLocator, slugify };
