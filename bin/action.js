#!/usr/bin/env node
'use strict';

// GitHub Actions reporter for the SKILL.md validator.
//
// A plain `npx skill-md validate .` already works in CI, but its output lands in a log nobody
// opens. This wrapper emits GitHub workflow commands instead, so a problem shows up as an
// annotation on the exact line of the diff, plus a job summary table. That difference is the
// whole point: a reviewer sees "step numbering jumps 2 -> 4 on line 31" next to the change that
// caused it, rather than discovering it when an agent silently skips a step in production.
//
// Env (set by the action): INPUT_PATH, INPUT_STRICT, INPUT_FAIL_ON_WARNINGS
// Exit 0 when everything passed, 1 otherwise.

const fs = require('fs');
const { validate } = require('../lib/validate.js');
const { findSkillFiles } = require('../lib/find.js');

function bool(v) {
  return String(v == null ? '' : v).trim().toLowerCase() === 'true';
}

// Annotation messages are a single line: a raw newline would terminate the command and the rest
// would be printed as ordinary log output, losing the annotation.
function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function escapeProp(s) {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function annotate(level, file, line, msg) {
  process.stdout.write(
    `::${level} file=${escapeProp(file)},line=${line},title=${escapeProp('SKILL.md')}::${escapeData(msg)}\n`
  );
}

function summary(lines) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  try { fs.appendFileSync(target, lines.join('\n') + '\n'); } catch (_) { /* summary is best-effort */ }
}

function main() {
  const target = (process.env.INPUT_PATH || '.').trim() || '.';
  const strict = bool(process.env.INPUT_STRICT);
  // Kept separate from strict so a repo can surface warnings as annotations without failing.
  const failOnWarnings = bool(process.env.INPUT_FAIL_ON_WARNINGS) || strict;

  if (!fs.existsSync(target)) {
    annotate('error', target, 1, `path not found: ${target}`);
    return 1;
  }

  let files;
  try {
    files = findSkillFiles(target);
  } catch (err) {
    annotate('error', target, 1, `could not read ${target}: ${err.message}`);
    return 1;
  }

  if (files.length === 0) {
    // Not a failure. A repo may legitimately have no skills yet, and failing here would make the
    // action impossible to add before the first skill exists.
    process.stdout.write(`::notice::No SKILL.md files found under ${target}\n`);
    summary(['### SKILL.md validation', '', `No skill files found under \`${target}\`.`]);
    return 0;
  }

  const rows = [];
  let failed = 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const res = validate(fs.readFileSync(file, 'utf8'));
    for (const e of res.errors) annotate('error', file, e.line, e.msg);
    for (const w of res.warnings) annotate('warning', file, w.line, w.msg);
    // Hints are advisory; as notices they stay visible without colouring the run.
    for (const h of res.hints) annotate('notice', file, h.line, h.msg);

    totalErrors += res.errors.length;
    totalWarnings += res.warnings.length;
    const bad = !res.ok || (failOnWarnings && res.warnings.length > 0);
    if (bad) failed++;

    rows.push(`| \`${file}\` | ${res.ok ? (bad ? '⚠️ warnings' : '✅ valid') : '❌ invalid'} | ${res.stats.steps} | ${res.errors.length} | ${res.warnings.length} | ${res.hints.length} |`);
  }

  summary([
    '### SKILL.md validation',
    '',
    `${files.length - failed}/${files.length} file${files.length === 1 ? '' : 's'} passed` +
      (failOnWarnings ? ' (warnings treated as failures)' : ''),
    '',
    '| File | Result | Steps | Errors | Warnings | Hints |',
    '| --- | --- | --: | --: | --: | --: |',
    ...rows,
  ]);

  process.stdout.write(
    `${files.length - failed}/${files.length} valid — ${totalErrors} error(s), ${totalWarnings} warning(s)\n`
  );
  return failed > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { escapeData, escapeProp, bool };
