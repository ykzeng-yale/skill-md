'use strict';

const assert = require('assert');
const { convert, pickLabel, slugify } = require('../lib/convert.js');
const { validate } = require('../lib/validate.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const rec = (steps, title) => ({ title: title || 'Demo flow', steps });

console.log('pickLabel');

test('prefers the aria label and strips the role suffix', () => {
  const r = pickLabel([['aria/Submit order[role="button"]'], ['#submit'], ['xpath///*[@id="submit"]']]);
  assert.deepStrictEqual(r, { text: 'Submit order', kind: 'aria' });
});

test('falls back to text/ then css then xpath', () => {
  assert.strictEqual(pickLabel([['text/Meals'], ['li:nth-child(3)']]).kind, 'text');
  assert.strictEqual(pickLabel([['#only-css']]).kind, 'css');
  assert.strictEqual(pickLabel([['xpath///div']]).kind, 'xpath');
});

test('returns null when there are no selectors', () => {
  assert.strictEqual(pickLabel(undefined), null);
  assert.strictEqual(pickLabel([]), null);
});

console.log('slugify');

test('produces a slug-safe name the validator will not warn about', () => {
  assert.strictEqual(slugify('File Expense in Notion!'), 'file-expense-in-notion');
  assert.strictEqual(slugify(''), 'recorded-workflow');
});

console.log('convert');

test('rejects input that is not a recorder export', () => {
  assert.throws(() => convert(null), /must be an object/);
  assert.throws(() => convert({ title: 'x' }), /no steps array/);
});

test('output always passes our own validator', () => {
  const out = convert(rec([
    { type: 'navigate', url: 'https://example.com/a' },
    { type: 'click', selectors: [['aria/Go']] },
  ]));
  const v = validate(out.markdown);
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
  assert.strictEqual(v.warnings.length, 0, JSON.stringify(v.warnings));
});

test('drops browser plumbing but keeps real actions', () => {
  const out = convert(rec([
    { type: 'setViewport', width: 100, height: 100 },
    { type: 'navigate', url: 'https://example.com/' },
    { type: 'keyUp', key: 'A' },
    { type: 'close' },
    { type: 'click', selectors: [['aria/Save']] },
  ]));
  assert.strictEqual(out.stats.kept, 2);
  assert.strictEqual(out.stats.dropped, 3);
  assert.ok(!/viewport/i.test(out.markdown.split('## Notes')[0]));
});

test('drops modifier-only keyDown but keeps real keys', () => {
  const out = convert(rec([
    { type: 'navigate', url: 'https://example.com/' },
    { type: 'keyDown', key: 'Shift' },
    { type: 'keyDown', key: 'Enter' },
  ]));
  assert.ok(/Press Enter/.test(out.markdown));
  assert.ok(!/Press Shift/.test(out.markdown));
});

test('change steps become a typed value with the field label', () => {
  const out = convert(rec([
    { type: 'navigate', url: 'https://example.com/' },
    { type: 'change', value: '48.20', selectors: [['aria/Amount']] },
  ]));
  assert.ok(/Type "48\.20" into "Amount"/.test(out.markdown), out.markdown);
});

test('steps are numbered sequentially after drops', () => {
  const out = convert(rec([
    { type: 'setViewport' },
    { type: 'navigate', url: 'https://example.com/' },
    { type: 'keyUp', key: 'A' },
    { type: 'click', selectors: [['aria/One']] },
    { type: 'close' },
    { type: 'click', selectors: [['aria/Two']] },
  ]));
  const nums = [...out.markdown.matchAll(/^### Step (\d+):/gm)].map(m => Number(m[1]));
  assert.deepStrictEqual(nums, [1, 2, 3], 'numbering must not have gaps where steps were dropped');
  assert.strictEqual(validate(out.markdown).ok, true);
});

test('collects navigated hosts into apps and prerequisites', () => {
  const out = convert(rec([
    { type: 'navigate', url: 'https://notion.so/a' },
    { type: 'navigate', url: 'https://mail.google.com/b' },
    { type: 'click', selectors: [['aria/X']] },
  ]));
  assert.deepStrictEqual(out.stats.apps, ['notion.so', 'mail.google.com']);
  assert.ok(/- Access to notion\.so/.test(out.markdown));
  assert.ok(/- Access to mail\.google\.com/.test(out.markdown));
});

test('a recording with no usable steps is reported, not papered over', () => {
  const out = convert(rec([{ type: 'setViewport' }, { type: 'close' }]));
  assert.strictEqual(out.stats.kept, 0);
  // A stepless file is spec-conformant (the Agent Skills body has no format requirements), so
  // the validator no longer rejects it — but it does flag the contradiction of a declared steps
  // section with nothing in it, and the CLI refuses to write the file at all. Better that
  // convert is honest about producing nothing useful than that it invent steps.
  const res = validate(out.markdown);
  assert.ok(res.warnings.some(w => /no numbered steps/.test(w.msg)), JSON.stringify(res.warnings));
});

test('honours an explicit name override', () => {
  const out = convert(rec([{ type: 'navigate', url: 'https://example.com/' }]), { name: 'My Custom Flow' });
  assert.ok(/^name: my-custom-flow$/m.test(out.markdown));
  assert.ok(/^# My Custom Flow$/m.test(out.markdown));
});

test('the description is a trigger, not a summary', () => {
  const out = convert(rec([{ type: 'navigate', url: 'https://example.com/' }], 'File the VAT return'));
  const desc = /^description: (.*)$/m.exec(out.markdown)[1];
  assert.ok(/Use when the user asks to file the VAT return/.test(desc), desc);
  // An agent matches the request against this field, so a human-style summary never fires.
  assert.ok(validate(out.markdown).hints.every(h => !/does not say WHEN/.test(h.msg)));
});

console.log(`\n${passed} passed`);
