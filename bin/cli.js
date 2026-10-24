#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validate } = require('../lib/validate.js');
const { convert } = require('../lib/convert.js');

const USAGE = `skill-md — validate SKILL.md files (the portable format for AI agent skills)

Usage:
  npx skill-md validate <file...>     Validate one or more SKILL.md files
  npx skill-md validate <dir>         Validate every SKILL.md found under a directory
  npx skill-md convert <recording>    Chrome DevTools Recorder JSON -> SKILL.md (stdout)
  npx skill-md --version
  npx skill-md --help

Convert options:
  --name <title>        Override the skill name/title
  --out <file>          Write to a file instead of stdout

Record a flow in Chrome: DevTools -> Recorder -> record -> export as JSON.

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

function findSkillFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^SKILL\.md$/i.test(entry.name) || /\.skill\.md$/i.test(entry.name)) out.push(full);
    }
  })(target);
  return out;
}

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
    let res;
    try {
      res = convert(recording, { name: nameIdx !== -1 ? args[nameIdx + 1] : undefined });
    } catch (err) {
      process.stderr.write(`convert: ${err.message}\n`);
      return 2;
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
      process.stderr.write(`wrote ${args[outIdx + 1]} — ${res.stats.kept} steps (${res.stats.dropped} browser-level steps omitted)\n`);
    } else {
      process.stdout.write(res.markdown);
      process.stderr.write(`${res.stats.kept} steps (${res.stats.dropped} browser-level steps omitted)\n`);
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
    const res = validate(text);
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
