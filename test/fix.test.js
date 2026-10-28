'use strict';

// Tests for lib/fix.js.
//
// This file exists because the fixer shipped and was advertised before it had any regression
// protection: it is on skillforge.expert/skill-md, in the README, in the GitHub Action's step
// summary, and in two posts drafted for the founder — all while validate, convert, side and
// action had tests and fix had none. The behaviour most worth protecting is not what it repairs
// but what it REFUSES to repair, because that refusal is the thing we claim publicly.

const assert = require('assert');
const { fix, slugifyName } = require('../lib/fix.js');
const { validate } = require('../lib/validate.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const BOM = '﻿';
const good = 'Logs a support ticket in the helpdesk portal. Use when the user asks to raise, file or log a ticket.';
const skill = (fm, body) => `---\n${fm}\n---\n${body || '\n# Title\n'}`;

console.log('slugifyName');

test('lowercases, converts separators and collapses hyphens', () => {
  assert.strictEqual(slugifyName('Fill_Support-Ticket--Form'), 'fill-support-ticket-form');
  assert.strictEqual(slugifyName('  Weekly  Expense Report '), 'weekly-expense-report');
});

test('strips characters the spec disallows and trims stray hyphens', () => {
  assert.strictEqual(slugifyName('PDF/Processing!'), 'pdfprocessing');
  assert.strictEqual(slugifyName('-leading-and-trailing-'), 'leading-and-trailing');
});

test('caps at the spec limit of 64 characters', () => {
  assert.strictEqual(slugifyName('a'.repeat(200)).length, 64);
});

console.log('\nrepairs the spec determines');

test('removes a BOM, which otherwise hides the frontmatter entirely', () => {
  const r = fix(BOM + skill(`name: x\ndescription: ${good}`), { dirName: 'x' });
  assert.notStrictEqual(r.text.charCodeAt(0), 0xfeff);
  assert.ok(r.text.startsWith('---'));
  assert.ok(r.applied.some(a => /byte-order mark/i.test(a)));
});

test('replaces tabs in the frontmatter, which make the YAML unparseable', () => {
  const r = fix(skill(`name: x\n\tdescription: ${good}`), { dirName: 'x' });
  assert.ok(!/\t/.test(/^---\n([\s\S]*?)\n---/.exec(r.text)[1]));
  assert.ok(r.applied.some(a => /tabs/i.test(a)));
});

test('renames to match the parent directory', () => {
  const r = fix(skill(`name: something-else\ndescription: ${good}`), { dirName: 'fill-ticket' });
  assert.ok(/^name: fill-ticket$/m.test(r.text));
  assert.ok(r.applied.some(a => /parent directory/i.test(a)));
});

test('legalises a name when no directory is known', () => {
  const r = fix(skill(`name: My_Skill\ndescription: ${good}`), {});
  assert.ok(/^name: my-skill$/m.test(r.text));
});

test('renumbers steps that skip, and says a gap may mean a deleted step', () => {
  const r = fix(skill(`name: x\ndescription: ${good}`,
    '\n### Step 1: open\n\n### Step 4: submit\n'), { dirName: 'x' });
  assert.ok(/### Step 1: open/.test(r.text));
  assert.ok(/### Step 2: submit/.test(r.text));
  assert.ok(r.applied.some(a => /deleted/i.test(a)), 'should warn that a gap may hide a deletion');
});

console.log('\nrefuses what a tool must not guess');

test('NEVER writes a description, and says why', () => {
  const before = 'description: Helps with tickets.';
  const r = fix(skill(`name: x\n${before}`), { dirName: 'x' });
  assert.ok(r.text.includes(before), 'the description must be returned untouched');
  assert.ok(r.refused.some(x => /does not say WHEN/i.test(x)));
  // The reason matters as much as the refusal: this is the claim we make publicly.
  assert.ok(r.refused.some(x => /wrong requests/i.test(x)));
});

test('leaves an over-long description alone rather than truncating it', () => {
  const long = 'Files a ticket. Use when asked. ' + 'x'.repeat(1100);
  const r = fix(skill(`name: x\ndescription: ${long}`), { dirName: 'x' });
  assert.ok(r.text.includes(long));
  assert.ok(r.refused.some(x => /1024/.test(x)));
});

test('does not invent a missing name or description', () => {
  const r = fix(skill('name: x'), { dirName: 'x' });
  assert.ok(!/description:/.test(r.text));
  assert.ok(r.refused.some(x => /No description field/i.test(x)));
});

test('accepts a description that already carries a trigger clause', () => {
  const r = fix(skill(`name: x\ndescription: ${good}`), { dirName: 'x' });
  assert.deepStrictEqual(r.refused, [], 'a good description should not be flagged');
});

console.log('\nsafety properties');

test('is idempotent: fixing a clean file changes nothing', () => {
  const clean = skill(`name: x\ndescription: ${good}`, '\n### Step 1: a\n\n### Step 2: b\n');
  const r = fix(clean, { dirName: 'x' });
  assert.strictEqual(r.text, clean);
  assert.deepStrictEqual(r.applied, []);
  assert.deepStrictEqual(r.refused, []);
});

test('fixing twice yields the same result as fixing once', () => {
  const broken = BOM + skill('name: My_Skill\ndescription: Helps.', '\n### Step 1: a\n\n### Step 9: b\n');
  const once = fix(broken, { dirName: 'my-skill' }).text;
  const twice = fix(once, { dirName: 'my-skill' }).text;
  assert.strictEqual(twice, once);
});

test('survives no frontmatter without throwing or mangling', () => {
  const r = fix('# just a heading\n', {});
  assert.strictEqual(r.text, '# just a heading\n');
  assert.deepStrictEqual(r.applied, []);
  assert.ok(r.refused.some(x => /No YAML frontmatter/i.test(x)));
});

test('survives empty and null input', () => {
  for (const input of ['', null, undefined]) {
    const r = fix(input, {});
    assert.strictEqual(typeof r.text, 'string');
    assert.ok(Array.isArray(r.applied) && Array.isArray(r.refused));
  }
});

test('a name with nothing salvageable is refused, not mangled into an empty value', () => {
  const r = fix(skill(`name: "!!!"\ndescription: ${good}`), {});
  assert.ok(!/^name:\s*$/m.test(r.text), 'must not leave an empty name');
});

console.log('\nthe property that matters: output passes the validator');

test('a file with 2 errors and 2 warnings comes back clean', () => {
  const broken = BOM + skill('name: Fill_Support-Ticket--Form\ndescription: ' + good,
    '\n# Fill\n\n## Workflow Steps\n\n### Step 1: open\n\nGo there.\n\n### Step 3: submit\n\nClick it.\n');
  const opts = { dirName: 'fill-support-ticket', fileName: 'SKILL.md', files: [] };

  const before = validate(broken, opts);
  assert.ok(before.errors.length >= 2, 'fixture should start with errors');

  const after = validate(fix(broken, opts).text, opts);
  assert.strictEqual(after.errors.length, 0, 'fixer output must have no errors: ' +
    after.errors.map(e => e.msg).join('; '));
  assert.strictEqual(after.warnings.length, 0, 'fixer output must have no warnings: ' +
    after.warnings.map(w => w.msg).join('; '));
  assert.strictEqual(after.ok, true);
});

test('what it refuses is exactly what the validator still reports', () => {
  // The fixer and the validator must agree about which problems remain a human's job.
  const opts = { dirName: 'x', fileName: 'SKILL.md', files: [] };
  const r = fix(skill('name: x\ndescription: Helps with tickets.'), opts);
  const after = validate(r.text, opts);
  const stillFlagged = [...after.errors, ...after.warnings, ...after.hints]
    .some(m => /does not say WHEN|say what the skill does AND when/i.test(m.msg));
  assert.ok(stillFlagged, 'the validator should still flag the description the fixer refused');
});

console.log(`\n${passed} passed`);
