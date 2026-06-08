import path from 'node:path';

export const defaultSourceExtensions = ['.swift'];
export const languageSourceExtensions = {
  swift: ['.swift'],
  typescript: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  rust: ['.rs'],
  go: ['.go'],
  kotlin: ['.kt', '.kts'],
  java: ['.java'],
  ruby: ['.rb'],
};
export const defaultBugfixBranchPatterns = ['(^|[\\/_-])(fix|bugfix|hotfix|bug|regression)([\\/_-]|$)'];
export const defaultAdrBranchIgnorePatterns = ['^main$', '^master$', '^develop$', '^HEAD$'];
export const defaultAdrStrongSignals = [
  { name: 'architecture docs', patterns: ['^docs/architecture\\.md$', '^docs/.*/architecture.*\\.md$', '^docs/data-design\\.md$'] },
  { name: 'package/dependency changes', patterns: ['^Package\\.swift$', '^package\\.json$', '^pyproject\\.toml$', '^Cargo\\.toml$'] },
  { name: 'migration changes', patterns: ['Migration', 'Migrations', 'migrations'] },
  { name: 'auth/oauth/security/storage areas', patterns: ['auth', 'oauth', 'oidc', 'security', 'storage', 'persistence', 'redis', 'dynamodb'] },
  { name: 'public route/api changes', patterns: ['routes?\\.swift$', 'Controller', 'Route', 'OpenAPI', 'api'] },
];

export function matchesAnyPattern(value, patterns) {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(value);
    } catch {
      return value.includes(pattern);
    }
  });
}

export function normalizeExtensions(extensions) {
  return [...new Set(extensions.map((ext) => ext.trim()).filter(Boolean).map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)))];
}

export function sourceExtensionsFromConfig(config = {}) {
  const extensions = config.source?.extensions;
  if (!Array.isArray(extensions) || extensions.length === 0) return defaultSourceExtensions;
  return normalizeExtensions(extensions);
}

export function sourceExtensionsForLanguage(language) {
  return languageSourceExtensions[String(language).toLowerCase()];
}

export function isSourceFile(filePath, config = {}) {
  return sourceExtensionsFromConfig(config).some((ext) => filePath.endsWith(ext));
}

export function sourceSpecs(specs, options = {}) {
  const bugMemoryRelativePath = options.bugMemoryRelativePath ?? 'docs/specs/bug-memory.md';
  const bugsDirectory = options.bugsDirectory ?? 'docs/specs/bugs';
  return specs.filter((spec) => spec.path !== bugMemoryRelativePath && !spec.path.startsWith(`${bugsDirectory}/`));
}

export function matchingSpecs(specs, filePath, options = {}) {
  const base = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');
  return sourceSpecs(specs, options).filter((spec) =>
    spec.triggers.some((trigger) => {
      if (trigger === '全ファイル' || trigger.includes('全ファイル')) return true;
      return trigger === base || normalized.endsWith(trigger) || normalized.includes(trigger);
    }),
  );
}

export function tokenize(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !['swift', 'model', 'tests', 'test', 'create'].includes(token));
}

export function suggestSpecs(specs, filePath, options = {}) {
  const source = sourceSpecs(specs, options);
  const fileTokens = new Set(tokenize(filePath));
  if (fileTokens.size === 0) return [];

  return source
    .map((spec) => {
      const haystack = [spec.name, spec.path, ...spec.triggers].join(' ');
      const specTokens = new Set(tokenize(haystack));
      let score = 0;
      for (const token of fileTokens) {
        if (specTokens.has(token)) score += 1;
      }
      return { spec, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.spec);
}

export function isBugfixBranch(branch, config = {}) {
  if (!branch || branch === 'HEAD') return false;
  return matchesAnyPattern(branch, config.bugMemory?.branchPatterns ?? defaultBugfixBranchPatterns);
}

export function isIgnoredAdrBranch(branch, config = {}) {
  if (!branch) return true;
  return matchesAnyPattern(branch, config.adr?.branchIgnorePatterns ?? defaultAdrBranchIgnorePatterns);
}

export function changedBugDetailFiles(files, bugsDirectory = 'docs/specs/bugs') {
  return files.filter((file) => file.startsWith(`${bugsDirectory}/BUG-`) && file.endsWith('.md'));
}

export function buildBugMemoryGate({ branch, changedFiles, changedSourceFiles = [], targetPath, reason, config = {}, bugMemoryRelativePath = 'docs/specs/bug-memory.md', bugsDirectory = 'docs/specs/bugs' }) {
  if (config.bugMemory?.enforce === false) return undefined;
  if (!isBugfixBranch(branch, config)) return undefined;

  const bugDetails = changedBugDetailFiles(changedFiles, bugsDirectory);
  const indexChanged = changedFiles.includes(bugMemoryRelativePath);

  let message;
  if (reason === 'before_commit') {
    if (bugDetails.length === 0 || !indexChanged) {
      message = `[Bug Memory Gate] ${branch} は bugfix 系ブランチです。commit 前に ${bugsDirectory}/BUG-XXX-short-title.md の追加/更新と ${bugMemoryRelativePath} の index 更新が必要です。`;
    }
  } else if (bugDetails.length === 0) {
    message = `[Bug Memory Gate] ${branch} は bugfix 系ブランチです。source を編集する前に ${bugsDirectory}/BUG-XXX-short-title.md を作成してください。`;
  }

  if (!message) return undefined;
  return { message, branch, targetPath, changedSourceFiles };
}

export function buildAdrReminder({ branch, changedFiles, changedSourceFiles = [], reason, config = {} }) {
  if (config.adr?.enabled === false) return undefined;
  if (isIgnoredAdrBranch(branch, config)) return undefined;
  if (changedFiles.length === 0) return undefined;

  const rules = config.adr?.strongSignals ?? defaultAdrStrongSignals;
  const matchedSignals = rules
    .filter((rule) => changedFiles.some((file) => matchesAnyPattern(file, rule.patterns)))
    .map((rule) => rule.name);
  const strength = matchedSignals.length > 0 ? `特に ${matchedSignals.join(', ')} に関わる変更があります。` : '';
  const message = `[ADR Reminder] branch ${branch} で作業中です。重要な設計判断・トレードオフ・将来の制約があるなら docs/adr/ADR-XXX-title.md を作成してください。${strength} spec 更新で十分な変更なら ADR 不要と判断して進めてください。`;

  return { message, branch, changedSourceFiles, matchedSignals, reason };
}
