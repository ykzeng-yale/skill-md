'use strict';

// Locating skill files is shared by the CLI and the GitHub Action. It lives here so the two
// cannot disagree about what counts as a skill file — a CI run that silently checked a
// different set than `npx skill-md validate` would be worse than no CI at all.

const fs = require('fs');
const path = require('path');

/** True for SKILL.md and anything.skill.md, case-insensitively. */
function isSkillFile(name) {
  return /^SKILL\.md$/i.test(name) || /\.skill\.md$/i.test(name);
}

/**
 * Resolve a file or directory to a list of skill files.
 * A file path is returned as-is (so you can validate a deliberately odd filename);
 * a directory is walked, skipping node_modules and dotted directories.
 * @returns {string[]}
 */
function findSkillFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isSkillFile(entry.name)) out.push(full);
    }
  })(target);
  return out.sort();
}

/**
 * List the files that live alongside a SKILL.md, as relative paths, so the validator can check
 * that referenced scripts/ and references/ files actually exist. Lives here rather than in
 * validate.js because that module must stay free of `fs` to run unchanged in a browser.
 * @param {string} skillFile Path to a SKILL.md
 * @param {number} [cap] Safety limit; a skill directory should be small.
 * @returns {string[]}
 */
function listSkillDirFiles(skillFile, cap) {
  const limit = cap || 2000;
  const root = path.dirname(path.resolve(skillFile));
  const out = [];
  (function walk(dir) {
    if (out.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(root);
  return out;
}

module.exports = { findSkillFiles, isSkillFile, listSkillDirFiles };
