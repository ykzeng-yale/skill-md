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
  // Technical skills are mostly commands, not clicks. Without these the check fired on
  // perfectly actionable steps ("Run the build", "Export the token"), and a linter that
  // complains about correct files teaches people to ignore it.
  'run', 'execute', 'export', 'install', 'launch', 'create', 'add', 'remove', 'delete',
  'save', 'submit', 'send', 'confirm', 'review', 'check', 'verify', 'update', 'search',
  'filter', 'sort', 'import', 'commit', 'push', 'pull', 'merge', 'build', 'deploy',
  'read', 'write', 'edit', 'rename', 'move', 'start', 'stop', 'restart', 'close',
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

// The spec organises a skill as a DIRECTORY — SKILL.md plus optional scripts/, references/ and
// assets/ — and says to reference those files by relative path. A reference to a file that is not
// there is a quiet failure of exactly the kind this validator exists to catch: review sees a
// plausible path, and the skill breaks when the agent tries to open it.
//
// Collected here, but resolved by the caller: this module must stay free of `fs` so the identical
// code can run in a browser. The caller passes `opts.files`.
const REFERENCE_DIRS = ['scripts', 'references', 'assets'];

/** @returns {{path: string, line: number, kind: 'link'|'path'}[]} */
function collectFileReferences(body, offset) {
  const refs = [];
  const seen = new Set();
  const lines = body.split('\n');
  let inFence = false;

  const add = (p, line, kind) => {
    let clean = String(p).trim().replace(/^\.\//, '');
    // A bare path at the end of a sentence picks up its punctuation ("run scripts/merge.py.").
    // Left in place that becomes a false "missing file" for a file that is actually there.
    // Markdown links are delimited by the closing paren, so their path is already exact.
    if (kind === 'path') clean = clean.replace(/[.,;:!?)\]}'"]+$/, '');
    if (!clean) return;
    // Skip anything that is not a relative path into the skill directory.
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return;  // http:, mailto:, etc.
    if (clean.startsWith('#') || clean.startsWith('/')) return;
    const key = clean + '@' + line;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ path: clean, line, kind });
  };

  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    const lineNo = offset + i + 2;

    // Markdown links state intent explicitly, so they are worth checking even inside a fence.
    const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
    let m;
    while ((m = linkRe.exec(line)) !== null) add(m[1], lineNo, 'link');

    // A bare path inside a fenced block is usually illustrative (the spec's own example shows
    // `scripts/extract.py` in a fence), so only read bare paths outside fences.
    if (inFence) return;
    const bareRe = new RegExp(`(?:^|[\\s"'\`(])((?:${REFERENCE_DIRS.join('|')})/[A-Za-z0-9_./-]+)`, 'g');
    while ((m = bareRe.exec(line)) !== null) add(m[1], lineNo, 'path');
  });

  return refs;
}

// Safety and portability checks, from the defect taxonomy in "What Keeps Agent Skills from Being
// Reusable? Evidence from 138K SKILL.md Files" (arXiv:2608.08453). That study found 91.8% of real
// skills carry at least one detected defect, and every one of its 31 checks is statically
// detectable. These are the subset where a false positive is unlikely and the consequence is real:
// a leaked credential, someone else's username, or a skill that only runs on the author's laptop.
//
// Unlike the file-reference check, these scan fenced code blocks too — a hardcoded key or an
// unguarded `rm -rf` lives inside a fence, which is exactly where it matters.

// Values that are obviously stand-ins rather than live secrets.
const PLACEHOLDER = /^(your|my|example|sample|changeme|placeholder|insert|redacted|dummy|fake|test|abc|foo|bar|x+|\.+|<|\{|\$|\*+)/i;

const SECRET_PATTERNS = [
  { re: /\bAKIA[0-9A-Z]{16}\b/, what: 'an AWS access key ID' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, what: 'a GitHub token' },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/, what: 'an OpenAI-style API key' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, what: 'an Anthropic API key' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, what: 'a Slack token' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, what: 'a Google API key' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'a private key' },
];

// password = "something" / api_key: something
const ASSIGNED_SECRET = /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?([^\s"'#,]{6,})["']?/i;
// A reference to an environment variable or secret store is the CORRECT pattern, not a defect.
const ENV_REFERENCE = /\$\{?[A-Z_]+\}?|process\.env|os\.environ|getenv|secrets\.|vault|keychain|\bENV\b/i;

// /Users/alice leaks a username and breaks on every other machine. Generic stand-ins are fine.
const USER_PATH = /(?:\/Users\/|\/home\/|C:\\Users\\)([A-Za-z0-9._-]+)/;
const GENERIC_USER = /^(you|your|username|user|name|me|<|\{|\$|home|admin|runner|ubuntu|root)$/i;

// A step that tells the agent to confirm first is guarded; flagging it would be noise.
const GUARDED = /\b(confirm|ask the user|ask first|verify with|are you sure|prompt the user|after checking|approval|double-check)/i;

const OS_SPECIFIC = /\b(pbcopy|pbpaste|xdg-open|clip\.exe|osascript|say\s|open\s+-a)\b/;
const MODEL_NAME = /\b(gpt-[345](?:\.\d)?[a-z-]*|o[13]-(?:mini|preview)|claude-(?:3|4|opus|sonnet|haiku)[\w.-]*|gemini-[\d.]+[\w-]*|text-davinci-\d+|llama-?[23][\w.-]*)\b/i;

/**
 * Scan the body for safety and portability defects.
 * @returns {{warnings: Array, hints: Array}}
 */
function collectDefects(body, offset) {
  const warnings = [];
  const hints = [];
  const once = new Set();
  const flagOnce = (bucket, key, line, msg) => {
    if (once.has(key)) return;
    once.add(key);
    bucket.push({ line, msg });
  };

  body.split('\n').forEach((line, i) => {
    const lineNo = offset + i + 2;

    for (const { re, what } of SECRET_PATTERNS) {
      if (re.test(line)) {
        flagOnce(warnings, 'secret:' + what, lineNo,
          `looks like ${what} hardcoded in the skill — skills get shared and committed, so read it from an environment variable instead`);
      }
    }
    const assigned = ASSIGNED_SECRET.exec(line);
    if (assigned && !PLACEHOLDER.test(assigned[2]) && !ENV_REFERENCE.test(line)) {
      flagOnce(warnings, 'assigned-secret', lineNo,
        `"${assigned[1]}" is set to a literal value here — if that is a real credential, move it to an environment variable before sharing this skill`);
    }

    const userPath = USER_PATH.exec(line);
    if (userPath && !GENERIC_USER.test(userPath[1])) {
      flagOnce(warnings, 'user-path', lineNo,
        `contains the absolute path "${userPath[0]}" — that leaks a username and will not exist on anyone else's machine`);
    }

    // "Unguarded" is the operative word: a step that already tells the agent to confirm first is
    // doing the right thing, and warning about it would be noise.
    if (/\brm\s+-[rfRF]{1,3}(?:\s|$)/.test(line) && !GUARDED.test(line)) {
      flagOnce(warnings, 'destructive', lineNo,
        'contains an unguarded "rm -rf" — an agent may run this without the judgement a person would apply; scope it to a specific path or add a confirmation step');
    }
    if (/--no-verify\b/.test(line) || /git\s+push\b[^\n]*--force(?!-with-lease)\b/.test(line) || /curl\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/.test(line)) {
      flagOnce(warnings, 'bypass', lineNo,
        'instructs the agent to bypass a safety mechanism (--no-verify, --force, or piping a download straight into a shell) — make that an explicit human decision, not a default step');
    }

    if (OS_SPECIFIC.test(line)) {
      flagOnce(hints, 'os', lineNo,
        'uses an OS-specific command, so the skill will fail on other platforms — note the requirement in frontmatter "compatibility" or offer an alternative');
    }
    if (MODEL_NAME.test(line)) {
      flagOnce(hints, 'model', lineNo,
        'names a specific model version — those are retired regularly, and a skill that hardcodes one stops working when it is');
    }
    if (/^\s*(?:#{1,6}\s*)?you are (?:a|an|the)\b/i.test(line)) {
      flagOnce(hints, 'persona', lineNo,
        'redefines the agent\'s persona ("You are a ...") — a skill is a procedure the agent carries out, and overriding its identity tends to fight the host prompt');
    }
    if (/\b(TODO|FIXME|XXX)\b/.test(line)) {
      flagOnce(hints, 'todo', lineNo, 'contains an unfinished marker (TODO/FIXME) — an agent will follow it as written');
    }
  });

  return { warnings, hints };
}

/**
 * Validate SKILL.md source text.
 * @param {string} text
 * @param {{dirName?: string, fileName?: string, files?: string[]}} [opts]
 *   files — relative paths present in the skill directory, enabling reference checks.
 * @returns {{ok: boolean, errors: Array, warnings: Array, hints: Array, stats: object}}
 */
function validate(text, opts) {
  opts = opts || {};
  const errors = [];
  const warnings = [];
  const hints = [];

  // A UTF-8 byte-order mark before the frontmatter means the file does not begin with "---", so
  // the skill is skipped. Worth its own message: without this you get "missing YAML frontmatter"
  // on a file whose frontmatter is plainly right there, and you go looking in the wrong place.
  if (typeof text === 'string' && text.charCodeAt(0) === 0xFEFF) {
    errors.push({ line: 1, msg: 'file starts with a UTF-8 byte-order mark, so it does not begin with --- and the frontmatter will not be read — save it as UTF-8 without BOM' });
    text = text.slice(1);
  }

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
      // Unzipping a downloaded skill commonly leaves skills/my-skill/my-skill/SKILL.md, and
      // discovery then finds nothing. The inner directory matching the name is the giveaway.
      if (opts.dirName && opts.parentDirName && opts.dirName === opts.parentDirName) {
        warnings.push({
          line: 1,
          msg: `this skill looks double-nested ("${opts.dirName}/${opts.dirName}/${opts.fileName || 'SKILL.md'}") — agents will not discover it; move the inner folder's contents up one level`,
        });
      }
    }
    // The filename is matched exactly when agents scan for skills, so skill.md or Skill.md is
    // never loaded. Only flag near-misses: our own *.skill.md convention is deliberate.
    if (opts.fileName && /^SKILL\.md$/i.test(opts.fileName) && opts.fileName !== 'SKILL.md') {
      warnings.push({
        line: 1,
        msg: `the file is named "${opts.fileName}" — agents look for exactly "SKILL.md" (uppercase SKILL, lowercase md), so this one is not discovered`,
      });
    }

    // Real YAML parsers reject a tab in indentation, and an agent that cannot parse the
    // frontmatter skips the skill with no message at all — the hardest failure to diagnose.
    // Our own parser is deliberately lenient, so it would otherwise hide this.
    const fmLines = text.split('\n').slice(1, endLine);
    fmLines.forEach((line, i) => {
      if (/^[ ]*\t/.test(line)) {
        errors.push({ line: i + 2, msg: 'frontmatter is indented with a tab — YAML forbids this, so the file fails to parse and the skill is skipped silently' });
      } else if (line.trim() && !line.trim().startsWith('#') && !/^\s*-\s/.test(line) && !line.includes(':')) {
        warnings.push({ line: i + 2, msg: `frontmatter line "${line.trim().slice(0, 40)}" is not a "key: value" pair — a YAML parser may reject the whole block` });
      }
    });

    const description = frontmatter.description ? String(frontmatter.description).trim() : '';
    if (description.length > DESCRIPTION_MAX) {
      errors.push({ line: 1, msg: `description is ${description.length} characters; the spec allows at most ${DESCRIPTION_MAX}` });
    } else if (description && description.length < 30) {
      // The routing signal an agent matches against. The 138K-file study used 30 characters as the
      // threshold and found 52.3% of real skills below it.
      hints.push({ line: 1, msg: `description is only ${description.length} characters — it is what an agent matches against, so say what the skill does AND when to use it` });
    } else if (description.length > 300) {
      // Well inside the spec's 1024 limit, but the same study found long descriptions dilute the
      // routing match; detail belongs in the body, which is loaded only once the skill is chosen.
      hints.push({ line: 1, msg: `description is ${description.length} characters — over about 300 it dilutes the routing match, and the detail is better placed in the body` });
    }
    // By far the most common reason a well-written skill never fires: the description was written
    // for a human ("This skill helps with READMEs") instead of as a trigger the agent can match
    // against a real request ("Use when the user asks to write or update a README").
    if (description && description.length >= 20 && !/\b(use (this )?(skill )?(when|for|if)|when the user|invoke when|trigger)\b/i.test(description)) {
      hints.push({ line: 1, msg: 'description does not say WHEN to use the skill — agents match it against the user\'s request, so add a trigger clause like "Use when the user asks to ..."' });
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

  // Referenced files. Warnings rather than errors: the spec does not forbid a dangling path, and
  // a path could legitimately be produced at run time — but it is far more often a typo or a file
  // that never got committed, and an agent only finds out mid-task.
  const references = collectFileReferences(body, endLine);
  if (Array.isArray(opts.files)) {
    const present = new Set(opts.files.map(f => String(f).replace(/^\.\//, '')));
    for (const ref of references) {
      if (!present.has(ref.path)) {
        warnings.push({
          line: ref.line,
          msg: `references "${ref.path}", which is not in the skill directory — an agent following this skill will not find it`,
        });
      }
    }
  }
  // "Keep file references one level deep from SKILL.md. Avoid deeply nested reference chains."
  for (const ref of references) {
    if (ref.path.split('/').length > 2) {
      hints.push({ line: ref.line, msg: `"${ref.path}" is more than one level deep — the spec recommends keeping references shallow` });
    }
  }

  // "Keep your main SKILL.md under 500 lines. Move detailed reference material to separate files."
  const lineCount = text.split('\n').length;
  if (lineCount > 500) {
    hints.push({ line: 1, msg: `${lineCount} lines — the spec recommends keeping SKILL.md under 500 and moving detail into references/` });
  }

  // Deliberately NOT implemented from the study: R2.4, "name repeated as H1 heading" (44.3%).
  // The spec is indifferent, the harm is cosmetic, and "# Weekly Expense Report" is a perfectly
  // readable title for weekly-expense-report. A hint that fires on nearly half of all real files
  // — including our own carefully written example — just teaches people to ignore the output.

  // Safety and portability (arXiv:2608.08453). Scans fences too, deliberately.
  const defects = collectDefects(body, endLine);
  for (const w of defects.warnings) warnings.push(w);
  for (const h of defects.hints) hints.push(h);

  return {
    ok: errors.length === 0,
    errors, warnings, hints,
    stats: {
      steps: steps.length,
      sections: sections.length,
      name: frontmatter ? frontmatter.name || null : null,
      references: references.length,
      lines: lineCount,
    },
  };
}

module.exports = {
  validate, parseFrontmatter, collectFileReferences, collectDefects,
  KNOWN_SECTIONS, ACTION_VERBS,
  NAME_MAX, DESCRIPTION_MAX, COMPATIBILITY_MAX, REFERENCE_DIRS,
};
