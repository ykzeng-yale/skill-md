'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { escapeData, escapeProp, bool } = require('../bin/action.js');
const { findSkillFiles, isSkillFile } = require('../lib/find.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const ACTION = path.join(__dirname, '..', 'bin', 'action.js');

const VALID = [
  '---', 'name: demo', 'description: A demo skill', '---', '',
  '# Demo', '', '## Prerequisites', '', '- A browser', '',
  '## Workflow Steps', '', '### Step 1: Open it', '', 'Navigate to example.com.', '',
].join('\n');

// Missing description, wrong section heading, numbering jumps 2 -> 4.
const INVALID = ['---', 'name: Bad Skill', 'steps: 12', '---', '# Steps', '1. Open it', '2. Click Save', '4. Done'].join('\n');

function mkdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skillmd-action-'));
}

/** Run the action and capture stdout + exit code, with a scratch step-summary file. */
function run(dir, env) {
  const summaryFile = path.join(mkdir(), 'summary.md');
  const res = { out: '', code: 0, summary: '' };
  try {
    res.out = execFileSync(process.execPath, [ACTION], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { INPUT_PATH: dir, GITHUB_STEP_SUMMARY: summaryFile }, env || {}),
    });
  } catch (err) {
    res.out = (err.stdout || '') + (err.stderr || '');
    res.code = err.status;
  }
  if (fs.existsSync(summaryFile)) res.summary = fs.readFileSync(summaryFile, 'utf8');
  return res;
}

console.log('escaping');

test('newlines are escaped so an annotation stays one line', () => {
  assert.strictEqual(escapeData('a\nb'), 'a%0Ab');
  assert.strictEqual(escapeData('100% sure'), '100%25 sure');
});

test('property values escape colons and commas that would break parsing', () => {
  assert.strictEqual(escapeProp('a:b,c'), 'a%3Ab%2Cc');
});

test('bool only accepts the string "true"', () => {
  assert.strictEqual(bool('true'), true);
  assert.strictEqual(bool('TRUE '), true);
  assert.strictEqual(bool('false'), false);
  assert.strictEqual(bool(undefined), false);
  assert.strictEqual(bool('1'), false, '"1" is not how GitHub passes booleans');
});

console.log('file discovery');

test('recognises SKILL.md and *.skill.md, case-insensitively', () => {
  assert.ok(isSkillFile('SKILL.md'));
  assert.ok(isSkillFile('skill.md'));
  assert.ok(isSkillFile('invoices.skill.md'));
  assert.ok(!isSkillFile('README.md'));
  assert.ok(!isSkillFile('skills.md'));
});

test('walks a directory and skips node_modules and dotted dirs', () => {
  const d = mkdir();
  fs.mkdirSync(path.join(d, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), VALID);
  fs.writeFileSync(path.join(d, 'skills', 'a.skill.md'), VALID);
  fs.writeFileSync(path.join(d, 'node_modules', 'pkg', 'SKILL.md'), VALID);
  fs.writeFileSync(path.join(d, '.git', 'SKILL.md'), VALID);
  const found = findSkillFiles(d).map(f => path.relative(d, f));
  assert.deepStrictEqual(found.sort(), ['SKILL.md', path.join('skills', 'a.skill.md')].sort());
});

console.log('action run');

test('a valid skill passes with exit 0 and no error annotation', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'SKILL.md'), VALID);
  const r = run(d);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(!/^::error/m.test(r.out), 'should not emit an error annotation');
  assert.ok(/1\/1 valid/.test(r.out), r.out);
});

test('an invalid skill fails with exit 1 and emits error annotations', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'SKILL.md'), INVALID);
  const r = run(d);
  assert.strictEqual(r.code, 1);
  assert.ok(/::error file=.*SKILL\.md,line=\d+/.test(r.out), r.out);
  assert.ok(/missing required key/.test(r.out), r.out);
});

test('annotations carry the file path so they land on the right diff', () => {
  const d = mkdir();
  fs.mkdirSync(path.join(d, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(d, 'nested', 'SKILL.md'), INVALID);
  const r = run(d);
  assert.ok(r.out.includes('nested'), 'annotation should reference the nested path');
});

test('warnings do not fail the run by default', () => {
  const d = mkdir();
  // Valid, but "Bad Name" is not slug-safe -> warning, and no H1 -> warning.
  fs.writeFileSync(path.join(d, 'SKILL.md'),
    ['---', 'name: Bad Name', 'description: ok', '---', '## Workflow Steps', '', '1. Click Save'].join('\n'));
  const r = run(d);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(/^::warning/m.test(r.out), 'warnings should still be annotated');
});

test('strict turns warnings into a failure', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'SKILL.md'),
    ['---', 'name: Bad Name', 'description: ok', '---', '## Workflow Steps', '', '1. Click Save'].join('\n'));
  assert.strictEqual(run(d, { INPUT_STRICT: 'true' }).code, 1);
  assert.strictEqual(run(d, { INPUT_FAIL_ON_WARNINGS: 'true' }).code, 1);
});

test('an empty repo is not a failure', () => {
  const r = run(mkdir());
  assert.strictEqual(r.code, 0);
  assert.ok(/::notice::No SKILL\.md files found/.test(r.out), r.out);
});

test('a missing path is a failure, not a crash', () => {
  const r = run(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now()));
  assert.strictEqual(r.code, 1);
  assert.ok(/path not found/.test(r.out), r.out);
});

test('writes a job summary table', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'SKILL.md'), VALID);
  const r = run(d);
  assert.ok(/### SKILL\.md validation/.test(r.summary), r.summary);
  assert.ok(/\| File \| Result \| Steps \|/.test(r.summary), r.summary);
  assert.ok(/✅ valid/.test(r.summary), r.summary);
});

test('reports a mixed repo accurately', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'SKILL.md'), VALID);
  fs.mkdirSync(path.join(d, 'two'), { recursive: true });
  fs.writeFileSync(path.join(d, 'two', 'SKILL.md'), INVALID);
  const r = run(d);
  assert.strictEqual(r.code, 1);
  assert.ok(/1\/2 valid/.test(r.out), r.out);
});

test('the action agrees with the CLI on validity', () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, 'SKILL.md'), INVALID);
  const actionCode = run(d).code;
  let cliCode = 0;
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'validate', d], { encoding: 'utf8' });
  } catch (err) { cliCode = err.status; }
  assert.strictEqual(actionCode, cliCode, 'action and CLI must not disagree about pass/fail');
});

console.log(`\n${passed} passed`);
