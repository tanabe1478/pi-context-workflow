# pi-context-workflow

Project documentation/spec workflow reminders and metrics for pi.

This package is inspired by SwiftyGyaim's required spec workflow and is intended to be reused across projects.

## What it does

- Reminds before editing source files to read related `docs/specs/*.md`
- Checks spec freshness before `git commit`
- Prompts creation of recommended project docs when missing
- Records local metrics to `.pi/metrics/context-workflow.jsonl`
- Provides commands:
  - `/spec-check`
  - `/spec-metrics`
  - `/context-workflow-doctor`

## Recommended project docs

The extension checks for these baseline docs and prompts their creation when missing:

```text
README.md
AGENTS.md
docs/specs/README.md
docs/specs/bug-memory.md
docs/specs/project-setup.md
```

These names are intentionally simple defaults. Future versions can add project configuration.

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

The extension matches edited files by basename or path fragment.

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

## Doctor command

Run this after installing or reloading the package:

```text
/context-workflow-doctor
```

It checks:

- the extension is loaded
- Git repository root can be detected
- baseline docs exist
- specs have `> Trigger:` and `> Last updated:` headers
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
