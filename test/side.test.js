'use strict';

const assert = require('assert');
const { convertSide, pickLocator, slugify } = require('../lib/side.js');
const { validate } = require('../lib/validate.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
}
const proj = (commands, extra) => Object.assign({
  name: 'Proj', url: 'https://app.example.com',
  tests: [{ id: 't1', name: 'Flow', commands }],
}, extra || {});

console.log('pickLocator');

test('prefers human-readable strategies over css/xpath', () => {
  const r = pickLocator({ target: 'css=#new', targets: [['css=#new', 'css:finder'], ['linkText=New expense', 'linkText']] });
  assert.deepStrictEqual(r, { strategy: 'linkText', value: 'New expense' });
});

test('ranks name above id', () => {
  const r = pickLocator({ target: 'id=amount', targets: [['id=amount', 'id'], ['name=Amount', 'name']] });
  assert.strictEqual(r.strategy, 'name');
});

test('handles a bare target with no strategy prefix', () => {
  assert.deepStrictEqual(pickLocator({ target: '#plain' }), { strategy: 'css', value: '#plain' });
});

test('returns null with no locator at all', () => {
  assert.strictEqual(pickLocator({}), null);
});

console.log('convertSide');

test('rejects non-projects and empty projects', () => {
  assert.throws(() => convertSide(null), /must be an object/);
  assert.throws(() => convertSide({ tests: [] }), /no tests/);
});

test('output always passes the validator', () => {
  const out = convertSide(proj([
    { command: 'open', target: '/a' },
    { command: 'click', target: 'linkText=Go' },
  ]));
  const v = validate(out.markdown);
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
  assert.strictEqual(v.warnings.length, 0, JSON.stringify(v.warnings));
});

test('resolves relative open targets against the project url', () => {
  const out = convertSide(proj([{ command: 'open', target: '/expenses/new' }]));
  assert.ok(/https:\/\/app\.example\.com\/expenses\/new/.test(out.markdown), out.markdown);
});

test('drops assertions and scaffolding, counts them separately', () => {
  const out = convertSide(proj([
    { command: 'setWindowSize', target: '1280x800' },
    { command: 'open', target: '/' },
    { command: 'assertText', target: 'css=.toast', value: 'Saved' },
    { command: 'executeScript', target: 'return 1' },
    { command: 'click', target: 'linkText=Go' },
  ]));
  assert.strictEqual(out.stats.kept, 2);
  assert.strictEqual(out.stats.assertions, 1);
  assert.strictEqual(out.stats.dropped, 2);
});

test('singular note reads grammatically', () => {
  const out = convertSide(proj([
    { command: 'open', target: '/' },
    { command: 'assertText', target: 'css=.x', value: 'y' },
    { command: 'executeScript', target: 'return 1' },
  ]));
  assert.ok(/1 assertion from the original test was omitted/.test(out.markdown), out.markdown);
  assert.ok(/1 scaffolding command .* was omitted/.test(out.markdown), out.markdown);
});

test('select strips the label= prefix from the value', () => {
  const out = convertSide(proj([
    { command: 'open', target: '/' },
    { command: 'select', target: 'name=Category', value: 'label=Meals' },
  ]));
  assert.ok(/Select "Meals" from "Category"/.test(out.markdown), out.markdown);
});

test('sendKeys renders the key name, not the macro', () => {
  const out = convertSide(proj([
    { command: 'open', target: '/' },
    { command: 'sendKeys', target: 'name=Amount', value: '${KEY_ENTER}' },
  ]));
  assert.ok(/Press Enter in "Amount"/.test(out.markdown), out.markdown);
  assert.ok(!/KEY_ENTER/.test(out.markdown));
});

test('waitFor gets a real heading, not the fallback', () => {
  const out = convertSide(proj([
    { command: 'open', target: '/' },
    { command: 'waitForElementVisible', target: 'linkText=Back to list', value: '5000' },
  ]));
  assert.ok(/### Step 2: Wait for Back to list/.test(out.markdown), out.markdown);
  assert.ok(!/Step 2: Continue/.test(out.markdown));
});

test('a command comment is carried into the step', () => {
  const out = convertSide(proj([
    { command: 'open', target: '/' },
    { command: 'type', target: 'name=Amount', value: '48.20', comment: 'as on the receipt' },
  ]));
  assert.ok(/\(as on the receipt\)/.test(out.markdown));
});

test('picks a named test and reports the alternatives', () => {
  const p = { name: 'P', url: 'https://x.test', tests: [
    { id: 'a', name: 'First', commands: [{ command: 'open', target: '/' }] },
    { id: 'b', name: 'Second', commands: [{ command: 'open', target: '/2' }, { command: 'click', target: 'linkText=Z' }] },
  ] };
  const out = convertSide(p, { test: 'Second' });
  assert.strictEqual(out.stats.test, 'Second');
  assert.strictEqual(out.stats.kept, 2);
  assert.deepStrictEqual(out.stats.available, ['First', 'Second']);
  assert.throws(() => convertSide(p, { test: 'Nope' }), /no test named/);
});

test('steps stay sequential after drops', () => {
  const out = convertSide(proj([
    { command: 'setWindowSize', target: '1x1' },
    { command: 'open', target: '/' },
    { command: 'assertText', target: 'css=.a', value: 'b' },
    { command: 'click', target: 'linkText=One' },
    { command: 'echo', target: 'hi' },
    { command: 'click', target: 'linkText=Two' },
  ]));
  const nums = [...out.markdown.matchAll(/^### Step (\d+):/gm)].map(m => Number(m[1]));
  assert.deepStrictEqual(nums, [1, 2, 3]);
  assert.strictEqual(validate(out.markdown).ok, true);
});

console.log(`\n${passed} passed`);
