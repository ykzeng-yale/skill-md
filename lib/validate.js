'use strict';

// Validator for the SKILL.md format. Zero dependencies on purpose: this has to be
// runnable via `npx skill-md` with no install step, and it gets embedded in CI.

// Conformance target: the Agent Skills specification — https://agentskills.io/specification
//
// Two rules follow from that spec and they decide what is an error here:
//   1. Only `name` and `description` are required, with hard constraints on both.
//   2. "The Markdown body after the frontmatter contains the skill instructions. There are no
//      format restrictions."
//
// So ERRORS are spec violations only. Everything we have an opinion about — numbered steps,
// action verbs, a Prerequisites section — is advisory, because a perfectly valid skill may be
// prose, or scripts, or a reference table. Those checks are still worth having: skills generated
// from a screen recording ARE step-shaped, and gapped numbering makes a replaying agent skip
// work. They are warnings and hints, not grounds for calling a conformant file invalid.
const REQUIRED_FRONTMATTER = ['name', 'description'];
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;
// Sections SkillForge-style workflow skills tend to use. Not normative, and NOT used to reject
// anything — the spec permits any body at all.
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

    // The spec's name rules are normative, and agents use the name as a directory, so a
    // violation genuinely breaks installation rather than being a style preference.
    const name = frontmatter.name ? String(frontmatter.name).trim() : '';
    if (name) {
      if (name.length > NAME_MAX) {
        errors.push({ line: 1, msg: `name is ${name.length} characters; the spec allows at most ${NAME_MAX}` });
      }
      if (/[^a-z0-9-]/.test(name)) {
        errors.push({
          line: 1,
          msg: `name "${name}" may only contain lowercase letters, digits and hyphens (spec: agentskills.io/specification)`,
        });
      } else if (name.startsWith('-') || name.endsWith('-')) {
        errors.push({ line: 1, msg: `name "${name}" must not start or end with a hyphen` });
      } else if (name.includes('--')) {
        errors.push({ line: 1, msg: `name "${name}" must not contain consecutive hyphens` });
      }
      // "Must match the parent directory name" — only checkable for a real SKILL.md on disk.
      if (opts.dirName && opts.fileName && /^SKILL\.md$/i.test(opts.fileName) && opts.dirName !== name) {
        warnings.push({
          line: 1,
          msg: `name "${name}" does not match the parent directory "${opts.dirName}" — the spec requires them to match`,
        });
      }
    }

    const description = frontmatter.description ? String(frontmatter.description).trim() : '';
    if (description.length > DESCRIPTION_MAX) {
      errors.push({ line: 1, msg: `description is ${description.length} characters; the spec allows at most ${DESCRIPTION_MAX}` });
    } else if (description && description.length < 20) {
      // The description is the routing signal an agent uses to decide whether to load the skill.
      hints.push({ line: 1, msg: 'description is very short — it is what an agent matches against, so say what the skill does AND when to use it' });
    }

    if ('compatibility' in frontmatter) {
      const compat = String(frontmatter.compatibility || '').trim();
      if (!compat) {
        errors.push({ line: 1, msg: 'compatibility is present but empty; omit it instead' });
      } else if (compat.length > COMPATIBILITY_MAX) {
        errors.push({ line: 1, msg: `compatibility is ${compat.length} characters; the spec allows at most ${COMPATIBILITY_MAX}` });
      }
    }
  }

  const sections = collectSections(body, endLine);
  const titles = sections.map(s => s.title.trim());

  const hasStepsSection = titles.some(t => /^workflow steps$/i.test(t.trim()) || /^steps$/i.test(t.trim()));

  if (!/^\s*#\s+\S/m.test(body) && body.trim()) {
    hints.push({ line: endLine + 2, msg: 'no H1 title (# ...) after the frontmatter' });
  }

  const seen = new Set();
  for (const s of sections) {
    const key = s.title.trim().toLowerCase();
    if (seen.has(key)) warnings.push({ line: s.line, msg: `duplicate section: ## ${s.title}` });
    seen.add(key);
  }

  const steps = collectSteps(body, endLine);
  if (!body.trim()) {
    // Frontmatter alone is spec-conformant, but an agent that activates it has nothing to do.
    hints.push({ line: endLine + 2, msg: 'the body is empty — an agent that loads this skill has no instructions to follow' });
  } else if (hasStepsSection && steps.length === 0) {
    // A declared steps section with nothing in it is a real contradiction, not a style choice.
    warnings.push({ line: 1, msg: 'a steps section is present but no numbered steps were found — check the heading level (### Step 1: ...) or list numbering' });
  } else if (steps.length === 0) {
    hints.push({ line: 1, msg: 'no numbered steps found — fine for a prose or reference skill, but a recorded workflow should list its steps' });
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

  // Only worth saying for step-shaped skills; a prose or reference skill has no apps to list,
  // and emitting this on every conformant file would make the hints worthless.
  if (steps.length > 0 && !titles.some(t => /^prerequisites$/i.test(t.trim()))) {
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

module.exports = {
  validate, parseFrontmatter, KNOWN_SECTIONS, ACTION_VERBS,
  NAME_MAX, DESCRIPTION_MAX, COMPATIBILITY_MAX,
};
