'use strict';

// Validator for the SKILL.md format. Zero dependencies on purpose: this has to be
// runnable via `npx skill-md` with no install step, and it gets embedded in CI.

const REQUIRED_FRONTMATTER = ['name', 'description'];
const REQUIRED_SECTIONS = ['Workflow Steps'];
const KNOWN_SECTIONS = [
  'Description',
  'Prerequisites',
  'Workflow Steps',
  'Usage',
  'Notes',
  'Metadata',
];

// Action verbs a replaying agent is expected to understand. A step that matches none
// of these still validates (it may be prose for a human), but we surface it as a hint
// because an agent probably cannot act on it deterministically.
const ACTION_VERBS = [
  'click', 'double_click', 'right_click', 'type', 'key_combo', 'scroll', 'drag',
  'select', 'navigate', 'switch_app', 'hover', 'wait', 'open', 'press', 'copy',
  'paste', 'upload', 'download', 'set', 'enter', 'choose',
];

function parseFrontmatter(text) {
  // Frontmatter must be the very first thing in the file.
  if (!text.startsWith('---')) return { frontmatter: null, body: text, endLine: 0 };
  const lines = text.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { frontmatter: null, body: text, endLine: 0, unterminated: true };

  const frontmatter = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Strip matching quotes; leave bracketed lists as-is (callers treat them as raw).
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n'), endLine: end };
}

function collectSections(body, offset) {
  const sections = [];
  const lines = body.split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    // Don't treat "## ..." inside a fenced code block as a heading.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) sections.push({ title: m[1], line: offset + i + 2 });
  });
  return sections;
}

function collectSteps(body, offset) {
  const steps = [];
  const lines = body.split('\n');
  let inFence = false;
  let inStepsSection = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) inStepsSection = /workflow steps|^steps$/i.test(h2[1].trim());
    if (!inStepsSection) return;

    // Both shapes are valid: "### Step 3: intent" (what SkillForge emits) and a plain
    // ordered list "3. intent" (what people hand-write).
    const h3 = /^###\s+Step\s+(\d+)\s*:\s*(.+?)\s*$/i.exec(line);
    if (h3) {
      steps.push({ num: Number(h3[1]), text: h3[2], line: offset + i + 2, body: [] });
      return;
    }
    const ol = /^\s*(\d+)[.)]\s+(.+?)\s*$/.exec(line);
    if (ol) {
      steps.push({ num: Number(ol[1]), text: ol[2], line: offset + i + 2, body: [] });
      return;
    }
    // Prose under a "### Step N:" heading carries the actual instruction ("Click the Save
    // button"), while the heading is often just an intent label ("Create a new row"). Attach
    // it so checks that look for concrete actions see the whole step, not only the label.
    const current = steps[steps.length - 1];
    if (current && line.trim() && !/^#{1,3}\s/.test(line)) current.body.push(line.trim());
  });
  return steps;
}

/**
 * Validate SKILL.md source text.
 * @returns {{ok: boolean, errors: Array, warnings: Array, hints: Array, stats: object}}
 */
function validate(text, opts) {
  opts = opts || {};
  const errors = [];
  const warnings = [];
  const hints = [];

  if (!text || !text.trim()) {
    return {
      ok: false,
      errors: [{ line: 1, msg: 'file is empty' }],
      warnings: [], hints: [], stats: { steps: 0, sections: 0 },
    };
  }

  const { frontmatter, body, endLine, unterminated } = parseFrontmatter(text);

  if (unterminated) {
    errors.push({ line: 1, msg: 'frontmatter opened with --- but never closed' });
  } else if (!frontmatter) {
    errors.push({ line: 1, msg: 'missing YAML frontmatter (file must start with ---)' });
  } else {
    for (const key of REQUIRED_FRONTMATTER) {
      if (!(key in frontmatter)) {
        errors.push({ line: 1, msg: `frontmatter missing required key: ${key}` });
      } else if (!String(frontmatter[key]).trim()) {
        errors.push({ line: 1, msg: `frontmatter key "${key}" is empty` });
      }
    }
    if (frontmatter.name && /[^a-z0-9-]/.test(frontmatter.name)) {
      warnings.push({
        line: 1,
        msg: `name "${frontmatter.name}" is not slug-safe (prefer lowercase, digits, hyphens) — some runtimes use it as a directory name`,
      });
    }
  }

  const sections = collectSections(body, endLine);
  const titles = sections.map(s => s.title.trim());

  for (const req of REQUIRED_SECTIONS) {
    if (!titles.some(t => t.toLowerCase() === req.toLowerCase() || /^steps$/i.test(t))) {
      errors.push({ line: 1, msg: `missing required section: ## ${req}` });
    }
  }

  if (!/^\s*#\s+\S/m.test(body)) {
    warnings.push({ line: endLine + 2, msg: 'no H1 title (# ...) after the frontmatter' });
  }

  const seen = new Set();
  for (const s of sections) {
    const key = s.title.trim().toLowerCase();
    if (seen.has(key)) warnings.push({ line: s.line, msg: `duplicate section: ## ${s.title}` });
    seen.add(key);
    if (!KNOWN_SECTIONS.some(k => k.toLowerCase() === key)) {
      hints.push({ line: s.line, msg: `unrecognized section "## ${s.title}" (not part of the spec; agents may ignore it)` });
    }
  }

  const steps = collectSteps(body, endLine);
  if (steps.length === 0) {
    errors.push({ line: 1, msg: 'no steps found — a skill with no steps cannot be replayed' });
  }

  // Steps must be sequential; a gap or repeat usually means a hand-edit dropped one,
  // and an agent replaying in order would silently skip work.
  for (let i = 0; i < steps.length; i++) {
    const expected = i + 1;
    if (steps[i].num !== expected) {
      warnings.push({
        line: steps[i].line,
        msg: `step numbering is not sequential (saw ${steps[i].num}, expected ${expected})`,
      });
      break;
    }
  }

  for (const s of steps) {
    if (s.text.length < 3) {
      warnings.push({ line: s.line, msg: `step ${s.num} has no meaningful description` });
      continue;
    }
    const lower = (s.text + ' ' + (s.body || []).join(' ')).toLowerCase();
    if (!ACTION_VERBS.some(v => lower.includes(v))) {
      hints.push({
        line: s.line,
        msg: `step ${s.num} has no recognizable action verb — an agent may not know what to do`,
      });
    }
  }

  if (!titles.some(t => /^prerequisites$/i.test(t.trim()))) {
    hints.push({ line: 1, msg: 'no ## Prerequisites section — listing required apps makes replay more reliable' });
  }

  return {
    ok: errors.length === 0,
    errors, warnings, hints,
    stats: {
      steps: steps.length,
      sections: sections.length,
      name: frontmatter ? frontmatter.name || null : null,
    },
  };
}

module.exports = { validate, parseFrontmatter, KNOWN_SECTIONS, ACTION_VERBS };
