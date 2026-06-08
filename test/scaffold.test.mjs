import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const scaffold = path.join(repoRoot, 'bin', 'scaffold.mjs');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-context-workflow-scaffold-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('scaffold creates workflow files and pi package settings', () => {
  const root = tempProject();

  execFileSync(process.execPath, [scaffold, '--root', root, '--package-path', '/example/pi-context-workflow'], {
    encoding: 'utf8',
  });

  const settings = readJson(path.join(root, '.pi', 'settings.json'));
  assert.deepEqual(settings.packages, ['/example/pi-context-workflow']);

  const config = readJson(path.join(root, '.pi', 'context-workflow.json'));
  assert.equal(config.adr.enabled, true);
  assert.equal(config.bugMemory.enforce, true);

  assert.equal(fs.readFileSync(path.join(root, '.pi', 'metrics', '.gitignore'), 'utf8'), '*\n!.gitignore\n');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'specs', 'README.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'specs', 'project-setup.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'specs', 'bug-memory.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'specs', 'bugs', '.gitkeep')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'adr', 'README.md')));
});

test('scaffold preserves existing files unless --force is used', () => {
  const root = tempProject();
  const specPath = path.join(root, 'docs', 'specs');
  fs.mkdirSync(specPath, { recursive: true });
  fs.writeFileSync(path.join(specPath, 'README.md'), 'custom\n');

  execFileSync(process.execPath, [scaffold, '--root', root], { encoding: 'utf8' });
  assert.equal(fs.readFileSync(path.join(specPath, 'README.md'), 'utf8'), 'custom\n');

  execFileSync(process.execPath, [scaffold, '--root', root, '--force'], { encoding: 'utf8' });
  assert.notEqual(fs.readFileSync(path.join(specPath, 'README.md'), 'utf8'), 'custom\n');
});

test('scaffold merges package path without duplicating existing settings', () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.pi'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.pi', 'settings.json'),
    JSON.stringify({ packages: ['/existing/package'], theme: 'dark' }, null, 2),
  );

  execFileSync(process.execPath, [scaffold, '--root', root, '--package-path', '/existing/package'], {
    encoding: 'utf8',
  });

  let settings = readJson(path.join(root, '.pi', 'settings.json'));
  assert.deepEqual(settings.packages, ['/existing/package']);
  assert.equal(settings.theme, 'dark');

  execFileSync(process.execPath, [scaffold, '--root', root, '--package-path', '/new/package'], {
    encoding: 'utf8',
  });

  settings = readJson(path.join(root, '.pi', 'settings.json'));
  assert.deepEqual(settings.packages, ['/existing/package', '/new/package']);
  assert.equal(settings.theme, 'dark');
});

test('dry-run does not write files', () => {
  const root = tempProject();
  const output = execFileSync(process.execPath, [scaffold, '--root', root, '--dry-run'], { encoding: 'utf8' });

  assert.match(output, /dry-run: no files were written/);
  assert.equal(fs.existsSync(path.join(root, '.pi')), false);
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});
