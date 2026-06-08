# pi-context-workflow

Project documentation/spec workflow reminders and metrics for pi.

This package is inspired by SwiftyGyaim's required spec workflow and is intended to be reused across projects.

## What it does

- Reminds before editing source files to read related area specs in `docs/specs/*.md`
- Checks area spec freshness before `git commit`
- Suggests candidate specs for unlinked source files so spec `Trigger:` lists can grow with development
- Prompts the agent to consider whether missing recommended docs are needed
- Blocks source edits / commits on fix-like branches until bug memory files are added
- Reminds on non-main branches to consider ADRs, with project-configurable strong signals
- Records local metrics to `.pi/metrics/context-workflow.jsonl`
- Provides commands:
  - `/spec-check`
  - `/spec-metrics`
- Provides an agent-callable tool:
  - `context_workflow_doctor`
- Provides a deterministic scaffold CLI:
  - `pi-context-workflow-scaffold`

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

### Scaffold recommended files

From any target project root, run:

```bash
node /absolute/path/to/pi-context-workflow/bin/scaffold.mjs
```

Or, when installed as a package/bin:

```bash
pi-context-workflow-scaffold
```

The scaffold deterministically creates or updates:

```text
.pi/settings.json
docs/specs/README.md
docs/specs/project-setup.md
docs/specs/bug-memory.md
docs/specs/bugs/.gitkeep
docs/adr/README.md
.pi/context-workflow.json
.pi/metrics/.gitignore
```

It does not overwrite existing managed docs by default. Use `--force` to overwrite and `--dry-run` to preview:

```bash
pi-context-workflow-scaffold --root /path/to/project --dry-run
pi-context-workflow-scaffold --root /path/to/project --package-path /path/to/pi-context-workflow
pi-context-workflow-scaffold --root /path/to/project --language typescript
pi-context-workflow-scaffold --root /path/to/project --source-extensions .ts,.tsx,.py
```

### Manual install

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

On branches whose name indicates bug fixing (`fix`, `bugfix`, `hotfix`, `bug`, `regression`), the extension applies a deterministic gate:

- source file edits are blocked until a changed `docs/specs/bugs/BUG-*.md` exists
- `git commit` is blocked until a changed `docs/specs/bugs/BUG-*.md` and a changed `docs/specs/bug-memory.md` index exist

This prevents bug memory from depending on LLM judgment alone.

Recommended structure:

```text
docs/specs/
├── bug-memory.md
└── bugs/
    ├── BUG-001-short-title.md
    └── BUG-002-another-title.md
```

`bug-memory.md` should keep the index and format. Individual bug details should live in `docs/specs/bugs/BUG-XXX-short-title.md`.

## ADR reminder

ADR creation is advisory, not blocking. On non-main branches, `/spec-check` and pre-commit reminders ask whether important design decisions, trade-offs, or future constraints should be recorded in `docs/adr/ADR-XXX-title.md`.

Some changes deserve a stronger reminder. Because these signals are project-specific, define them in `.pi/context-workflow.json`. If no config exists, built-in generic defaults are used.

Example:

```json
{
  "source": {
    "extensions": [".swift", ".ts", ".tsx", ".py", ".rs", ".go"]
  },
  "adr": {
    "enabled": true,
    "branchIgnorePatterns": ["^main$", "^master$", "^develop$"],
    "strongSignals": [
      { "name": "architecture docs", "patterns": ["^docs/architecture\\.md$", "^docs/data-design\\.md$"] },
      { "name": "package/dependency changes", "patterns": ["^Package\\.swift$"] },
      { "name": "migration changes", "patterns": ["Migrations", "Migration"] },
      { "name": "auth/oauth/security/storage areas", "patterns": ["auth", "oauth", "oidc", "security", "storage", "persistence"] },
      { "name": "public route/api changes", "patterns": ["routes?\\.swift$", "Controller", "Route"] }
    ]
  },
  "bugMemory": {
    "enforce": true,
    "branchPatterns": ["(^|[\\\\/_-])(fix|bugfix|hotfix|bug|regression)([\\\\/_-]|$)"]
  }
}
```

`patterns` are regular expressions matched against changed file paths or branch names.

## Testing

Run deterministic tests for the scaffold CLI and workflow core logic:

```bash
npm test
```

Covered areas include:

- scaffold file creation / merge / dry-run behavior
- spec trigger matching and candidate suggestions
- bug memory gate conditions
- ADR reminder strong-signal matching
- project config overrides

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

- source files: `.swift` by default; configurable via `.pi/context-workflow.json` `source.extensions`
- specs directory: `docs/specs`
- bug memory index: `docs/specs/bug-memory.md`
- bug detail directory: `docs/specs/bugs`
- optional project config: `.pi/context-workflow.json`
- metrics file: `.pi/metrics/context-workflow.jsonl`
