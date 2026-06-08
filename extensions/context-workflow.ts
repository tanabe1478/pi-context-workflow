/**
 * Context Workflow Extension for pi
 *
 * Reusable project-scoped documentation/spec workflow reminder.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

type SpecInfo = {
	path: string;
	name: string;
	triggers: string[];
	lastUpdated?: string;
};

type Reason = "before_edit" | "before_write" | "before_commit" | "manual_check";

type Metric = {
	timestamp: string;
	event: "spec_reminder" | "spec_freshness" | "spec_check" | "prerequisite_check" | "doctor_check";
	reason: Reason | "session_start" | "manual_doctor";
	target?: string;
	changedSourceFiles?: string[];
	matchedSpecs?: string[];
	missingSpec?: boolean;
	missingPrerequisites?: string[];
	staleSpecs?: string[];
	message: string;
};

const sourceExtensions = [".swift"];
const specsDirectory = path.join("docs", "specs");
const metricsRelativePath = path.join(".pi", "metrics", "context-workflow.jsonl");
const recommendedProjectDocs = [
	"README.md",
	"AGENTS.md",
	path.join("docs", "specs", "README.md"),
	path.join("docs", "specs", "bug-memory.md"),
	path.join("docs", "specs", "project-setup.md"),
];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const result = buildPrerequisiteReminder("session_start");
		if (result) {
			writeMetric(result.metric);
			if (ctx.hasUI) ctx.ui.notify(result.message, "warning");
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "edit" || event.toolName === "write") {
			const targetPath = String((event.input as { path?: unknown }).path ?? "");
			if (isSourceFile(targetPath)) {
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
				const result = buildCommitReminder("before_commit");
				if (result) {
					writeMetric(result.metric);
					if (ctx.hasUI) ctx.ui.notify(result.message, "warning");
				}
			}
		}

		return undefined;
	});

	pi.registerCommand("spec-check", {
		description: "Check required docs, changed source files, and related docs/specs freshness",
		handler: async (_args, ctx) => {
			const prerequisite = buildPrerequisiteReminder("manual_check");
			const result = buildCommitReminder("manual_check");
			if (prerequisite) writeMetric({ ...prerequisite.metric, event: "spec_check", reason: "manual_check" });
			if (result) writeMetric({ ...result.metric, event: "spec_check", reason: "manual_check" });

			const messages = [prerequisite?.message, result?.message].filter(Boolean);
			if (messages.length > 0) {
				ctx.ui.notify(messages.join("\n\n"), "info");
			} else {
				const message = "必要な基礎 docs は揃っています。変更された source file、または対応する spec は見つかりませんでした。";
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

	pi.registerCommand("context-workflow-doctor", {
		description: "Diagnose whether pi-context-workflow is set up correctly in this project",
		handler: async (_args, ctx) => {
			const report = buildDoctorReport();
			writeMetric({
				timestamp: new Date().toISOString(),
				event: "doctor_check",
				reason: "manual_doctor",
				missingPrerequisites: report.missingPrerequisites,
				message: report.message,
			});
			ctx.ui.notify(report.message, report.ok ? "info" : "warning");
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

function isSourceFile(filePath: string): boolean {
	return sourceExtensions.some((ext) => filePath.endsWith(ext));
}

function buildPrerequisiteReminder(
	reason: "session_start" | "manual_check",
): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const missing = recommendedProjectDocs.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
	if (missing.length === 0) return undefined;

	const message = `[Context Workflow] 推奨 docs が不足しています: ${missing.join(", ")}。実装前に README / AGENTS / docs/specs/README / bug-memory / project-setup を整備してください。`;
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

function matchingSpecs(specs: SpecInfo[], filePath: string): SpecInfo[] {
	const base = path.basename(filePath);
	const normalized = filePath.replace(/\\/g, "/");
	return specs.filter((spec) =>
		spec.triggers.some((trigger) => {
			if (trigger === "全ファイル" || trigger.includes("全ファイル")) return true;
			return trigger === base || normalized.endsWith(trigger) || normalized.includes(trigger);
		}),
	);
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
	const missingSpec = matchedSpecs.length === 0;

	let message: string;
	if (specs.length === 0) {
		message = `[Spec Reminder] ${targetPath} を編集する前に ${specsDirectory}/ を整備・確認してください。`;
	} else if (missingSpec) {
		message = `[Spec Reminder] ${targetPath} に対応する spec が見つかりません。${specsDirectory}/ の Trigger を確認してください。`;
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
			missingSpec,
			message,
		},
	};
}

function buildCommitReminder(reason: "before_commit" | "manual_check"): { message: string; metric: Metric } | undefined {
	const root = repoRoot();
	if (!root) return undefined;

	const changedSourceFiles = changedFiles().filter(isSourceFile);
	if (changedSourceFiles.length === 0) return undefined;

	const specs = loadSpecs(root);
	const today = new Date().toISOString().slice(0, 10);
	const checks: string[] = [];
	const matchedSpecs = new Set<string>();
	const staleSpecs = new Set<string>();
	let missingSpec = false;

	if (specs.length === 0) {
		missingSpec = true;
		const message = `[Spec Freshness] Source files changed: ${changedSourceFiles.join(", ")}。${specsDirectory}/ を整備・更新してください。`;
		return {
			message,
			metric: {
				timestamp: new Date().toISOString(),
				event: "spec_freshness",
				reason,
				changedSourceFiles,
				matchedSpecs: [],
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
			checks.push(`${file} -> 対応specなし`);
			continue;
		}
		for (const spec of matched) {
			matchedSpecs.add(spec.path);
			const stale = spec.lastUpdated === today ? "" : " (STALE)";
			if (stale) staleSpecs.add(spec.path);
			checks.push(`${file} -> ${spec.path}${stale}`);
		}
	}

	const message = `[Spec Freshness] コミット前に確認: ${checks.join("; ")}。動作仕様を変更した場合は対応specを同じコミットで更新し、バグ修正時は ${specsDirectory}/bug-memory.md に追記してください。`;
	return {
		message,
		metric: {
			timestamp: new Date().toISOString(),
			event: "spec_freshness",
			reason,
			changedSourceFiles,
			matchedSpecs: [...matchedSpecs],
			missingSpec,
			staleSpecs: [...staleSpecs],
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
	lines.push(`- ✅ extension loaded: /context-workflow-doctor command is available`);
	lines.push(`- ✅ repository root: ${root}`);

	const missingPrerequisites = recommendedProjectDocs.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
	if (missingPrerequisites.length === 0) {
		lines.push("- ✅ baseline docs: all present");
	} else {
		lines.push(`- ⚠️ baseline docs missing: ${missingPrerequisites.join(", ")}`);
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
	const commands = ["git diff --cached --name-only --diff-filter=ACMR", "git diff --name-only --diff-filter=ACMR"];
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
		`- missing prerequisite events: ${missingPrerequisiteCount}`,
		`- missing spec events: ${missingSpecCount}`,
		`- stale spec events: ${staleSpecCount}`,
		`- last event: ${last.timestamp} ${last.event} ${last.target ?? ""}`.trim(),
	].join("\n");
}
