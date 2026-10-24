# SKILL.md Specification

Version 0.1 · status: draft, in production use

A **SKILL.md** file describes one repeatable task precisely enough that an AI agent can perform
it again. It is plain Markdown with YAML frontmatter, so it is readable by a human, diffable in
git, and consumable by any agent that can read a file.

## Why a file and not a prompt

A prompt is a request; a SKILL.md is a procedure. Prompts drift between runs and between models.
A SKILL.md pins the steps, so the same file produces the same behavior across different agents,
and a change to the procedure shows up as a diff rather than as unexplained new behavior.

## File shape

````markdown
---
name: weekly-expense-report
description: Copy last week's card charges from the bank export into the Finance Notion DB
---

# Weekly Expense Report

> Recorded: 2026-03-14T09:12:00Z
> Platform: macOS

## Description

Pull the previous week's transactions and file them as Notion rows.

## Prerequisites

- Google Chrome
- Notion (logged in)

## Workflow Steps

### Step 1: Open the Finance database

Navigate to notion.so → Finance → Expense DB.

### Step 2: Create the row

Click "New", then set Date to the charge date.

## Notes

Skip refunds; they are reconciled separately.
````

## Frontmatter

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | Stable identifier. Prefer slug-safe (`a-z0-9-`) — some runtimes use it as a directory name. |
| `description` | yes | One sentence on what the skill accomplishes. Agents use this to decide whether the skill applies. |
| `apps` | no | Applications involved, e.g. `[Chrome, Notion]`. |
| `version` | no | Author-managed version of the procedure. |

Unknown keys are allowed and must be preserved by tools that rewrite the file.

## Sections

`## Workflow Steps` is the only **required** section — a skill with no steps cannot be replayed.
`## Steps` is accepted as an alias.

Recognized sections: `Description`, `Prerequisites`, `Workflow Steps`, `Usage`, `Notes`, `Metadata`.
Other `##` sections are permitted but agents may ignore them.

## Steps

Two forms are valid:

- `### Step <n>: <intent>` — what SkillForge emits; allows prose under each step.
- `<n>. <intent>` — an ordered list, convenient when hand-writing.

Rules:

1. Steps are numbered from 1 and must be **sequential**. A gap usually means an edit dropped a
   step, and an agent replaying in order would silently skip work.
2. Each step should name a concrete action. These verbs are understood by convention:
   `click`, `double_click`, `right_click`, `type`, `key_combo`, `scroll`, `drag`, `select`,
   `navigate`, `switch_app`, `hover`, `wait`, `open`, `press`, `copy`, `paste`, `upload`,
   `download`, `set`, `enter`, `choose`.
3. Steps should be deterministic. Prefer "Click the **Save** button" over "save it somehow".

## Validation

```sh
npx github:ykzeng-yale/skill-md validate SKILL.md
npx github:ykzeng-yale/skill-md validate ./skills --strict   # recurse; fail CI on warnings too
```

Severity levels:

- **error** — the file cannot be replayed reliably (missing frontmatter, no steps). Exit 1.
- **warning** — likely a mistake (non-sequential steps, duplicate section, non-slug name).
- **hint** — advisory (no action verb in a step, missing Prerequisites).

## Compatibility

SKILL.md is deliberately agent-agnostic: it is Markdown, so nothing is locked to one vendor.
It is consumed today by personal assistants (Claude, ChatGPT, Gemini, Grok, Copilot) and by
agent frameworks (autogen, crewAI, langchain, browser-use).

## License

MIT. The format is open — implement it freely.
