/**
 * Context Workflow Extension for pi
 *
 * Reusable project-scoped documentation/spec workflow reminder.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
	buildAdrReminder as coreBuildAdrReminder,
	buildBugMemoryGate as coreBuildBugMemoryGate,
	isBugfixBranch as coreIsBugfixBranch,
	isSourceFile as coreIsSourceFile,
	matchingSpecs as coreMatchingSpecs,
	matchesAnyPattern as coreMatchesAnyPattern,
	sourceSpecs as coreSourceSpecs,
	suggestSpecs as coreSuggestSpecs,
} from "../src/workflow-core.mjs";

type SpecInfo = {
	path: string;
	name: string;
	triggers: string[];
	lastUpdated?: string;
};

type Reason = "before_edit" | "before_write" | "before_commit" | "manual_check";

type Metric = {
	timestamp: string;
	event:
		| "spec_reminder"
		| "spec_freshness"
		| "spec_check"
		| "prerequisite_check"
		| "doctor_check"
		| "bug_memory_reminder"
		| "bug_memory_gate"
		| "adr_reminder";
	reason: Reason | "session_start" | "tool_doctor";
	target?: string;
	branch?: string;
	changedSourceFiles?: string[];
	matchedSpecs?: string[];
	suggestedSpecs?: string[];
	missingSpec?: boolean;
	missingPrerequisites?: string[];
	staleSpecs?: string[];
	message: string;
};

type PatternRule = {
	name: string;
	patterns: string[];
};

type WorkflowConfig = {
	source?: {
		extensions?: string[];
	};
	adr?: {
		enabled?: boolean;
		branchIgnorePatterns?: string[];
		strongSignals?: PatternRule[];
	};
	bugMemory?: {
		enforce?: boolean;
		branchPatterns?: string[];
	};
};

const defaultSourceExtensions = [".swift"];
const specsDirectory = path.join("docs", "specs");
const bugMemoryRelativePath = path.join(specsDirectory, "bug-memory.md");
const bugsDirectory = path.join(specsDirectory, "bugs");
const metricsRelativePath = path.join(".pi", "metrics", "context-workflow.jsonl");
const configRelativePath = path.join(".pi", "context-workflow.json");
const defaultBugfixBranchPatterns = ["(^|[\\/_-])(fix|bugfix|hotfix|bug|regression)([\\/_-]|$)"];
const defaultAdrBranchIgnorePatterns = ["^main$", "^master$", "^develop$", "^HEAD$"];
const defaultAdrStrongSignals: PatternRule[] = [
	{ name: "architecture docs", patterns: ["^docs/architecture\\.md$", "^docs/.*/architecture.*\\.md$", "^docs/data-design\\.md$"] },
	{ name: "package/dependency changes", patterns: ["^Package\\.swift$", "^package\\.json$", "^pyproject\\.toml$", "^Cargo\\.toml$"] },
	{ name: "migration changes", patterns: ["Migration", "Migrations", "migrations"] },
	{ name: "auth/oauth/security/storage areas", patterns: ["auth", "oauth", "oidc", "security", "storage", "persistence", "redis", "dynamodb"] },
	{ name: "public route/api changes", patterns: ["routes?\\.swift$", "Controller", "Route", "OpenAPI", "api"] },
];
const recommendedProjectDocs = [
	"README.md",
	"AGENTS.md",
	path.join("docs", "specs", "README.md"),
	path.join("docs", "specs", "bug-memory.md"),
	path.join("docs", "specs", "project-setup.md"),
];

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "context_workflow_doctor",
		label: "Context Workflow Doctor",
		description:
			"Diagnose whether pi-context-workflow is set up correctly in the current project. Use when the user asks to check context workflow setup, verify docs/spec workflow, or inspect doctor results without asking the user to paste slash-command output.",
		parameters: Type.Object({}),
		async execute() {
			const report = buildDoctorReport();
			writeMetric({
				timestamp: new Date().toISOString(),
				event: "doctor_check",
				reason: "tool_doctor",
				missingPrerequisites: report.missingPrerequisites,
				message: report.message,
			});
			return {
				content: [{ type: "text", text: report.message }],
				details: report,
			};
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const result = buildPrerequisiteReminder("session_start");
		if (result) {
			writeMetric(result.metric);
			if (ctx.hasUI) ctx.ui.notify(result.message, "info");
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "edit" || event.toolName === "write") {
			const targetPath = String((event.input as { path?: unknown }).path ?? "");
			const root = repoRoot();
			if (isSourceFile(targetPath, root)) {
				const bugGate = buildBugMemoryGate(targetPath, event.toolName === "edit" ? "before_edit" : "before_write");
				if (bugGate) {
					writeMetric(bugGate.metric);
					return { block: true, reason: bugGate.message };
				}

				const result = buildEditReminder(targetPath, event.toolName === "edit" ? "before_edit" : "before_write");
				if (result) {
					writeMetric(result.metric);
					if (ctx.hasUI) ctx.ui.notify(result.message, "warning");
				}
			}
		}

		if (event.toolName === "bash") {
			const command = String((event.input as { command?: unknown }).command ?? "");
			if (/^\s*git\s+commit\b/.test(command)) {
				const bugGate = buildBugMemoryGate(undefined, "before_commit");
				if (bugGate) {
					writeMetric(bugGate.metric);
					return { block: true, reason: bugGate.message };
				}

				const result = buildCommitReminder("before_commit");
				const bugMemory = buildBugMemoryReminder("before_commit");
				const adr = buildAdrReminder("before_commit");
				if (result) {
					writeMetric(result.metric);
					if (ctx.hasUI) ctx.ui.notify(result.message, "warning");
				}
				if (bugMemory) {
					writeMetric(bugMemory.metric);
					if (ctx.hasUI) ctx.ui.notify(bugMemory.message, "warning");
				}
				if (adr) {
					writeMetric(adr.metric);
					if (ctx.hasUI) ctx.ui.notify(adr.message, "warning");
				}
			}
		}

		return undefined;
	});

	pi.registerCommand("spec-check", {
		description: "Check recommended docs, changed source files, and related docs/specs freshness",
		handler: async (_args, ctx) => {
			const prerequisite = buildPrerequisiteReminder("manual_check");
			const result = buildCommitReminder("manual_check");
			const bugMemory = buildBugMemoryReminder("manual_check");
			const adr = buildAdrReminder("manual_check");
			if (prerequisite) writeMetric({ ...prerequisite.metric, event: "spec_check", reason: "manual_check" });
			if (result) writeMetric({ ...result.metric, event: "spec_check", reason: "manual_check" });
			if (bugMemory) writeMetric({ ...bugMemory.metric, event: "spec_check", reason: "manual_check" });
			if (adr) writeMetric({ ...adr.metric, event: "spec_check", reason: "manual_check" });

			const messages = [prerequisite?.message, result?.message, bugMemory?.message, adr?.message].filter(Boolean);
			if (messages.length > 0) {
				ctx.ui.notify(messages.join("\n\n"), "info");
			} else {
				const message = "推奨される基礎 docs は揃っています。変更された source file、または対応する spec は見つかりませんでした。";
				writeMetric({ timestamp: new Date().toISOString(), event: "spec_check", reason: "manual_check", message });
				ctx.ui.notify(message, "info");
			}
		},
	});

	pi.registerCommand("spec-metrics", {
		description: "Show context workflow metrics summary for this project",
		handler: async (_args, ctx) => {
			ctx.ui.notify(buildMetricsSummary(), "info");
		},
	});

}

function repoRoot(): string | undefined {
	try {
		return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
	} catch {
		return undefined;
	}
}

function loadConfig(root: string): WorkflowConfig {
	const configPath = path.join(root, configRelativePath);
	if (!fs.existsSync(configPath)) return {};
	try {
		return JSON.parse(fs.readFileSync(configPath, "utf8")) as WorkflowConfig;
	} catch {
		return {};
	}
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
	return coreMatchesAnyPattern(value, patterns);
}

function isIgnoredAdrBranch(branch: string | undefined, config: WorkflowConfig): boolean {
	if (!branch) return true;
	return matchesAnyPattern(branch, config.adr?.branchIgnorePatterns ?? defaultAdrBranchIgnorePatterns);
}

function isSourceFile(filePath: string, root: string | undefined = repoRoot()): boolean {
	return coreIsSourceFile(filePath, root ? loadConfig(root) : { source: { extensions: defaultSourceExtensions } });
}

function buildPrerequisiteReminder(
	reason: "session_start" | "manual_check",
): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const missing = recommendedProjectDocs.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
	if (missing.length === 0) return undefined;

	const message = `[Context Workflow] 推奨 docs が不足しています: ${missing.join(", ")}。実装前に、今回の作業に必要かを判断してください。必要なら README / AGENTS / docs/specs/README / bug-memory / project-setup などを整備し、不要なら理由を持って進めてください。`;
	return {
		message,
		metric: {
			timestamp: new Date().toISOString(),
			event: "prerequisite_check",
			reason,
			missingPrerequisites: missing,
			message,
		},
	};
}

function loadSpecs(root: string): SpecInfo[] {
	const specsDir = path.join(root, specsDirectory);
	if (!fs.existsSync(specsDir)) return [];

	return fs
		.readdirSync(specsDir)
		.filter((name) => name.endsWith(".md") && name !== "README.md")
		.map((name) => {
			const fullPath = path.join(specsDir, name);
			const content = fs.readFileSync(fullPath, "utf8");
			const head = content.split(/\r?\n/).slice(0, 8);
			const triggerLine = head.find((line) => line.startsWith("> Trigger:"));
			const updatedLine = head.find((line) => line.startsWith("> Last updated:"));
			return {
				path: path.relative(root, fullPath),
				name,
				triggers: parseTriggers(triggerLine),
				lastUpdated: updatedLine?.replace("> Last updated:", "").trim().split(/\s+/)[0],
			};
		});
}

function parseTriggers(line: string | undefined): string[] {
	if (!line) return [];
	return line
		.replace("> Trigger:", "")
		.split(/[,、]/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function sourceSpecs(specs: SpecInfo[]): SpecInfo[] {
	return coreSourceSpecs(specs, { bugMemoryRelativePath, bugsDirectory });
}

function matchingSpecs(specs: SpecInfo[], filePath: string): SpecInfo[] {
	return coreMatchingSpecs(specs, filePath, { bugMemoryRelativePath, bugsDirectory });
}

function tokenize(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 3 && !["swift", "model", "tests", "test", "create"].includes(token));
}

function suggestSpecs(specs: SpecInfo[], filePath: string): SpecInfo[] {
	return coreSuggestSpecs(specs, filePath, { bugMemoryRelativePath, bugsDirectory });
}

function buildEditReminder(
	targetPath: string,
	reason: "before_edit" | "before_write",
): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const specs = loadSpecs(root);
	const matched = specs.length === 0 ? [] : matchingSpecs(specs, targetPath);
	const matchedSpecs = matched.map((spec) => spec.path);
	const suggestions = matchedSpecs.length === 0 ? suggestSpecs(specs, targetPath).map((spec) => spec.path) : [];
	const missingSpec = matchedSpecs.length === 0;

	let message: string;
	if (specs.length === 0) {
		message = `[Spec Reminder] ${targetPath} を編集する前に、領域 spec が必要か判断してください。必要なら ${specsDirectory}/ に領域 spec を作成し、不要なら既存 docs / code comment で十分な理由を持って進めてください。`;
	} else if (missingSpec) {
		const suggestionText = suggestions.length > 0 ? ` 既存 spec に属するなら候補: ${suggestions.join(", ")}。Trigger 追加も検討してください。` : "";
		message = `[Spec Reminder] ${targetPath} に対応する領域 spec が見つかりません。新しい振る舞い・制約・テスト観点を扱うなら ${specsDirectory}/ に領域 spec を追加してください。局所的な実装詳細だけなら code comment で十分か判断してください。${suggestionText}`;
	} else {
		message = `[Spec Reminder] ${targetPath} を編集する前に ${matchedSpecs.join(", ")} を読んでください。仕様変更時は同じ作業で spec も更新してください。`;
	}

	return {
		message,
		metric: {
			timestamp: new Date().toISOString(),
			event: "spec_reminder",
			reason,
			target: targetPath,
			matchedSpecs,
			suggestedSpecs: suggestions,
			missingSpec,
			message,
		},
	};
}

function buildCommitReminder(reason: "before_commit" | "manual_check"): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const changedSourceFiles = changedFiles().filter((file) => isSourceFile(file, root));
	if (changedSourceFiles.length === 0) return undefined;

	const specs = loadSpecs(root);
	const today = new Date().toISOString().slice(0, 10);
	const checks: string[] = [];
	const matchedSpecs = new Set<string>();
	const suggestedSpecs = new Set<string>();
	const staleSpecs = new Set<string>();
	let missingSpec = false;

	if (specs.length === 0) {
		missingSpec = true;
		const message = `[Spec Freshness] Source files changed: ${changedSourceFiles.join(", ")}。今回の変更に領域 spec が必要か判断してください。必要なら ${specsDirectory}/ を作成・更新し、不要なら既存 docs / code comment で十分な理由を持って進めてください。`;
		return {
			message,
			metric: {
				timestamp: new Date().toISOString(),
				event: "spec_freshness",
				reason,
				changedSourceFiles,
				matchedSpecs: [],
				suggestedSpecs: [],
				missingSpec,
				staleSpecs: [],
				message,
			},
		};
	}

	for (const file of changedSourceFiles) {
		const matched = matchingSpecs(specs, file);
		if (matched.length === 0) {
			missingSpec = true;
			const suggestions = suggestSpecs(specs, file).map((spec) => spec.path);
			for (const spec of suggestions) suggestedSpecs.add(spec);
			const suggestionText = suggestions.length > 0 ? ` (候補: ${suggestions.join(", ")}; 必要なら Trigger に追加)` : "";
			checks.push(`${file} -> 対応specなし${suggestionText}`);
			continue;
		}
		for (const spec of matched) {
			matchedSpecs.add(spec.path);
			const stale = spec.lastUpdated === today ? "" : " (STALE)";
			if (stale) staleSpecs.add(spec.path);
			checks.push(`${file} -> ${spec.path}${stale}`);
		}
	}

	const message = `[Spec Freshness] コミット前に確認: ${checks.join("; ")}。動作仕様を変更した場合は対応する領域 spec を同じコミットで更新してください。局所的な変更だけなら spec 更新不要と判断してよいです。未紐づきファイルが既存領域に属するなら、対応 spec の Trigger 追加も検討してください。`;
	return {
		message,
		metric: {
			timestamp: new Date().toISOString(),
			event: "spec_freshness",
			reason,
			changedSourceFiles,
			matchedSpecs: [...matchedSpecs],
			suggestedSpecs: [...suggestedSpecs],
			missingSpec,
			staleSpecs: [...staleSpecs],
			message,
		},
	};
}

function currentBranch(): string | undefined {
	try {
		return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
	} catch {
		return undefined;
	}
}

function isBugfixBranch(branch: string | undefined, config: WorkflowConfig): boolean {
	return coreIsBugfixBranch(branch, config);
}

function changedBugDetailFiles(files: string[]): string[] {
	return files.filter((file) => file.startsWith(`${bugsDirectory}/BUG-`) && file.endsWith(".md"));
}

function buildBugMemoryGate(
	targetPath: string | undefined,
	reason: "before_edit" | "before_write" | "before_commit",
): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const config = loadConfig(root);
	const branch = currentBranch();
	const changed = changedFiles();
	const changedSourceFiles = changed.filter((file) => isSourceFile(file, root));
	const result = coreBuildBugMemoryGate({
		branch,
		changedFiles: changed,
		changedSourceFiles,
		targetPath,
		reason,
		config,
		bugMemoryRelativePath,
		bugsDirectory,
	});

	if (!result) return undefined;
	const message = result.message;
	return {
		message,
		metric: {
			timestamp: new Date().toISOString(),
			event: "bug_memory_gate",
			reason,
			target: targetPath,
			branch,
			changedSourceFiles,
			message,
		},
	};
}

function buildAdrReminder(reason: "before_commit" | "manual_check"): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const config = loadConfig(root);
	const branch = currentBranch();
	const changed = changedFiles();
	const changedSourceFiles = changed.filter((file) => isSourceFile(file, root));
	const result = coreBuildAdrReminder({
		branch,
		changedFiles: changed,
		changedSourceFiles,
		reason,
		config,
	});
	if (!result) return undefined;
	const message = result.message;

	return {
		message,
		metric: {
			timestamp: new Date().toISOString(),
			event: "adr_reminder",
			reason,
			branch,
			changedSourceFiles,
			message,
		},
	};
}

function buildBugMemoryReminder(
	reason: "before_commit" | "manual_check",
): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const config = loadConfig(root);
	const branch = currentBranch();
	const changed = changedFiles();
	const changedSourceFiles = changed.filter((file) => isSourceFile(file, root));
	const bugMemoryChanged = changed.some(
		(file) => file === bugMemoryRelativePath || file.startsWith(`${bugsDirectory}/`),
	);

	if (!isBugfixBranch(branch, config)) return undefined;
	if (bugMemoryChanged) return undefined;

	const message = `[Bug Memory] fix/bugfix/hotfix 系ブランチ (${branch}) で作業中です。作業完了前に、再発防止に役立つ知見があれば ${bugsDirectory}/BUG-XXX-short-title.md に記録し、${bugMemoryRelativePath} の index を更新してください。不要なら「新しい再発防止知見なし」と判断して進めてください。`;
	return {
		message,
		metric: {
			timestamp: new Date().toISOString(),
			event: "bug_memory_reminder",
			reason,
			branch,
			changedSourceFiles,
			message,
		},
	};
}

function buildDoctorReport(): { ok: boolean; missingPrerequisites: string[]; message: string } {
	const root = repoRoot();
	if (!root) {
		return {
			ok: false,
			missingPrerequisites: [],
			message: "Context workflow doctor\n- ❌ git repository root を検出できません。pi を Git repository 内で起動してください。",
		};
	}

	const lines = ["Context workflow doctor"];
	lines.push(`- ✅ extension loaded: context_workflow_doctor tool is available`);
	lines.push(`- ✅ repository root: ${root}`);

	const missingPrerequisites = recommendedProjectDocs.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
	if (missingPrerequisites.length === 0) {
		lines.push("- ✅ baseline docs: all present");
	} else {
		lines.push(`- ℹ️ suggested baseline docs missing: ${missingPrerequisites.join(", ")} (create them only if useful for this project)`);
	}

	const specsDir = path.join(root, specsDirectory);
	if (!fs.existsSync(specsDir)) {
		lines.push(`- ⚠️ specs directory missing: ${specsDirectory}`);
	} else {
		const specs = loadSpecs(root);
		lines.push(`- ✅ specs directory: ${specsDirectory} (${specs.length} spec file(s))`);
		const missingTrigger = specs.filter((spec) => spec.triggers.length === 0).map((spec) => spec.path);
		const missingUpdated = specs.filter((spec) => !spec.lastUpdated).map((spec) => spec.path);
		if (missingTrigger.length === 0) {
			lines.push("- ✅ spec triggers: all specs have > Trigger");
		} else {
			lines.push(`- ⚠️ spec triggers missing: ${missingTrigger.join(", ")}`);
		}
		if (missingUpdated.length === 0) {
			lines.push("- ✅ spec freshness headers: all specs have > Last updated");
		} else {
			lines.push(`- ⚠️ spec Last updated missing: ${missingUpdated.join(", ")}`);
		}
	}

	const metrics = metricsPath();
	if (metrics) {
		try {
			fs.mkdirSync(path.dirname(metrics), { recursive: true });
			fs.accessSync(path.dirname(metrics), fs.constants.W_OK);
			lines.push(`- ✅ metrics directory writable: ${path.relative(root, path.dirname(metrics))}`);
		} catch {
			lines.push(`- ⚠️ metrics directory is not writable: ${path.relative(root, path.dirname(metrics))}`);
		}
	}

	const workflowConfigPath = path.join(root, configRelativePath);
	if (fs.existsSync(workflowConfigPath)) {
		lines.push(`- ✅ workflow config: ${configRelativePath} present`);
	} else {
		lines.push(`- ℹ️ workflow config: ${configRelativePath} not found. Built-in defaults will be used.`);
	}

	const settingsPath = path.join(root, ".pi", "settings.json");
	if (fs.existsSync(settingsPath)) {
		lines.push("- ✅ project pi settings: .pi/settings.json present");
	} else {
		lines.push("- ℹ️ project pi settings: .pi/settings.json not found. This is OK for global installs, but project-scope install is recommended for shared workflow.");
	}

	const ok = lines.every((line) => !line.includes("⚠️") && !line.includes("❌"));
	return { ok, missingPrerequisites, message: lines.join("\n") };
}

function changedFiles(): string[] {
	const commands = [
		"git diff --cached --name-only --diff-filter=ACMR",
		"git diff --name-only --diff-filter=ACMR",
		"git ls-files --others --exclude-standard",
	];
	const files = new Set<string>();
	for (const command of commands) {
		try {
			const output = execSync(command, { encoding: "utf8" }).trim();
			for (const file of output.split(/\r?\n/).filter(Boolean)) files.add(file);
		} catch {
			// ignore
		}
	}
	return [...files];
}

function metricsPath(): string | undefined {
	const root = repoRoot();
	if (!root) return undefined;
	return path.join(root, metricsRelativePath);
}

function writeMetric(metric: Metric): void {
	const file = metricsPath();
	if (!file) return;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${JSON.stringify(metric)}\n`, "utf8");
}

function readMetrics(): Metric[] {
	const file = metricsPath();
	if (!file || !fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as Metric];
			} catch {
				return [];
			}
		});
}

function buildMetricsSummary(): string {
	const metrics = readMetrics();
	if (metrics.length === 0) return "context workflow metrics はまだありません。";

	const reminderCount = metrics.filter((m) => m.event === "spec_reminder").length;
	const freshnessCount = metrics.filter((m) => m.event === "spec_freshness").length;
	const manualCheckCount = metrics.filter((m) => m.event === "spec_check").length;
	const doctorCheckCount = metrics.filter((m) => m.event === "doctor_check").length;
	const prerequisiteCheckCount = metrics.filter((m) => m.event === "prerequisite_check").length;
	const bugMemoryReminderCount = metrics.filter((m) => m.event === "bug_memory_reminder").length;
	const bugMemoryGateCount = metrics.filter((m) => m.event === "bug_memory_gate").length;
	const adrReminderCount = metrics.filter((m) => m.event === "adr_reminder").length;
	const missingPrerequisiteCount = metrics.filter((m) => (m.missingPrerequisites ?? []).length > 0).length;
	const missingSpecCount = metrics.filter((m) => m.missingSpec).length;
	const staleSpecCount = metrics.filter((m) => (m.staleSpecs ?? []).length > 0).length;
	const last = metrics[metrics.length - 1];

	return [
		"Context workflow metrics summary",
		`- events: ${metrics.length}`,
		`- spec reminders: ${reminderCount}`,
		`- freshness checks: ${freshnessCount}`,
		`- manual checks: ${manualCheckCount}`,
		`- doctor checks: ${doctorCheckCount}`,
		`- prerequisite checks: ${prerequisiteCheckCount}`,
		`- bug memory reminders: ${bugMemoryReminderCount}`,
		`- bug memory gates: ${bugMemoryGateCount}`,
		`- ADR reminders: ${adrReminderCount}`,
		`- missing prerequisite events: ${missingPrerequisiteCount}`,
		`- missing spec events: ${missingSpecCount}`,
		`- stale spec events: ${staleSpecCount}`,
		`- last event: ${last.timestamp} ${last.event} ${last.target ?? ""}`.trim(),
	].join("\n");
}
