'use strict';

// Convert a Chrome DevTools Recorder export into SKILL.md.
//
// Why this exists: recording a workflow is the hard part of authoring a skill, and Chrome already
// ships a recorder (DevTools -> Recorder) that exports JSON. Converting that export means someone
// can produce a SKILL.md from a flow they already recorded, with no new tooling and nothing to trust
// with screen capture.
//
// The export schema follows Puppeteer's step schema: { title, steps: [{ type, ... }] }.
// Step types seen in the wild: setViewport, navigate, click, doubleClick, hover, change, keyDown,
// keyUp, scroll, close, waitForElement, waitForExpression.

// Steps that describe browser plumbing rather than something a person did. A human replaying the
// task does not "set viewport" or "key up"; emitting those would bury the real actions.
const NOISE = new Set(['setViewport', 'close', 'keyUp', 'waitForExpression']);

/**
 * Chrome records several selector flavours per step, e.g.
 *   [["aria/Submit order"], ["#submit"], ["xpath///*[@id='submit']"], ["pierce/#submit"]]
 * The aria one is a human label, which is what a skill step should say. Fall back through
 * text, then a plain CSS selector, and only then xpath.
 */
function pickLabel(selectors) {
  if (!Array.isArray(selectors)) return null;
  const flat = selectors.map(s => (Array.isArray(s) ? s[0] : s)).filter(s => typeof s === 'string');

  const aria = flat.find(s => s.startsWith('aria/'));
  if (aria) {
    const label = aria.slice('aria/'.length).trim();
    // Chrome appends a role for ambiguous matches, e.g. "aria/Submit[role="button"]".
    const cleaned = label.replace(/\[role="[^"]*"\]\s*$/, '').trim();
    if (cleaned) return { text: cleaned, kind: 'aria' };
  }

  const text = flat.find(s => s.startsWith('text/'));
  if (text) {
    const t = text.slice('text/'.length).trim();
    if (t) return { text: t, kind: 'text' };
  }

  const css = flat.find(s => !s.includes('/') && s.trim());
  if (css) return { text: css.trim(), kind: 'css' };

  const xpath = flat.find(s => s.startsWith('xpath/'));
  if (xpath) return { text: xpath.slice('xpath/'.length).trim(), kind: 'xpath' };

  return null;
}

function describeTarget(step) {
  const picked = pickLabel(step.selectors);
  if (!picked) return null;
  // A readable label goes in quotes; a raw selector is shown as code so it is obvious it is one.
  return picked.kind === 'aria' || picked.kind === 'text'
    ? `"${picked.text}"`
    : `\`${picked.text}\``;
}

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return null; }
}

/** Turn one recorder step into an imperative sentence, or null to drop it. */
function stepToSentence(step) {
  const target = describeTarget(step);
  switch (step.type) {
    case 'navigate': {
      const host = hostOf(step.url);
      return `Navigate to ${step.url || host || 'the page'}.`;
    }
    case 'click':
      return target ? `Click ${target}.` : 'Click the element.';
    case 'doubleClick':
      return target ? `Double-click ${target}.` : 'Double-click the element.';
    case 'hover':
      return target ? `Hover over ${target}.` : 'Hover over the element.';
    case 'change': {
      // Chrome records the final value of an input as a `change` step.
      const value = typeof step.value === 'string' ? step.value : '';
      if (target && value) return `Type "${value}" into ${target}.`;
      if (target) return `Enter a value into ${target}.`;
      return value ? `Type "${value}".` : 'Enter a value.';
    }
    case 'keyDown': {
      const key = step.key || '';
      if (!key) return null;
      // Modifier-only presses are not meaningful on their own.
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return null;
      return `Press ${key}.`;
    }
    case 'scroll':
      return 'Scroll to bring the next part of the page into view.';
    case 'waitForElement':
      return target ? `Wait for ${target} to appear.` : 'Wait for the page to update.';
    default:
      return null;
  }
}

/** A short intent heading for a step, so the file reads as a procedure not a log. */
function headingFor(step, sentence) {
  const target = pickLabel(step.selectors);
  const label = target && (target.kind === 'aria' || target.kind === 'text') ? target.text : null;
  switch (step.type) {
    case 'navigate': {
      const host = hostOf(step.url);
      return host ? `Open ${host}` : 'Open the page';
    }
    case 'click':
    case 'doubleClick':
      return label ? `Click ${label}` : 'Click the control';
    case 'hover':
      return label ? `Hover ${label}` : 'Hover the control';
    case 'change':
      return label ? `Fill in ${label}` : 'Fill in the field';
    case 'keyDown':
      return step.key ? `Press ${step.key}` : 'Press a key';
    case 'scroll':
      return 'Scroll the page';
    case 'waitForElement':
      return label ? `Wait for ${label}` : 'Wait for the page';
    default:
      return sentence.replace(/\.$/, '');
  }
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'recorded-workflow';
}

/**
 * @param {object} recording Parsed Chrome Recorder JSON.
 * @param {{name?: string, description?: string}} [opts]
 * @returns {{markdown: string, stats: {total: number, kept: number, dropped: number, apps: string[]}}}
 */
function convert(recording, opts) {
  opts = opts || {};
  if (!recording || typeof recording !== 'object') throw new Error('recording must be an object');
  const steps = Array.isArray(recording.steps) ? recording.steps : null;
  if (!steps) throw new Error('recording has no steps array — is this a Chrome Recorder export?');

  const kept = [];
  let dropped = 0;
  for (const step of steps) {
    if (!step || typeof step.type !== 'string' || NOISE.has(step.type)) { dropped++; continue; }
    const sentence = stepToSentence(step);
    if (!sentence) { dropped++; continue; }
    kept.push({ step, sentence, heading: headingFor(step, sentence) });
  }

  const hosts = [];
  for (const s of steps) {
    if (s && s.type === 'navigate') {
      const h = hostOf(s.url);
      if (h && !hosts.includes(h)) hosts.push(h);
    }
  }

  const title = opts.name || recording.title || 'Recorded workflow';
  const name = slugify(opts.name || recording.title);
  // The description is what an agent matches the user's request against, so a summary written for
  // a human ("Replay a workflow recorded in Chrome DevTools") is the single most common reason a
  // valid skill never fires. Build a trigger clause from the recording's own title.
  const trigger = String(title).trim().replace(/[.\s]+$/, '');
  const where = hosts.length ? ` on ${hosts.join(' and ')}` : '';
  const description = opts.description
    || `${trigger}${where}, recorded in Chrome DevTools and replayable step by step.`
       + ` Use when the user asks to ${trigger.charAt(0).toLowerCase() + trigger.slice(1)}.`;

  const lines = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);
  if (hosts.length) lines.push(`apps: [Chrome${hosts.length ? ', ' + hosts.join(', ') : ''}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('> Converted from a Chrome DevTools Recorder export by skill-md.');
  lines.push('');
  lines.push('## Prerequisites');
  lines.push('');
  lines.push('- Google Chrome');
  for (const h of hosts) lines.push(`- Access to ${h}`);
  lines.push('');
  lines.push('## Workflow Steps');
  lines.push('');
  kept.forEach((k, i) => {
    lines.push(`### Step ${i + 1}: ${k.heading}`);
    lines.push('');
    lines.push(k.sentence);
    lines.push('');
  });

  if (dropped > 0) {
    lines.push('## Notes');
    lines.push('');
    lines.push(`${dropped} browser-level step${dropped === 1 ? '' : 's'} (viewport, key-up, tab close) were omitted — they describe the browser rather than the task.`);
    lines.push('');
  }

  return {
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n',
    stats: { total: steps.length, kept: kept.length, dropped, apps: hosts },
  };
}

module.exports = { convert, pickLabel, slugify };
