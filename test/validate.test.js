'use strict';

// Plain node:assert so `npm test` needs no devDependencies.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validate, collectFileReferences, parseFrontmatter } = require('../lib/validate.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    process.exitCode = 1;
  }
}

const VALID = `---
name: demo-skill
description: Does a thing
---

# Demo Skill

## Prerequisites

- Chrome

## Workflow Steps

### Step 1: Open the page

Navigate to example.com.

### Step 2: Submit

Click the Save button.
`;

console.log('parseFrontmatter');

test('parses keys and strips quotes', () => {
  const { frontmatter } = parseFrontmatter('---\nname: "a-b"\ndescription: x\n---\nbody\n');
  assert.strictEqual(frontmatter.name, 'a-b');
  assert.strictEqual(frontmatter.description, 'x');
});

test('reports unterminated frontmatter', () => {
  const r = parseFrontmatter('---\nname: x\nbody with no close\n');
  assert.strictEqual(r.unterminated, true);
});

test('no frontmatter when file does not start with ---', () => {
  const { frontmatter } = parseFrontmatter('# Title\n');
  assert.strictEqual(frontmatter, null);
});

console.log('validate');

test('accepts a well-formed skill', () => {
  const r = validate(VALID);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.stats.steps, 2);
  assert.strictEqual(r.stats.name, 'demo-skill');
});

test('rejects an empty file', () => {
  const r = validate('');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0].msg, /empty/);
});

test('rejects a missing frontmatter block', () => {
  const r = validate('# Title\n\n## Workflow Steps\n\n1. Click save\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /frontmatter/.test(e.msg)));
});

test('rejects missing required frontmatter keys', () => {
  const r = validate('---\nname: x\n---\n\n## Workflow Steps\n\n1. Click save\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /description/.test(e.msg)));
});

// The Agent Skills spec says the body has NO format restrictions, so neither of these is a
// spec violation. An empty declared steps section is still a contradiction worth warning about;
// a body with no steps at all is merely a different kind of skill.
test('an empty steps section warns but does not fail', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n## Workflow Steps\n\nnothing here\n');
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.warnings.some(w => /no numbered steps/.test(w.msg)), JSON.stringify(r.warnings));
});

test('a skill with no steps section is valid (prose and reference skills are conformant)', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n## Description\n\nhi\n');
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.hints.some(h => /no numbered steps/.test(h.msg)));
});

test('the spec\'s own minimal example validates', () => {
  const r = validate('---\nname: skill-name\ndescription: A description of what this skill does and when to use it.\n---\n');
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});

test('an arbitrary body heading is not flagged — the spec allows any body', () => {
  const r = validate('---\nname: x\ndescription: A long enough description saying what and when\n---\n\n# T\n\n## Anything At All\n\nprose\n');
  assert.strictEqual(r.ok, true);
  assert.ok(!r.hints.some(h => /unrecognized section/.test(h.msg)), 'should not second-guess body structure');
});

test('accepts "## Steps" as an alias', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n# T\n\n## Steps\n\n1. Click save\n');
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});

test('accepts an ordered list as steps', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n# T\n\n## Workflow Steps\n\n1. Open the app\n2. Click save\n');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stats.steps, 2);
});

test('warns on non-sequential step numbers', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n# T\n\n## Workflow Steps\n\n1. Open it\n3. Click save\n');
  assert.strictEqual(r.ok, true, 'numbering is a warning, not an error');
  assert.ok(r.warnings.some(w => /sequential/.test(w.msg)));
});

// The spec's name rules are normative and agents use the name as a directory, so these are
// errors, not style warnings. Each case below is quoted as invalid by agentskills.io.
test('rejects a name with uppercase or spaces', () => {
  const r = validate('---\nname: My Skill\ndescription: y\n---\n\n# T\n\n## Workflow Steps\n\n1. Click save\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /lowercase letters, digits and hyphens/.test(e.msg)), JSON.stringify(r.errors));
});

test('rejects a name starting or ending with a hyphen', () => {
  assert.strictEqual(validate('---\nname: -pdf\ndescription: y\n---\n').ok, false);
  assert.strictEqual(validate('---\nname: pdf-\ndescription: y\n---\n').ok, false);
});

test('rejects consecutive hyphens in a name', () => {
  const r = validate('---\nname: pdf--processing\ndescription: y\n---\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /consecutive hyphens/.test(e.msg)));
});

test('rejects a name over 64 characters', () => {
  const r = validate('---\nname: ' + 'a'.repeat(65) + '\ndescription: y\n---\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /at most 64/.test(e.msg)));
});

test('rejects a description over 1024 characters', () => {
  const r = validate('---\nname: x\ndescription: ' + 'd'.repeat(1025) + '\n---\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /at most 1024/.test(e.msg)));
});

test('rejects an over-length or empty compatibility field', () => {
  assert.strictEqual(validate('---\nname: x\ndescription: y\ncompatibility: ' + 'c'.repeat(501) + '\n---\n').ok, false);
  assert.strictEqual(validate('---\nname: x\ndescription: y\ncompatibility:\n---\n').ok, false);
});

test('accepts the spec optional fields', () => {
  const r = validate('---\nname: pdf-processing\ndescription: Extract PDF text, fill forms, merge files. Use when handling PDFs.\nlicense: Apache-2.0\ncompatibility: Requires Python 3.14+\n---\n\nRun scripts/extract.py\n');
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});

test('warns when name does not match the parent directory', () => {
  const r = validate('---\nname: other-name\ndescription: y\n---\n', { dirName: 'pdf-processing', fileName: 'SKILL.md' });
  assert.ok(r.warnings.some(w => /parent directory/.test(w.msg)), JSON.stringify(r.warnings));
});

test('warns on a duplicate section', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n# T\n\n## Notes\n\na\n\n## Notes\n\nb\n\n## Workflow Steps\n\n1. Click save\n');
  assert.ok(r.warnings.some(w => /duplicate/.test(w.msg)));
});

test('hints when a step has no action verb', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n# T\n\n## Workflow Steps\n\n1. the quarterly numbers\n');
  assert.ok(r.hints.some(h => /action verb/.test(h.msg)));
});

test('ignores ## headings inside fenced code blocks', () => {
  const r = validate('---\nname: x\ndescription: y\n---\n\n# T\n\n## Workflow Steps\n\n1. Click save\n\n## Notes\n\n```\n## Not A Section\n```\n');
  assert.ok(!r.warnings.some(w => /duplicate/.test(w.msg)));
  assert.ok(!r.hints.some(h => /Not A Section/.test(h.msg)));
});

test('preserves unknown frontmatter keys', () => {
  const { frontmatter } = parseFrontmatter('---\nname: x\ndescription: y\ncustom: keep-me\n---\n');
  assert.strictEqual(frontmatter.custom, 'keep-me');
});

console.log('examples');

test('the shipped example validates cleanly', () => {
  const p = path.join(__dirname, '..', 'examples', 'weekly-expense-report.skill.md');
  const r = validate(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  // Regression: the verb check used to read only the "### Step N: label" heading, so steps
  // whose instruction lived in the prose below it were wrongly flagged. A linter that fires
  // on correct files trains people to ignore it.
  assert.strictEqual(r.hints.length, 0, JSON.stringify(r.hints));
});

test('finds action verbs in prose under a Step heading', () => {
  const r = validate(
    '---\nname: x\ndescription: y\n---\n\n# T\n\n## Workflow Steps\n\n' +
    '### Step 1: Create a new row\n\nClick the Save button.\n'
  );
  assert.ok(!r.hints.some(h => /action verb/.test(h.msg)), JSON.stringify(r.hints));
});

test('still hints when neither heading nor prose has a verb', () => {
  const r = validate(
    '---\nname: x\ndescription: y\n---\n\n# T\n\n## Workflow Steps\n\n' +
    '### Step 1: The quarterly numbers\n\nSomething vague about them.\n'
  );
  assert.ok(r.hints.some(h => /action verb/.test(h.msg)));
});


console.log('file references');

test('ignores external URLs, anchors and absolute paths', () => {
  const refs = collectFileReferences('See [docs](https://example.com/a) and [top](#intro) and [abs](/etc/passwd)\n', 0);
  assert.deepStrictEqual(refs, []);
});

test('finds markdown links and bare scripts/ paths', () => {
  const refs = collectFileReferences('See [guide](references/REFERENCE.md).\n\nRun scripts/extract.py now.\n', 0);
  assert.deepStrictEqual(refs.map(r => r.path).sort(), ['references/REFERENCE.md', 'scripts/extract.py']);
});

test('does not read bare paths inside a fenced code block', () => {
  // The spec's own example shows scripts/extract.py inside a fence; treating that as a reference
  // would warn about illustrative snippets.
  const refs = collectFileReferences('```\nscripts/illustrative.py\n```\n', 0);
  assert.deepStrictEqual(refs, []);
});

test('warns when a referenced file is absent, and stays quiet when present', () => {
  const body = '---\nname: x\ndescription: A description long enough to be useful here\n---\n\n# T\n\nRun scripts/go.py\n';
  const missing = validate(body, { files: ['SKILL.md'] });
  assert.ok(missing.warnings.some(w => /scripts\/go\.py/.test(w.msg)), JSON.stringify(missing.warnings));
  const present = validate(body, { files: ['SKILL.md', 'scripts/go.py'] });
  assert.ok(!present.warnings.some(w => /scripts\/go\.py/.test(w.msg)), JSON.stringify(present.warnings));
});

test('does not check references at all when no file list is supplied', () => {
  // A pasted file in the browser has no directory context; warning there would be wrong.
  const r = validate('---\nname: x\ndescription: A description long enough to be useful here\n---\n\n# T\n\nRun scripts/go.py\n');
  assert.ok(!r.warnings.some(w => /not in the skill directory/.test(w.msg)));
});

test('hints on references nested more than one level deep', () => {
  const r = validate('---\nname: x\ndescription: A description long enough to be useful here\n---\n\n# T\n\nSee [d](references/deep/nested.md)\n',
    { files: ['SKILL.md', 'references/deep/nested.md'] });
  assert.ok(r.hints.some(h => /more than one level deep/.test(h.msg)), JSON.stringify(r.hints));
});

test('hints when SKILL.md exceeds the recommended 500 lines', () => {
  const long = '---\nname: x\ndescription: A description long enough to be useful here\n---\n\n# T\n' + 'prose\n'.repeat(520);
  assert.ok(validate(long).hints.some(h => /under 500/.test(h.msg)));
});

test('strips sentence punctuation from a bare path', () => {
  // "Run scripts/merge.py." must not look for a file literally named "merge.py."
  const refs = collectFileReferences('Run scripts/extract.py then scripts/merge.py.\n', 0);
  assert.deepStrictEqual(refs.map(r => r.path).sort(), ['scripts/extract.py', 'scripts/merge.py']);
});

test('a present file referenced at the end of a sentence does not warn', () => {
  const body = '---\nname: x\ndescription: A description long enough to be useful here\n---\n\n# T\n\nRun scripts/merge.py.\n';
  const r = validate(body, { files: ['SKILL.md', 'scripts/merge.py'] });
  assert.ok(!r.warnings.some(w => /not in the skill directory/.test(w.msg)), JSON.stringify(r.warnings));
});

test('does not strip a trailing paren that is part of a markdown link path', () => {
  const refs = collectFileReferences('[a](references/REF.md)\n', 0);
  assert.deepStrictEqual(refs.map(r => r.path), ['references/REF.md']);
});

console.log('real-world loading failures');

test('a UTF-8 BOM is reported as a BOM, not as missing frontmatter', () => {
  const r = validate('﻿---\nname: x\ndescription: Does a thing. Use when the user asks.\n---\n\n# T\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /byte-order mark/.test(e.msg)), JSON.stringify(r.errors));
  // The old message sent you hunting for frontmatter that was plainly there.
  assert.ok(!r.errors.some(e => /missing YAML frontmatter/.test(e.msg)), JSON.stringify(r.errors));
});

test('a tab in the frontmatter is an error (YAML forbids it, agents skip silently)', () => {
  const r = validate('---\nname: x\ndescription: Does a thing. Use when asked.\nmetadata:\n\tauthor: me\n---\n\n# T\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => /tab/.test(e.msg)), JSON.stringify(r.errors));
});

test('a frontmatter line that is not key: value warns', () => {
  const r = validate('---\nname: x\ndescription: Does a thing. Use when asked.\njust some text\n---\n\n# T\n');
  assert.ok(r.warnings.some(w => /not a "key: value" pair/.test(w.msg)), JSON.stringify(r.warnings));
});

test('a list item in the frontmatter does not trip the key: value check', () => {
  const r = validate('---\nname: x\ndescription: Does a thing. Use when asked.\ntags:\n  - one\n  - two\n---\n\n# T\n');
  assert.ok(!r.warnings.some(w => /key: value/.test(w.msg)), JSON.stringify(r.warnings));
});

test('a wrong-case filename warns — agents look for exactly SKILL.md', () => {
  const body = '---\nname: my-skill\ndescription: Does a thing. Use when the user asks.\n---\n\n# T\n';
  assert.ok(validate(body, { fileName: 'skill.md' }).warnings.some(w => /exactly "SKILL\.md"/.test(w.msg)));
  assert.ok(validate(body, { fileName: 'Skill.MD' }).warnings.some(w => /exactly "SKILL\.md"/.test(w.msg)));
  // Our own convention is deliberate and must not be flagged.
  assert.ok(!validate(body, { fileName: 'invoices.skill.md' }).warnings.some(w => /exactly/.test(w.msg)));
  assert.ok(!validate(body, { fileName: 'SKILL.md' }).warnings.some(w => /exactly/.test(w.msg)));
});

test('a double-nested skill directory warns', () => {
  const r = validate('---\nname: my-skill\ndescription: Does a thing. Use when asked.\n---\n\n# T\n',
    { fileName: 'SKILL.md', dirName: 'my-skill', parentDirName: 'my-skill' });
  assert.ok(r.warnings.some(w => /double-nested/.test(w.msg)), JSON.stringify(r.warnings));
});

test('a normal nesting does not warn about double-nesting', () => {
  const r = validate('---\nname: my-skill\ndescription: Does a thing. Use when asked.\n---\n\n# T\n',
    { fileName: 'SKILL.md', dirName: 'my-skill', parentDirName: 'skills' });
  assert.ok(!r.warnings.some(w => /double-nested/.test(w.msg)));
});

test('a description with no trigger clause gets a hint; one with it does not', () => {
  const human = validate('---\nname: x\ndescription: This skill helps with generating README files for you\n---\n\n# T\n');
  assert.ok(human.hints.some(h => /does not say WHEN/.test(h.msg)), JSON.stringify(human.hints));
  const trigger = validate('---\nname: x\ndescription: Generates README files. Use when the user asks to write or update a README.\n---\n\n# T\n');
  assert.ok(!trigger.hints.some(h => /does not say WHEN/.test(h.msg)), JSON.stringify(trigger.hints));
});

console.log(`\n${passed} passed`);
