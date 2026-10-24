# skill-md

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

Validator and open spec for **SKILL.md** — a portable Markdown format that gives AI agents
repeatable skills.

```sh
npx github:ykzeng-yale/skill-md validate SKILL.md
```

```
✓ examples/weekly-expense-report.skill.md — 4 steps
```

Zero dependencies, so `npx` runs instantly and it drops into CI without a toolchain.

> Not yet on npm, so install straight from GitHub as shown. Once published the shorter
> `npx skill-md validate` will work too.

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
```

Exit codes: `0` valid · `1` problems found · `2` bad usage.

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

```yaml
- run: npx github:ykzeng-yale/skill-md validate ./skills --strict
```

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
