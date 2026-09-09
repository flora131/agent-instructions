import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";

describe.skipIf(process.platform === "win32")("bash internal URL safety", () => {
	let cwd: string;
	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "atomic-url-"));
	});
	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("rejects quote insertion before executing either commandPrefix path", async () => {
		const bash = createBashToolDefinition(cwd, { commandPrefix: "printf prefix" });
		for (const args of [
			{ command: "printf '%s' 'local://x;uname;#'", cwd },
			{ command: "cd . && printf '%s' 'local://x;uname;#'" },
		]) {
			await expect(bash.execute("quoted", args)).rejects.toThrow(/Internal URL shell expansion/);
		}
	});

	it.each([
		'printf %s "artifact://path"',
		"printf %s $(printf %s artifact://path)",
		"printf %s `printf %s artifact://path`",
		"printf %s \\artifact://path",
		"cat <<EOF\nartifact://path\nEOF",
		"cat <<'EOF'\nartifact://path\nEOF",
		"cat <<-EOF\n\tartifact://path\nEOF",
		"cat <<A <<B\nartifact://path\nA\nbody\nB",
	])("rejects unsupported shell context: %s", async (command) => {
		const bash = createBashToolDefinition(cwd);
		await expect(
			bash.execute("hazard", { command }, undefined, undefined, {
				resolveInternalUrl: () => join(cwd, "$(printf injected)`printf injected`' space"),
			}),
		).rejects.toThrow(/Internal URL shell expansion/);
	});

	it("keeps bare URL paths literal through both prefix paths", async () => {
		const bash = createBashToolDefinition(cwd, { commandPrefix: "printf prefix:" });
		const path = join(cwd, "odd ' space ; $(printf injected)`printf injected`");
		for (const args of [
			{ command: "printf %s artifact://path", cwd },
			{ command: "cd . && printf %s artifact://path" },
		]) {
			const result = await bash.execute("bare", args, undefined, undefined, { resolveInternalUrl: () => path });
			expect(result.content).toEqual([{ type: "text", text: `prefix:${path}` }]);
		}
	});

	// Code scanning #195/#196: balanced setup syntax must survive both prefix paths.
	it.each([
		`export VALUE='balanced value'; printf '%s:' "$VALUE"`,
		`VALUE="$(printf 'balanced value')"; printf '%s:' "$VALUE"`,
		`f() { printf 'balanced value:'; }\nf`,
		`VALUE=$(cat <<'EOF'\nbalanced value\nEOF\n)\nprintf '%s:' "$VALUE"`,
	])("preserves balanced prefix syntax with bare URLs: %s", async (commandPrefix) => {
		const bash = createBashToolDefinition(cwd, { commandPrefix });
		const path = join(cwd, "odd ' ‘ ’ ‚ ‛ space ; $(printf injected)`printf injected`\nline");
		for (const args of [
			{ command: "printf %s artifact://path", cwd },
			{ command: "cd . && printf %s artifact://path" },
		]) {
			const result = await bash.execute("balanced", args, undefined, undefined, { resolveInternalUrl: () => path });
			assert.deepEqual(result.content, [{ type: "text", text: `balanced value:${path}` }]);
		}
	});

	// Code scanning #197 starts at process.cwd(), not the intentional command input.
	it("keeps a metacharacter-bearing cwd and structured environment values literal", async () => {
		const path = join(cwd, "odd ' ; $(touch injected)`touch injected` space");
		await mkdir(path);
		const bash = createBashToolDefinition(path);
		const bare = await bash.execute("bare-cwd", { command: "printf %s local://notes" });
		assert.deepEqual(bare.content, [{ type: "text", text: join(path, "notes") }]);
		const structured = await bash.execute("structured", {
			command: `printf '%s\\n%s' "$PWD" "$VALUE"`,
			cwd: path,
			env: { VALUE: "local://notes" },
		});
		assert.deepEqual(structured.content, [{ type: "text", text: `${await realpath(path)}\n${join(path, "notes")}` }]);
		assert.equal(existsSync(join(path, "injected")), false);
		assert.equal(existsSync(join(cwd, "injected")), false);
	});

	it("preserves arbitrary shell syntax without resolved URLs", async () => {
		const bash = createBashToolDefinition(cwd, { commandPrefix: "VALUE=prefix; export VALUE" });
		const result = await bash.execute("ordinary", { command: 'printf "%s:" "$VALUE"; printf abc | tr a-z A-Z' });
		expect(result.content).toEqual([{ type: "text", text: "prefix:ABC" }]);
	});
});
