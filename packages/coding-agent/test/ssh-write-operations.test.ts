import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import sshExtension from "../examples/extensions/ssh.ts";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../src/core/extensions/index.ts";
import { FileMutationConflict } from "../src/core/tools/file-mutation-coordinator.ts";

const remote = vi.hoisted(() => ({ cwd: "", blocked: "", unreadable: "" }));

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
			const permissions = `
	test() {
		case "$2" in "$BLOCKED"/*) return 1;; esac
		builtin test "$@"
	}
	cd() {
		case "$1" in "$BLOCKED"|"$BLOCKED"/*) echo 'Permission denied' >&2; return 1;; esac
		builtin cd "$@"
	}
	cat() {
		case "$1" in "$BLOCKED"/*|"$UNREADABLE") echo 'Permission denied' >&2; return 1;; esac
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
				},
			});
		},
	};
});

type SessionStart = (event: { type: "session_start" }, ctx: ExtensionContext) => Promise<void>;

async function remoteWrite(remoteCwd = "/ssh-fixture"): Promise<ToolDefinition> {
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
	await start({ type: "session_start" }, {
		ui: { setStatus: () => {}, notify: () => {}, theme: { fg: (_color: string, text: string) => text } },
	} as unknown as ExtensionContext);
	const tool = tools.find((entry) => entry.name === "write");
	assert.ok(tool);
	return tool;
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
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
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
