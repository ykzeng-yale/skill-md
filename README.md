# skill-md

Validator and open spec for **SKILL.md** — a portable Markdown format that gives AI agents
repeatable skills.

```sh
npx skill-md validate SKILL.md
```

```
✓ examples/weekly-expense-report.skill.md — 4 steps
```

Zero dependencies, so `npx` runs instantly and it drops into CI without a toolchain.

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
npx skill-md validate SKILL.md              # one file
npx skill-md validate ./skills              # recurse for SKILL.md / *.skill.md
npx skill-md validate ./skills --strict     # warnings fail too (CI)
npx skill-md validate SKILL.md --json       # machine-readable
```

Exit codes: `0` valid · `1` problems found · `2` bad usage.

As a library:

```js
const { validate } = require('skill-md');
const res = validate(fs.readFileSync('SKILL.md', 'utf8'));
// { ok, errors, warnings, hints, stats }
```

### In CI

```yaml
- run: npx skill-md validate ./skills --strict
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
