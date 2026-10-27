'use strict';

// Mechanically repairs a SKILL.md.
//
// Scope is deliberately narrow: this fixes defects where the correct output is DETERMINED by the
// spec, and refuses to touch anything that would require guessing what the author meant.
//
// Fixes:
//   - a UTF-8 BOM, which stops the file beginning with --- so the frontmatter is ignored entirely
//   - a `name` containing illegal characters, uppercase, consecutive/leading/trailing hyphens
//   - a `name` that does not match the parent directory (only when the directory name is known)
//   - tabs inside the YAML frontmatter, which make the block unparseable
//   - step numbering that skips or repeats
//
// Deliberately NOT fixed, because the fix is a judgement call and inventing it would be worse
// than leaving it broken:
//   - a description that does not say WHEN to use the skill. That is the single most common reason
//     a skill never fires, and the correct wording depends on what the author actually wants the
//     agent to match on. Writing a plausible trigger for them would produce a file that passes a
//     validator and matches the wrong requests, which is a worse failure than one that visibly
//     does not match at all. We flag it and leave an explicit TODO instead.
//   - missing sections, missing prerequisites, or any body content. Same reason.
//
// Returns { text, applied: [...], refused: [...] }. `applied` describes what changed, in plain
// language; `refused` describes what still needs a human and why.

function slugifyName(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')        // spaces and underscores become hyphens
    .replace(/[^a-z0-9-]/g, '')     // drop anything else the spec disallows
    .replace(/-{2,}/g, '-')         // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '')        // no leading or trailing hyphen
    .slice(0, 64);                  // spec caps name at 64 characters
}

function fix(text, opts) {
  opts = opts || {};
  const applied = [];
  const refused = [];
  let out = String(text == null ? '' : text);

  // 1. BOM. Must go first: while it is present the file does not start with `---` at all.
  if (out.charCodeAt(0) === 0xfeff) {
    out = out.slice(1);
    applied.push('Removed a UTF-8 byte-order mark. It was preventing the file from starting with ---, so the frontmatter was being ignored completely.');
  }

  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out);
  if (!fm) {
    refused.push('No YAML frontmatter found between --- lines, so there was nothing structural to repair. A skill needs at least a name and a description.');
    return { text: out, applied: applied, refused: refused };
  }

  let block = fm[1];
  const blockStart = fm.index + 4;             // just past the opening "---\n"
  const blockEnd = blockStart + block.length;

  // 2. Tabs in the frontmatter make the YAML unparseable, and the skill is skipped with no message.
  if (/\t/.test(block)) {
    block = block.replace(/\t/g, '  ');
    applied.push('Replaced tabs in the frontmatter with spaces. YAML does not permit tabs for indentation, and the whole block fails to parse when one is present.');
  }

  // 3. name: legal characters, and matching the parent directory when we know it.
  const nameLine = /^name:[ \t]*(.*)$/m.exec(block);
  if (nameLine) {
    const current = nameLine[1].trim().replace(/^['"]|['"]$/g, '');
    const dir = opts.dirName ? slugifyName(opts.dirName) : null;
    const legal = slugifyName(current);
    let target = legal;
    let why = null;

    if (dir && legal !== dir) {
      target = dir;
      why = 'to match the parent directory "' + opts.dirName + '", which the spec requires';
    } else if (legal !== current) {
      why = 'to use only lowercase letters, digits and single hyphens, as the spec requires';
    }

    if (target && target !== current) {
      if (!target) {
        refused.push('The name could not be repaired automatically because nothing legal remained after removing disallowed characters.');
      } else {
        block = block.replace(/^name:[ \t]*.*$/m, 'name: ' + target);
        applied.push('Changed name from "' + current + '" to "' + target + '" ' + (why || 'to satisfy the spec') + '.');
      }
    }
  } else {
    refused.push('No name field. It is required, and the right value is the skill directory’s name — which only you know.');
  }

  // 4. description: flag, never invent. See the note at the top of this file.
  const descLine = /^description:[ \t]*(.*)$/m.exec(block);
  if (!descLine) {
    refused.push('No description field. It is required, and it is what an agent matches against a request, so it cannot be generated for you.');
  } else {
    const desc = descLine[1].trim().replace(/^['"]|['"]$/g, '');
    const saysWhen = /\buse (this )?when\b|\bwhen the user\b|\bif the user\b|\btrigger\b/i.test(desc);
    if (desc && !saysWhen && !/^[>|]/.test(desc)) {
      refused.push('The description does not say WHEN to use the skill, which is the most common reason a working skill never fires. This is left for you on purpose: a plausible-sounding trigger written by a tool would match the wrong requests, which is worse than one that visibly matches none. Add a clause such as "Use when the user asks to …".');
    }
    if (desc.length > 1024) {
      refused.push('The description is ' + desc.length + ' characters, over the spec limit of 1024. Shortening it means deciding what matters, so it is left to you.');
    }
  }

  out = out.slice(0, blockStart) + block + out.slice(blockEnd);

  // 5. Step numbering. Renumber "### Step N:" headings sequentially from 1.
  const stepRe = /^(#{2,4}\s*Step\s*)(\d+)(\s*[:.\-])/gim;
  const seen = [];
  let m;
  while ((m = stepRe.exec(out)) !== null) seen.push(Number(m[2]));
  if (seen.length > 1) {
    const sequential = seen.every(function (n, i) { return n === i + 1; });
    if (!sequential) {
      let next = 0;
      out = out.replace(stepRe, function (whole, prefix, _num, suffix) {
        next += 1;
        return prefix + next + suffix;
      });
      applied.push('Renumbered ' + seen.length + ' steps sequentially (they read ' + seen.join(', ') + '). A gap usually means a step was deleted, so check nothing is actually missing.');
    }
  }

  return { text: out, applied: applied, refused: refused };
}

module.exports = { fix: fix, slugifyName: slugifyName };
