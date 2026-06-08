#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { languageSourceExtensions, normalizeExtensions, sourceExtensionsForLanguage } from '../src/workflow-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), '..');

function usage() {
  console.log(`pi-context-workflow scaffold

Usage:
  pi-context-workflow-scaffold [--root <project-root>] [--package-path <path>] [--language <name>] [--source-extensions <list>] [--force] [--dry-run]

Options:
  --root <path>                 Target project root. Defaults to git root or current directory.
  --package-path <path>         Path added to .pi/settings.json packages. Defaults to this package root.
  --language <name>             Required unless --source-extensions is specified. Supported: ${Object.keys(languageSourceExtensions).join(', ')}.
  --source-extensions <list>    Required unless --language is specified. Comma-separated source extensions, e.g. .ts,.tsx,.py. Overrides --language.
  --force                       Overwrite managed scaffold files when they already exist.
  --dry-run                     Print planned actions without writing files.
  -h, --help                    Show this help.
`);
}

function parseArgs(argv) {
  const args = { force: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = argv[++i];
    else if (arg === '--package-path') args.packagePath = argv[++i];
    else if (arg === '--language') args.language = argv[++i];
    else if (arg === '--source-extensions') args.sourceExtensions = argv[++i];
    else if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function defaultRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function pretty(root, file) {
  return path.relative(root, file) || '.';
}

const actions = [];
function record(type, message) {
  actions.push({ type, message });
}

function ensureDir(root, dir, dryRun) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) {
    record('create-dir', dir);
    if (!dryRun) fs.mkdirSync(full, { recursive: true });
  }
}

function writeFile(root, relativePath, content, { force, dryRun }) {
  const full = path.join(root, relativePath);
  ensureDir(root, path.dirname(relativePath), dryRun);
  if (fs.existsSync(full) && !force) {
    record('skip', `${relativePath} already exists`);
    return;
  }
  record(fs.existsSync(full) ? 'overwrite' : 'create', relativePath);
  if (!dryRun) fs.writeFileSync(full, content, 'utf8');
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON: ${file}: ${error.message}`);
  }
}

function writeJson(root, relativePath, value, dryRun) {
  const full = path.join(root, relativePath);
  ensureDir(root, path.dirname(relativePath), dryRun);
  record(fs.existsSync(full) ? 'update' : 'create', relativePath);
  if (!dryRun) fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function mergePiSettings(root, packagePath, dryRun) {
  const relativePath = path.join('.pi', 'settings.json');
  const full = path.join(root, relativePath);
  const settings = readJson(full, {});
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  if (!packages.includes(packagePath)) packages.push(packagePath);
  settings.packages = packages;
  writeJson(root, relativePath, settings, dryRun);
}

function resolveSourceExtensions(options) {
  if (options.sourceExtensions) {
    return normalizeExtensions(options.sourceExtensions.split(','));
  }
  if (options.language) {
    const preset = sourceExtensionsForLanguage(options.language);
    if (!preset) {
      throw new Error(`Unsupported language: ${options.language}. Supported: ${Object.keys(languageSourceExtensions).join(', ')}`);
    }
    return preset;
  }
  throw new Error('Either --language or --source-extensions is required. Example: --language typescript');
}

function scaffold(root, options) {
  const packagePath = path.resolve(options.packagePath ?? packageRoot);
  const sourceExtensions = resolveSourceExtensions(options);

  mergePiSettings(root, packagePath, options.dryRun);

  writeFile(root, path.join('.pi', 'metrics', '.gitignore'), '*\n!.gitignore\n', options);

  writeFile(root, path.join('.pi', 'context-workflow.json'), `${JSON.stringify({
  source: {
    extensions: sourceExtensions,
  },
  adr: {
    enabled: true,
    branchIgnorePatterns: ['^main$', '^master$', '^develop$'],
    strongSignals: [
      { name: 'architecture docs', patterns: ['^docs/architecture\\.md$', '^docs/.*/architecture.*\\.md$', '^docs/data-design\\.md$'] },
      { name: 'package/dependency changes', patterns: ['^Package\\.swift$', '^package\\.json$', '^pyproject\\.toml$', '^Cargo\\.toml$', '^go\\.mod$', '^pom\\.xml$', '^build\\.gradle', '^Gemfile$'] },
      { name: 'migration changes', patterns: ['Migration', 'Migrations', 'migrations'] },
      { name: 'auth/oauth/security/storage areas', patterns: ['auth', 'oauth', 'oidc', 'security', 'storage', 'persistence', 'redis', 'dynamodb'] },
      { name: 'public route/api changes', patterns: ['routes?\\.swift$', 'Controller', 'Route', 'OpenAPI', 'api', 'router', 'routes'] },
    ],
  },
  bugMemory: {
    enforce: true,
    branchPatterns: ['(^|[\\\\/_-])(fix|bugfix|hotfix|bug|regression)([\\\\/_-]|$)'],
  },
}, null, 2)}
`, options);


  writeFile(root, path.join('docs', 'specs', 'README.md'), `# Specs

Area-level specs for this project.

## Rules

1. Read the related area spec before editing source files.
2. Add or update an area spec when behavior, constraints, flows, storage, security, or test perspectives change.
3. Do not create one spec per source file mechanically.
4. Keep local type/function contracts in source documentation comments when that is enough.
5. For bug fixes, add/update \`bugs/BUG-*.md\` and update \`bug-memory.md\` index.
6. Keep \`> Trigger:\` and \`> Last updated:\` headers.

## Current specs

| Spec | Trigger | Purpose |
|---|---|---|
| \`project-setup.md\` | project setup files | Project setup and local development |
| \`bug-memory.md\` | \`BugMemory\` | Bug memory index / operating guide |
| \`bugs/BUG-*.md\` | individual bug | Reusable bug knowledge |

## Trigger meaning

\`Trigger:\` declares when an area spec should be read. It is not a 1:1 source-file documentation mapping.
`, options);

  writeFile(root, path.join('docs', 'specs', 'project-setup.md'), `# Spec: Project Setup

> Trigger: Package.swift, package.json, pyproject.toml, Cargo.toml, compose.yml, docker-compose.yml, README.md
> Last updated: ${new Date().toISOString().slice(0, 10)}

## Overview

Project setup, dependency configuration, local development, and basic build/test expectations.

## Update this spec when

- dependencies or package configuration change
- local development setup changes
- build/test command expectations change
- runtime bootstrap behavior changes
`, options);

  writeFile(root, path.join('docs', 'specs', 'bug-memory.md'), `# Spec: Bug Memory

> Trigger: BugMemory
> Last updated: ${new Date().toISOString().slice(0, 10)}

## Overview

\`bug-memory.md\` is an index and operating guide. Individual bug details live in \`docs/specs/bugs/BUG-XXX-short-title.md\`.

## When to record

- fix / bugfix / hotfix branch work
- reusable knowledge from build/test/migration/runtime debugging
- concrete prevention knowledge that helps avoid repeating the same failure

## File format

\`\`\`md
# BUG-XXX: <title>

- **Date**: YYYY-MM-DD
- **Area**:
- **Symptoms**:
- **Impact**:
- **Cause**:
- **Fix**:
- **Verification**:
- **Lesson**:
- **Related**:
\`\`\`

## Index

| ID | Title | Area | Date | File |
|---|---|---|---|---|
`, options);

  writeFile(root, path.join('docs', 'specs', 'bugs', '.gitkeep'), '', options);

  writeFile(root, path.join('docs', 'adr', 'README.md'), `# ADR

Record important design decisions, trade-offs, policy changes, and superseded decisions.

ADR creation is advisory. Use it when a branch introduces decisions that should outlive the implementation details.

## File name

\`\`\`text
ADR-XXX-short-title.md
\`\`\`

## Template

\`\`\`md
# ADR-XXX: <title>

## Status

Proposed | Accepted | Superseded

## Context

## Decision

## Consequences

## Related
\`\`\`
`, options);

  return { root, packagePath, actions };
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  const root = path.resolve(args.root ?? defaultRoot());
  const result = scaffold(root, args);
  console.log(`pi-context-workflow scaffold target: ${result.root}`);
  console.log(`package path: ${result.packagePath}`);
  for (const action of result.actions) console.log(`- ${action.type}: ${action.message}`);
  if (args.dryRun) console.log('dry-run: no files were written');
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
