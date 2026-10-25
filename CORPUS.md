# Validated against published skills

A linter is only trustworthy if it behaves on real files. Before promoting this one anywhere, it
was run across two corpora of published, authoritative skills:

| Corpus | Files |
| --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) | 20 |
| [obra/superpowers](https://github.com/obra/superpowers) | 15 |

**Result: 34 of 35 valid, 3 warnings, 34 hints.** No skill was wrongly reported invalid, which is
the property that matters most — errors are reserved for spec violations, and a tool that calls
Anthropic's own skills broken would deserve to be ignored.

## What the run found in *this tool*

The first pass produced **11 warnings and 46 hints**, and most of them were our bugs, not defects
in the skills. Each is now fixed with a regression test:

- **Folded YAML block scalars were not parsed.** Several published skills write
  `description: >` with the text indented beneath. We read `>` as the entire value, which made
  the description look *one character long*, emitted bogus "not a key: value pair" warnings for
  every continuation line, and silently defeated every check that depends on the description.
  Fixing it immediately surfaced a real finding (below), which is the point.
- **`rm -f` was treated as destructive.** The pattern matched any `rm -<flags>`, so routine
  `rm -f stale.log` was flagged. Only the recursive form is now reported.
- **Nested reference paths were flagged.** A hint about references "more than one level deep"
  fired on Anthropic's `scripts/office/soffice.py`, a perfectly sane layout. The spec's line
  about keeping references one level deep concerns reference *chains*, not subdirectories. The
  check was removed, not softened.
- **Parent-relative references were reported missing.** Skill collections share material via
  `../other-skill/references/x.md`. Our directory listing covers one skill, so we cannot tell
  whether those resolve — and must not claim they are absent.
- **Placeholder link targets were treated as paths.** Template skills write `[the docs](URL)`.
- **"No numbered steps" fired on 35 of 35 files.** Real skills are mostly prose and reference
  material; the step-shaped expectation comes from screen recordings, not from the format. A hint
  that fires on everything carries no information, so the general case was dropped. The narrower
  check — a declared steps section containing no steps — remains, because that is a contradiction.

## What the run found in the skills

Reported because they are verifiable, not as criticism — both repositories are excellent, and
these are the kind of small thing a linter exists to catch:

- `anthropics/skills/skills/claude-api/SKILL.md` — the description is **1068 characters**, over
  the spec's 1024 limit. Only visible once block scalars were parsed correctly.
- `anthropics/skills/template/SKILL.md` — `name: template-skill` sits in a directory named
  `template`. The spec requires the name to match its parent directory.
- `obra/superpowers/skills/writing-skills/SKILL.md` — references `scripts/tool.sh` and
  `scripts/tool.js`, which are not present. This one is arguably instructional rather than a
  defect, since the skill is *about* writing skills; it is left flagged rather than special-cased,
  because tuning a rule to one file is how linters become useless.

## Reproducing

```sh
git clone --depth 1 https://github.com/anthropics/skills
npx github:ykzeng-yale/skill-md validate ./skills
```
