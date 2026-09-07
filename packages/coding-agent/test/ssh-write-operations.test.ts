import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import sshExtension from "../examples/extensions/ssh.ts";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../src/core/extensions/index.ts";
import { FileMutationConflict } from "../src/core/tools/file-mutation-coordinator.ts";

const remote = vi.hoisted(() => ({ cwd: "", blocked: "", unreadable: "", alias: "", race: false }));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: (command: string, args: string[], options: import("node:child_process").SpawnOptions) => {
			if (command !== "ssh") return actual.spawn(command, args, options);
			assert.equal(args[0], "fixture-host");
			// Execute the real remote shell command, with a permission-denied directory.
			// Modeling permissions here also exercises them on Windows and root-run CI.
			// Translate the fixture host's namespace into this machine's temporary directory.
			const shellCommand = args[1]
				.replaceAll("\\\\", "/")
				.replaceAll("/ssh-fixture", remote.cwd.replaceAll("\\", "/"));
			if (remote.race && shellCommand.includes("set -C")) {
				remote.race = false;
				remote.alias = join(remote.cwd, "raced-link.txt");
				writeFileSync(remote.alias, "external winner\n");
			}
			const permissions = `
	test() {
		case "$2" in "$ALIAS") [ "$1" = "-L" ]; return $?;; esac
		case "$2" in "$BLOCKED"/*) return 1;; esac
		builtin test "$@"
	}
	cd() {
		case "$1" in "$BLOCKED"|"$BLOCKED"/*) echo 'Permission denied' >&2; return 1;; esac
		builtin cd "$@"
	}
	cat() {
		case "$1" in "$BLOCKED"/*|"$UNREADABLE"|"$ALIAS") echo 'Permission denied' >&2; return 1;; esac
		command cat "$@"
	}
`;
			return actual.spawn("bash", ["-c", permissions + shellCommand], {
				...options,
				cwd: remote.cwd,
				env: {
					...process.env,
					BLOCKED: remote.blocked.replaceAll("\\", "/"),
					UNREADABLE: remote.unreadable.replaceAll("\\", "/"),
					ALIAS: remote.alias.replaceAll("\\", "/"),
				},
			});
		},
	};
});

type SessionStart = (event: { type: "session_start" }, ctx: ExtensionContext) => Promise<void>;

async function remoteTools(remoteCwd = "/ssh-fixture") {
	const tools: ToolDefinition[] = [];
	let start: SessionStart | undefined;
	sshExtension({
		registerFlag: () => {},
		registerTool: (tool: ToolDefinition) => tools.push(tool),
		getFlag: () => `fixture-host:${remoteCwd}`,
		on: (event: string, handler: SessionStart) => {
			if (event === "session_start") start = handler;
		},
	} as unknown as ExtensionAPI);
	assert.ok(start);
	const ctx = {
		ui: { setStatus: () => {}, notify: () => {}, theme: { fg: (_color: string, text: string) => text } },
	} as unknown as ExtensionContext;
	const restart = () => start!({ type: "session_start" }, ctx);
	await restart();
	const tool = (name: string) => {
		const found = tools.find((entry) => entry.name === name);
		assert.ok(found);
		return found;
	};
	return { tool, restart, ctx };
}

async function remoteWrite(remoteCwd = "/ssh-fixture"): Promise<ToolDefinition> {
	return (await remoteTools(remoteCwd)).tool("write");
}

describe("SSH write target observations", () => {
	let dir: string;
	let write: ToolDefinition;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "atomic-ssh-write-"));
		remote.cwd = dir;
		remote.blocked = join(dir, "blocked");
		remote.unreadable = join(dir, "unreadable.txt");
		write = await remoteWrite();
		remote.alias = join(dir, "alias.txt");
		remote.race = false;
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("reports a concurrent unreadable symlink as target_exists without clobbering", async () => {
		// #2482: the collision probe must recognize links even when -e cannot follow them.
		remote.race = true;
		await assert.rejects(
			write.execute(
				"race",
				{ path: "raced-link.txt", content: "loser\n" },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "target_exists",
		);
		assert.equal(await readFile(join(dir, "raced-link.txt"), "utf8"), "external winner\n");
	});

	it("retains a remote read observation for a later overwrite", async () => {
		// #2482: registered callbacks must not discard the session's snapshot store.
		const { tool, ctx } = await remoteTools();
		await writeFile(join(dir, "observed.txt"), "observed bytes\n");
		await tool("read").execute("read", { path: "observed.txt" }, undefined, undefined, ctx);
		await tool("write").execute(
			"write",
			{ path: "observed.txt", content: "replacement\n" },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(await readFile(join(dir, "observed.txt"), "utf8"), "replacement\n");
	});

	it("retains its own creates but discards observations at a new session", async () => {
		const { tool, restart, ctx } = await remoteTools();
		const write = tool("write");
		await write.execute("create", { path: "own.txt", content: "first\n" }, undefined, undefined, ctx);
		await write.execute("replace", { path: "own.txt", content: "second\n" }, undefined, undefined, ctx);
		await restart();
		await assert.rejects(
			write.execute("new-session", { path: "own.txt", content: "forbidden\n" }, undefined, undefined, ctx),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "no_prior_observation",
		);
		assert.equal(await readFile(join(dir, "own.txt"), "utf8"), "second\n");
	});

	it("still rejects a stale remote observation", async () => {
		const { tool, ctx } = await remoteTools();
		await writeFile(join(dir, "stale.txt"), "observed\n");
		await tool("read").execute("read", { path: "stale.txt" }, undefined, undefined, ctx);
		await writeFile(join(dir, "stale.txt"), "external winner\n");
		await assert.rejects(
			tool("write").execute("stale", { path: "stale.txt", content: "loser\n" }, undefined, undefined, ctx),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "changed_since_observation",
		);
		assert.equal(await readFile(join(dir, "stale.txt"), "utf8"), "external winner\n");
	});

	it("shares read and edit snapshots with a later write", async () => {
		const { tool, ctx } = await remoteTools();
		await writeFile(join(dir, "edited.txt"), "original\n");
		const result = await tool("read").execute("read", { path: "edited.txt" }, undefined, undefined, ctx);
		const tag = JSON.stringify(result.content).match(/#([A-F0-9]{4})/)?.[1];
		assert.ok(tag);
		await tool("edit").execute(
			"edit",
			{ input: `[edited.txt#${tag}]\nreplace 1:\n+edited` },
			undefined,
			undefined,
			ctx,
		);
		await tool("write").execute("write", { path: "edited.txt", content: "final\n" }, undefined, undefined, ctx);
		assert.equal(await readFile(join(dir, "edited.txt"), "utf8"), "final\n");
	});

	it("rejects a symlink with a permission-blocked referent as unreadable", async () => {
		// #2482: -e follows the link and can fail although its lexical parent is searchable.
		await assert.rejects(
			write.execute(
				"alias",
				{ path: "alias.txt", content: "replacement" },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "target_unreadable",
		);
	});

	it("rejects a target under an unsearchable remote directory as unreadable", async () => {
		// #2482: test -e alone reports false for both ENOENT and EACCES.
		await mkdir(remote.blocked);
		const target = join(remote.blocked, "target.txt");
		await writeFile(target, "retained bytes\n");
		await assert.rejects(
			write.execute(
				"blocked",
				{ path: "blocked/target.txt", content: "replacement\n" },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "target_unreadable",
		);
		assert.equal(await readFile(target, "utf8"), "retained bytes\n");
	});

	it("creates an absent file in newly created remote parents", async () => {
		await write.execute(
			"create",
			{ path: "new/parents/fresh.txt", content: "fresh bytes\n" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		assert.equal(await readFile(join(dir, "new/parents/fresh.txt"), "utf8"), "fresh bytes\n");
	});

	it.each(["remote bytes\n", ""])("does not treat a readable remote file as absent: %j", async (content) => {
		const target = join(dir, "existing.txt");
		await writeFile(target, content);
		await assert.rejects(
			write.execute(
				"existing",
				{ path: "existing.txt", content: "replacement\n" },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "no_prior_observation",
		);
		assert.equal(await readFile(target, "utf8"), content);
	});

	it.each(["directory", "unreadable.txt"])("rejects an unreadable remote target: %s", async (path) => {
		const target = join(dir, path);
		if (path === "directory") await mkdir(target);
		else await writeFile(target, "retained bytes\n");
		await assert.rejects(
			write.execute("unreadable", { path, content: "replacement\n" }, undefined, undefined, {} as ExtensionContext),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "target_unreadable",
		);
		if (path === "directory") assert.equal((await stat(target)).isDirectory(), true);
		else assert.equal(await readFile(target, "utf8"), "retained bytes\n");
	});

	it("preserves lookup from a relative remote working directory", async () => {
		await mkdir(join(dir, "relative"));
		const target = join(dir, "relative/existing.txt");
		await writeFile(target, "retained bytes\n");
		write = await remoteWrite("relative");
		await assert.rejects(
			write.execute(
				"relative",
				{ path: "existing.txt", content: "replacement\n" },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "no_prior_observation",
		);
		assert.equal(await readFile(target, "utf8"), "retained bytes\n");
	});
});
