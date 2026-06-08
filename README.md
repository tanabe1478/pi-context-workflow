# pi-context-workflow

Project documentation/spec workflow reminders and metrics for pi.

This package is inspired by SwiftyGyaim's required spec workflow and is intended to be reused across projects.

## What it does

- Reminds before editing source files to read related area specs in `docs/specs/*.md`
- Checks area spec freshness before `git commit`
- Suggests candidate specs for unlinked source files so spec `Trigger:` lists can grow with development
- Prompts the agent to consider whether missing recommended docs are needed
- Reminds on fix/bugfix/hotfix branches to record reusable bug knowledge before commit
- Records local metrics to `.pi/metrics/context-workflow.jsonl`
- Provides commands:
  - `/spec-check`
  - `/spec-metrics`
- Provides an agent-callable tool:
  - `context_workflow_doctor`

## Recommended project docs

The extension checks for these baseline docs and prompts the agent to consider whether missing docs are needed:

```text
README.md
AGENTS.md
docs/specs/README.md
docs/specs/bug-memory.md
docs/specs/project-setup.md
```

These names are intentionally simple defaults, not hard requirements. If a project does not need one of them, the agent can decide not to create it and proceed with an explicit reason. Future versions can add project configuration.

## Documentation granularity

Specs are not meant to be 1:1 documents for source files, and the extension should not force a new spec for every file.

Use `docs/specs/` for area-level behavior, constraints, flows, storage responsibilities, security requirements, and test perspectives.
Use source documentation comments for local type/function contracts and implementation-specific details.

A spec trigger means: "when touching this file, read this area spec". It does not mean: "this spec only documents this file". If a change is local and the existing docs or code comments are enough, no new spec is required.

## How specs are discovered

By default, specs live under:

```text
docs/specs/
```

Each spec may declare triggers in the first few lines:

```md
# Spec: OAuth Authorization

> Trigger: AuthorizationController.swift, AuthorizationUseCase.swift
> Last updated: 2026-06-03
```

The extension matches edited files by basename or path fragment. Multiple files can and should point to the same area spec.

When a changed source file has no matching trigger, the extension uses a lightweight filename/path token heuristic to suggest existing candidate specs. If the file belongs to an existing area, add the file name or path fragment to that spec's `Trigger:` line. This is advisory; do not add triggers mechanically for temporary helpers or files whose behavior is local and sufficiently documented in code comments.

## Install in a project

From a project root:

```bash
pi install -l /absolute/path/to/pi-context-workflow
```

Or add to `.pi/settings.json` manually:

```json
{
  "packages": ["/absolute/path/to/pi-context-workflow"]
}
```

Then run `/reload` in pi.

## Doctor tool

For agent-driven diagnosis, ask the agent to use the tool:

```text
context_workflow_doctor
```

This lets the agent inspect the result directly instead of asking the user to paste slash-command output.

It checks:

- the extension is loaded
- Git repository root can be detected
- suggested baseline docs exist, or are consciously unnecessary
- spec files, excluding `docs/specs/README.md`, have `> Trigger:` and `> Last updated:` headers
- metrics directory is writable
- `.pi/settings.json` exists for project-scope usage

## Bug memory

`docs/specs/bug-memory.md` is treated as a bug memory index and operating guide, not as a normal area spec for every edit. Even if it has a broad trigger for human readability, the extension excludes it and `docs/specs/bugs/` entries from normal source-file matching to avoid noisy reminders.

On branches whose name indicates bug fixing (`fix`, `bugfix`, `hotfix`, `bug`, `regression`), `/spec-check` and pre-commit reminders ask the agent to decide whether reusable bug knowledge should be recorded.

Recommended structure:

```text
docs/specs/
├── bug-memory.md
└── bugs/
    ├── BUG-001-short-title.md
    └── BUG-002-another-title.md
```

`bug-memory.md` should keep the index and format. Individual bug details should live in `docs/specs/bugs/BUG-XXX-short-title.md`.

## Metrics

Metrics are written locally and should usually not be committed:

```text
.pi/metrics/context-workflow.jsonl
```

Add this to the target project's `.pi/metrics/.gitignore`:

```gitignore
*
!.gitignore
```

## Configuration

Current defaults:

- source files: `.swift`
- specs directory: `docs/specs`
- bug memory index: `docs/specs/bug-memory.md`
- bug detail directory: `docs/specs/bugs`
- metrics file: `.pi/metrics/context-workflow.jsonl`

Future versions can add project configuration.
