import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdrReminder,
  buildBugMemoryGate,
  changedBugDetailFiles,
  isBugfixBranch,
  isSourceFile,
  matchingSpecs,
  matchesAnyPattern,
  sourceExtensionsFromConfig,
  sourceExtensionsForLanguage,
  sourceSpecs,
  suggestSpecs,
  tokenize,
} from '../src/workflow-core.mjs';

const specs = [
  {
    path: 'docs/specs/user-management.md',
    name: 'user-management.md',
    triggers: ['User.swift', 'UserModel.swift', 'CreateUserTables.swift'],
    lastUpdated: '2026-06-08',
  },
  {
    path: 'docs/specs/storage-connectivity.md',
    name: 'storage-connectivity.md',
    triggers: ['Application+DynamoDB.swift', 'compose.yml'],
    lastUpdated: '2026-06-08',
  },
  {
    path: 'docs/specs/bug-memory.md',
    name: 'bug-memory.md',
    triggers: ['全ファイル（デバッグ時に参照）'],
    lastUpdated: '2026-06-08',
  },
  {
    path: 'docs/specs/bugs/BUG-001-example.md',
    name: 'BUG-001-example.md',
    triggers: [],
    lastUpdated: undefined,
  },
];

test('source extension config supports non-Swift projects', () => {
  assert.throws(() => sourceExtensionsFromConfig({}), /source\.extensions is required/);
  assert.deepEqual(sourceExtensionsFromConfig({ source: { extensions: ['ts', '.tsx', 'ts'] } }), ['.ts', '.tsx']);
  assert.deepEqual(sourceExtensionsForLanguage('python'), ['.py']);
  assert.equal(isSourceFile('src/index.ts', { source: { extensions: ['.ts', '.tsx'] } }), true);
  assert.equal(isSourceFile('Sources/App/main.swift', { source: { extensions: ['.ts', '.tsx'] } }), false);
});

test('sourceSpecs excludes bug-memory index and individual bug entries', () => {
  assert.deepEqual(
    sourceSpecs(specs).map((spec) => spec.path),
    ['docs/specs/user-management.md', 'docs/specs/storage-connectivity.md'],
  );
});

test('matchingSpecs matches by basename and path fragment', () => {
  assert.deepEqual(
    matchingSpecs(specs, 'Sources/App/Domain/User/User.swift').map((spec) => spec.path),
    ['docs/specs/user-management.md'],
  );

  assert.deepEqual(
    matchingSpecs(specs, 'Sources/App/Infrastructure/Persistence/Migrations/CreateUserTables.swift').map((spec) => spec.path),
    ['docs/specs/user-management.md'],
  );
});

test('matchingSpecs does not let bug-memory 全ファイル trigger match normal source edits', () => {
  assert.deepEqual(matchingSpecs(specs, 'Sources/App/routes.swift'), []);
});

test('suggestSpecs suggests candidate specs from file and trigger tokens', () => {
  const suggestions = suggestSpecs(specs, 'Tests/AppTests/UserDomainTests.swift').map((spec) => spec.path);

  assert.equal(suggestions[0], 'docs/specs/user-management.md');
});

test('tokenize splits camelCase and filters generic words', () => {
  assert.deepEqual(tokenize('Tests/AppTests/UserDomainTests.swift'), ['app', 'user', 'domain']);
});

test('matchesAnyPattern supports regular expressions and fallback literal matching', () => {
  assert.equal(matchesAnyPattern('docs/architecture.md', ['^docs/architecture\\.md$']), true);
  assert.equal(matchesAnyPattern('Sources/App/Auth/Login.swift', ['[invalid-regex', 'Auth']), true);
  assert.equal(matchesAnyPattern('Sources/App/User.swift', ['OAuth']), false);
});

test('isBugfixBranch uses default and project-configured branch patterns', () => {
  assert.equal(isBugfixBranch('fix/user-login'), true);
  assert.equal(isBugfixBranch('feature/user-login'), false);
  assert.equal(isBugfixBranch('support/user-login', { bugMemory: { branchPatterns: ['^support/'] } }), true);
});

test('changedBugDetailFiles finds BUG markdown entries only', () => {
  assert.deepEqual(
    changedBugDetailFiles([
      'docs/specs/bugs/BUG-001-example.md',
      'docs/specs/bugs/NOTE-example.md',
      'docs/specs/bug-memory.md',
      'Sources/App/User.swift',
    ]),
    ['docs/specs/bugs/BUG-001-example.md'],
  );
});

test('buildBugMemoryGate blocks source edits on bugfix branch until bug entry exists', () => {
  const gate = buildBugMemoryGate({
    branch: 'fix/user-login',
    changedFiles: ['Sources/App/User.swift'],
    reason: 'before_edit',
    targetPath: 'Sources/App/User.swift',
  });

  assert.ok(gate);
  assert.match(gate.message, /source を編集する前に/);
});

test('buildBugMemoryGate allows source edits after a bug entry exists', () => {
  const gate = buildBugMemoryGate({
    branch: 'fix/user-login',
    changedFiles: ['docs/specs/bugs/BUG-003-user-login.md'],
    reason: 'before_edit',
    targetPath: 'Sources/App/User.swift',
  });

  assert.equal(gate, undefined);
});

test('buildBugMemoryGate blocks commits unless bug entry and index are changed', () => {
  assert.ok(
    buildBugMemoryGate({
      branch: 'fix/user-login',
      changedFiles: ['docs/specs/bugs/BUG-003-user-login.md'],
      reason: 'before_commit',
    }),
  );

  assert.equal(
    buildBugMemoryGate({
      branch: 'fix/user-login',
      changedFiles: ['docs/specs/bugs/BUG-003-user-login.md', 'docs/specs/bug-memory.md'],
      reason: 'before_commit',
    }),
    undefined,
  );
});

test('buildBugMemoryGate can be disabled by config', () => {
  const gate = buildBugMemoryGate({
    branch: 'fix/user-login',
    changedFiles: [],
    reason: 'before_commit',
    config: { bugMemory: { enforce: false } },
  });

  assert.equal(gate, undefined);
});

test('buildAdrReminder is advisory on non-main branches and ignores main', () => {
  assert.equal(
    buildAdrReminder({ branch: 'main', changedFiles: ['Package.swift'], reason: 'before_commit' }),
    undefined,
  );

  const reminder = buildAdrReminder({
    branch: 'feature/storage',
    changedFiles: ['Package.swift'],
    reason: 'before_commit',
  });

  assert.ok(reminder);
  assert.match(reminder.message, /ADR Reminder/);
  assert.deepEqual(reminder.matchedSignals, ['package/dependency changes']);
});

test('buildAdrReminder uses project-configured strong signals', () => {
  const reminder = buildAdrReminder({
    branch: 'feature/design',
    changedFiles: ['docs/domain-model.md'],
    reason: 'manual_check',
    config: {
      adr: {
        strongSignals: [{ name: 'domain model docs', patterns: ['^docs/domain-model\\.md$'] }],
      },
    },
  });

  assert.ok(reminder);
  assert.deepEqual(reminder.matchedSignals, ['domain model docs']);
});

test('buildAdrReminder can be disabled by config', () => {
  assert.equal(
    buildAdrReminder({
      branch: 'feature/design',
      changedFiles: ['docs/domain-model.md'],
      reason: 'manual_check',
      config: { adr: { enabled: false } },
    }),
    undefined,
  );
});
