#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validate } = require('../lib/validate.js');
const { convert } = require('../lib/convert.js');
const { convertSide } = require('../lib/side.js');
const { findSkillFiles, listSkillDirFiles } = require('../lib/find.js');

const USAGE = `skill-md — validate SKILL.md files (the portable format for AI agent skills)

Usage:
  npx skill-md validate <file...>     Validate one or more SKILL.md files
  npx skill-md validate <dir>         Validate every SKILL.md found under a directory
  npx skill-md convert <recording>    Chrome Recorder JSON or Selenium .side -> SKILL.md
  npx skill-md --version
  npx skill-md --help

Convert options:
  --name <title>        Override the skill name/title
  --out <file>          Write to a file instead of stdout
  --test <name>         .side only: which test to convert (default: the first)

Sources it understands:
  Chrome DevTools -> Recorder -> record -> export as JSON
  Selenium IDE project files (.side, plain JSON)

Options:
  --quiet     Only print problems, not per-file success lines
  --strict    Treat warnings as failures (useful in CI)
  --json      Machine-readable output

Exit codes:
  0  all files valid
  1  at least one file had errors (or warnings with --strict)
  2  bad usage / file not found

Spec: https://github.com/ykzeng-yale/skill-md/blob/main/SPEC.md
Generate one from a screen recording: https://skillforge.expert
`;

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    const pkg = require('../package.json');
    process.stdout.write(pkg.version + '\n');
    return 0;
  }

  const quiet = args.includes('--quiet');
  const strict = args.includes('--strict');
  const asJson = args.includes('--json');
  const positional = args.filter(a => !a.startsWith('-'));

  const cmd = positional[0];

  if (cmd === 'convert') {
    const src = positional[1];
    if (!src) { process.stderr.write('convert: no recording given\n'); return 2; }
    if (!fs.existsSync(src)) { process.stderr.write(`not found: ${src}\n`); return 2; }
    let recording;
    try {
      recording = JSON.parse(fs.readFileSync(src, 'utf8'));
    } catch (err) {
      process.stderr.write(`convert: ${src} is not valid JSON (${err.message})\n`);
      return 2;
    }
    const nameIdx = args.indexOf('--name');
    const outIdx = args.indexOf('--out');
    const testIdx = args.indexOf('--test');
    const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
    // Detect by shape rather than extension: a .side project has a tests[] array, a Chrome
    // Recorder export has steps[]. Files get renamed; their contents do not change.
    const isSide = Array.isArray(recording.tests);
    let res;
    try {
      res = isSide
        ? convertSide(recording, { name, test: testIdx !== -1 ? args[testIdx + 1] : undefined })
        : convert(recording, { name });
    } catch (err) {
      process.stderr.write(`convert: ${err.message}\n`);
      return 2;
    }
    if (isSide && res.stats.available && res.stats.available.length > 1 && testIdx === -1) {
      process.stderr.write(`convert: project has ${res.stats.available.length} tests, converted "${res.stats.test}". Use --test to pick another: ${res.stats.available.join(', ')}\n`);
    }
    // A recording that yielded nothing usable must fail loudly rather than write a skill with no
    // steps. The validator no longer treats steplessness as an error (a prose skill is
    // conformant), so convert enforces it here instead — for a CONVERSION it really is a failure.
    if (res.stats.kept === 0) {
      process.stderr.write('convert: no usable steps in that recording — refusing to write an empty skill\n');
      return 1;
    }
    // Never emit a file our own validator would reject.
    const check = validate(res.markdown);
    if (!check.ok) {
      process.stderr.write('convert: produced an invalid SKILL.md (this is a bug, please report):\n');
      for (const e of check.errors) process.stderr.write(`    error line ${e.line}: ${e.msg}\n`);
      return 1;
    }
    if (outIdx !== -1 && args[outIdx + 1]) {
      fs.writeFileSync(args[outIdx + 1], res.markdown);
      process.stderr.write(`wrote ${args[outIdx + 1]} — ${res.stats.kept} steps (${res.stats.dropped} omitted${res.stats.assertions ? `, ${res.stats.assertions} assertions dropped` : ''})\n`);
    } else {
      process.stdout.write(res.markdown);
      process.stderr.write(`${res.stats.kept} steps (${res.stats.dropped} omitted${res.stats.assertions ? `, ${res.stats.assertions} assertions dropped` : ''})\n`);
    }
    return 0;
  }

  if (cmd !== 'validate') {
    process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
    return 2;
  }

  const targets = positional.slice(1);
  if (targets.length === 0) {
    process.stderr.write('validate: no files given\n');
    return 2;
  }

  let files = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) {
      process.stderr.write(`not found: ${t}\n`);
      return 2;
    }
    files = files.concat(findSkillFiles(t));
  }

  if (files.length === 0) {
    process.stderr.write('no SKILL.md files found\n');
    return 2;
  }

  const results = [];
  let failed = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // Context for the spec rules we can only check on disk: the name must match the parent
    // directory, and referenced scripts/ and references/ files must actually exist.
    const res = validate(text, {
      dirName: path.basename(path.dirname(path.resolve(file))),
      fileName: path.basename(file),
      files: listSkillDirFiles(file),
    });
    results.push({ file, ...res });

    const bad = !res.ok || (strict && res.warnings.length > 0);
    if (bad) failed++;
    if (asJson) continue;

    if (bad) {
      process.stdout.write(`\n✗ ${file}\n`);
    } else if (!quiet) {
      const extra = res.warnings.length ? ` (${res.warnings.length} warning${res.warnings.length > 1 ? 's' : ''})` : '';
      process.stdout.write(`✓ ${file} — ${res.stats.steps} steps${extra}\n`);
    }

    const show = (items, label) => {
      for (const it of items) process.stdout.write(`    ${label} line ${it.line}: ${it.msg}\n`);
    };
    if (bad || !quiet) {
      show(res.errors, 'error');
      show(res.warnings, 'warn ');
      if (!quiet) show(res.hints, 'hint ');
    }
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: failed === 0, files: results }, null, 2) + '\n');
  } else if (files.length > 1) {
    process.stdout.write(`\n${files.length - failed}/${files.length} valid\n`);
  }

  return failed > 0 ? 1 : 0;
}

process.exit(main(process.argv));
