import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { test } from "vitest";
import { fileExistsSync, moduleDir } from "../helpers/runtime.js";

const root = join(moduleDir(import.meta.url), "../..");
const distRoot = join(root, "packages", "coding-agent", "dist");
const supervisorPath = join(distRoot, "core", "tasks", "supervisor.js");
const buildCommand = "npm --workspace=@bastani/atomic run build";

/** Copied verbatim by `copy-assets`: browser fragments, not emitted modules, and not standalone programs. */
const copiedAssetDirectories = ["core/export-html/template-js", "core/export-html/vendor"];

function listEmittedJavaScript(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listEmittedJavaScript(path);
		return [".js", ".mjs", ".cjs"].includes(extname(entry.name)) ? [path] : [];
	});
}

/**
 * `new f(a)(b)` in emitted output means the compiler moved construction onto the
 * wrong callee. It is what shipped in 0.9.19-alpha.2: erasing `as typeof native`
 * dropped the parentheses in
 * `new (require(...) as typeof native).TaskSupervisor()`, so the native class ran
 * as a plain function and every task supervisor held an inert object. Nothing
 * else in the built tree uses this shape, so any hit is a miscompile.
 */
test("emitted JavaScript never calls the result of a new expression", () => {
	assert.ok(
		fileExistsSync(supervisorPath),
		`Missing built artifact ${supervisorPath}. Run \`${buildCommand}\` before this test.`,
	);
	const offenders: string[] = [];

	for (const path of listEmittedJavaScript(distRoot)) {
		const relativePath = relative(distRoot, path).replaceAll("\\", "/");
		if (copiedAssetDirectories.some((directory) => relativePath.startsWith(`${directory}/`))) continue;
		const source = readFileSync(path, "utf8");
		const program = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
		simple(program, {
			CallExpression: (node) => {
				if (node.callee.type !== "NewExpression" || node.callee.arguments.length === 0) return;
				offenders.push(`${relativePath}:${node.loc?.start.line}: ${source.slice(node.start, node.end)}`);
			},
		});
	}

	assert.deepEqual(offenders, []);
});
