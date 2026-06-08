# pi-context-workflow

Project documentation/spec workflow reminders and metrics for pi.

This package is inspired by SwiftyGyaim's required spec workflow and is intended to be reused across projects.

## What it does

- Reminds before editing source files to read related area specs in `docs/specs/*.md`
- Checks area spec freshness before `git commit`
- Prompts the agent to consider whether missing recommended docs are needed
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
- metrics file: `.pi/metrics/context-workflow.jsonl`

Future versions can add project configuration.
