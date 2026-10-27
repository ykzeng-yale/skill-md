# skill-md

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

A validator for **SKILL.md** — the [Agent Skills](https://agentskills.io/specification) format —
plus converters that turn recordings you already have into one.

Conformance is the point: errors are **spec violations only**, so a valid Claude, Codex or Cursor
skill passes here. Our opinionated checks for *recorded workflow* skills (gapped step numbering,
missing action verbs, no Prerequisites) are warnings and hints, never grounds for calling a
conformant file invalid. Use `--strict` if you want them enforced.

### It checks the whole skill directory, not just the file

The spec organises a skill as a directory — `SKILL.md` plus optional `scripts/`, `references/`
and `assets/` — and says to reference those files by relative path. So when you point it at a
file on disk, it also checks that **the files you reference are actually there**:

```
✓ pdf-processing/SKILL.md — 0 steps (2 warnings)
    warn  line 8: references "references/REFERENCE.md", which is not in the skill directory
    warn  line 10: references "scripts/merge.py", which is not in the skill directory
```

That is the failure worth catching. A dangling path survives code review — it looks like a real
file — and the skill breaks mid-task when the agent tries to open it. Bare paths inside fenced
code blocks are ignored, since those are usually illustrative rather than real references.

### It catches the reasons skills silently never load

Spec conformance is not the same as *working*. These are the failures people actually hit, and
every one of them is quiet — no error, no warning, the skill simply never fires:

| What | Why it breaks |
| --- | --- |
| `skill.md` / `Skill.MD` | Agents look for exactly `SKILL.md`. Wrong case is never discovered. |
| `my-skill/my-skill/SKILL.md` | Double nesting after unzipping. Discovery finds nothing. |
| A UTF-8 BOM | The file no longer starts with `---`, so the frontmatter is not read. |
| A tab in the frontmatter | YAML forbids tabs. The block fails to parse and the skill is skipped. |
| A description written for a human | The description is a **trigger**, matched against the user's request. "This skill helps with READMEs" rarely fires; "Use when the user asks to write or update a README" does. |

The BOM one is worth singling out: the obvious message is "missing YAML frontmatter", which
sends you looking at frontmatter that is plainly correct. It now says what is actually wrong.

### Validated against published skills

Run across [anthropics/skills](https://github.com/anthropics/skills) and
[obra/superpowers](https://github.com/obra/superpowers) — 35 real files, 34 valid, no skill
wrongly reported invalid. That run found **six false positives in this tool** (unparsed YAML
block scalars, `rm -f` treated as destructive, nested paths flagged, parent-relative references
called missing, placeholder link targets, and a hint that fired on 35 of 35 files). All fixed
with regression tests. See [CORPUS.md](CORPUS.md) for the details and for the three genuine
findings in the skills themselves.

### It checks safety and portability

These checks come from the defect taxonomy in [*What Keeps Agent Skills from Being Reusable?
Evidence from 138K SKILL.md Files*](https://arxiv.org/abs/2608.08453), which found that **91.8%
of real skills carry at least one detected defect**. We implement the subset where a false
positive is unlikely and the consequence is real:

- **Hardcoded credentials** (5.8% of skills in the study) — AWS keys, GitHub/Slack/OpenAI/
  Anthropic tokens, private keys, and `password = "literal"` assignments. Skills get shared and
  committed, so a key in one travels. `$ENV_VAR`, `os.environ` and placeholders are not flagged.
- **Leaked user paths** (5.8%) — `/Users/alice/...` both exposes a username and cannot exist on
  anyone else's machine. Generic stand-ins like `/home/username` are fine.
- **Unguarded destructive commands** (4.7%) — `rm -rf` with no confirmation step. A step that
  already tells the agent to confirm first is *not* flagged; "unguarded" is the point.
- **Safety bypasses** — `--no-verify`, `git push --force`, `curl ... | sh`. `--force-with-lease`
  is the safe form and is left alone.
- **Portability hints** — OS-only commands (`pbcopy`), hardcoded model names (they get retired),
  persona redefinition ("You are a..."), and `TODO`/`FIXME` an agent will follow as written.

These are warnings and hints, so they never call a conformant file invalid — use `--strict` to
fail CI on them.

One check from the study we deliberately skip: "name repeated as H1" (44.3%). The spec is
indifferent, the harm is cosmetic, and a hint firing on half of all files teaches people to
ignore the output.

```sh
npx github:ykzeng-yale/skill-md validate SKILL.md
```

```
✓ examples/weekly-expense-report.skill.md — 4 steps
```

Zero dependencies, so `npx` runs instantly and it drops into CI without a toolchain.

> Not yet on npm, so install straight from GitHub as shown. Once published the shorter
> `npx skill-md validate` will work too.

## It can repair what it is sure about

`validate` tells you what is wrong. `fix` repairs the subset where the specification
**determines** the right answer:

```sh
npx github:ykzeng-yale/skill-md fix ./my-skill           # prints the repaired file
npx github:ykzeng-yale/skill-md fix ./skills --write     # applies it in place
```

- a UTF-8 BOM, which stops the file beginning with `---` so the frontmatter is never read
- tabs in the frontmatter, which make the YAML unparseable and the skill silently skipped
- a `name` with illegal characters, or one that does not match its parent directory
- step numbering that skips, which is usually a step someone deleted

### What it refuses to do, on purpose

**It will not write your `description`.** That is the field most skills get wrong, and it is the
one thing here a tool must not guess. The description is what an agent matches a request
against, so a plausible-sounding trigger clause invented by a fixer would make the skill fire on
the *wrong* requests — a worse failure than one that visibly fires on none, because it looks
like it is working. `fix` names what is missing and leaves the sentence to you:

```
  yours  The description does not say WHEN to use the skill, which is the most common reason a
         working skill never fires. [...] Add a clause such as "Use when the user asks to ...".
```

Same for a description over the 1,024-character limit: shortening it means deciding what
matters, which is yours to decide.

`fix` exits `0` even when it refuses things, because a refusal is a decision only the author can
make rather than a failure. `validate` is the command that gates CI; `fix` is the one that helps.

## Already recorded the flow? Convert it

You do not have to record anything new. If you have a **Chrome DevTools Recorder** export or a
**Selenium IDE** project, you already did the hard part:

```sh
npx github:ykzeng-yale/skill-md convert recording.json   # Chrome Recorder export
npx github:ykzeng-yale/skill-md convert project.side     # Selenium IDE project
```

Both run locally, upload nothing, and need no account. The source is detected by shape rather than
file extension, so renaming does not matter. For a `.side` project with several tests, the first is
converted and the rest are listed; pick one with `--test "Submit expense"`.

What it does with a Selenium project, since a test and a skill are not the same thing:

- Prefers `linkText`/`name` locators so steps read `Click "New expense"` rather than `#new-row`.
- **Drops assertions** and says so in a Notes section. A test verifies; a skill instructs. You can
  re-add a check as a Note if it matters.
- Drops scaffolding (`setWindowSize`, `executeScript`, `store*`, frame switching).
- Turns `${KEY_ENTER}` into `Press Enter`, and `label=Meals` into `Select "Meals"`.
- Carries your command comments into the step text.

## Chrome Recorder specifics

Chrome ships a recorder (DevTools → **Recorder** → record → export as JSON). If you have one of
those exports, you have a skill already — no new tooling, nothing to grant screen access to:

```sh
npx github:ykzeng-yale/skill-md convert recording.json
```

```
### Step 2: Click New

Click "New".

### Step 3: Fill in Amount

Type "48.20" into "Amount".
```

It reads Chrome's `aria/` selectors to get human labels rather than emitting `#amount-field`, drops
browser plumbing (viewport, key-up, tab close, modifier-only keypresses) because a person replaying
the task does not perform those, and re-validates its own output so it can never emit a file this
tool would reject.

`--name "My Flow"` to set the title, `--out FILE` to write to disk.

## The idea

A prompt is a request. A **SKILL.md is a procedure**.

Prompts drift between runs and between models. A SKILL.md pins the steps, so the same file
produces the same behavior across different agents — and when the procedure changes, you get a
diff instead of unexplained new behavior. It is plain Markdown: human-readable, git-diffable,
and consumable by any agent that can read a file.

```markdown
---
name: weekly-expense-report
description: Copy last week's card charges into the Finance Notion DB
---

# Weekly Expense Report

## Prerequisites

- Google Chrome
- Notion (logged in)

## Workflow Steps

### Step 1: Open the Finance database

Navigate to notion.so → Finance → Expense DB.

### Step 2: Create the row

Click "New", then set Date to the charge date.
```

Full format: **[SPEC.md](SPEC.md)**

## Why validate

Hand-edited skill files break quietly. The common failure is a dropped step: numbering goes
`1, 2, 4`, an agent replays in order, and the missing work is never noticed. The validator
catches that class of problem before an agent acts on it.

| Level | Meaning | Example |
|---|---|---|
| error | cannot be replayed | no frontmatter, no steps |
| warning | likely a mistake | non-sequential steps, duplicate section |
| hint | advisory | a step with no action verb |

## Usage

```sh
npx github:ykzeng-yale/skill-md validate SKILL.md              # one file
npx github:ykzeng-yale/skill-md validate ./skills              # recurse for SKILL.md / *.skill.md
npx github:ykzeng-yale/skill-md validate ./skills --strict     # warnings fail too (CI)
npx github:ykzeng-yale/skill-md validate SKILL.md --json       # machine-readable
npx github:ykzeng-yale/skill-md fix ./my-skill                 # print mechanical repairs
npx github:ykzeng-yale/skill-md fix ./skills --write           # apply them in place
```

Exit codes: `validate` — `0` valid · `1` problems found · `2` bad usage.
`fix` — `0` always unless usage is wrong, since a refusal is not a failure.

As a library:

```sh
npm install github:ykzeng-yale/skill-md
```

```js
const { validate } = require('skill-md');
const res = validate(fs.readFileSync('SKILL.md', 'utf8'));
// { ok, errors, warnings, hints, stats }
```

### In CI

The plain command works anywhere:

```yaml
- run: npx github:ykzeng-yale/skill-md validate ./skills --strict
```

On GitHub, prefer the action — it reports problems as **annotations on the line of the diff**
and writes a summary table, instead of burying them in a log nobody opens:

```yaml
name: Skills
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ykzeng-yale/skill-md@v1
        with:
          path: ./skills   # default: .
          strict: 'false'  # 'true' also fails on warnings
```

No `setup-node`, no `npm install` — the validator has zero dependencies and every runner
already ships Node, so the step adds no toolchain.

Inputs: `path` (file or directory, default `.`), `strict` / `fail-on-warnings` (default `false`).
Errors always fail the run; warnings only do under `strict`; hints are notices. A repo with no
skill files passes, so you can add the action before writing your first skill.

Step-level problems annotate the offending line — gapped numbering lands on the `### Step N`
heading itself. File-level ones (a missing frontmatter key, a missing section) annotate line 1,
because they are about the file rather than a place in it.

Why bother: the failure this catches is quiet. A hand-edit that leaves step numbering at
1, 2, 4 still *looks* fine in review, and an agent replaying in order skips the missing step
without complaining.

## Which agents consume it

Markdown, so nothing is vendor-locked. Used today with personal assistants (Claude, ChatGPT,
Gemini, Grok, Copilot) and agent frameworks (autogen, crewAI, langchain, browser-use).

## Writing one

Write it by hand, or generate it from a screen recording: record a workflow once at
[skillforge.expert](https://skillforge.expert) and it extracts the clicks, typing, and
navigation into a SKILL.md. Recording and extraction are free.

## Contributing

The format is intentionally small. If your agent needs something the spec cannot express,
open an issue describing the workflow — missing expressiveness is a spec bug.

## License

MIT
