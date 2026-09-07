import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../src/core/extensions/index.ts";
import { FileMutationConflict } from "../src/core/tools/file-mutation-coordinator.ts";
import * as atomic from "../src/index.ts";

const guest = { dir: "", race: false, dangling: false };

function gondolinFixture() {
	const local = (path: string) =>
		path
			.replace("/data/workspace", guest.dir)
			.replace("/workspace", guest.dir)
			.replace("/native", join(guest.dir, "native"))
			.replaceAll("\\", "/");
	return {
		RealFSProvider: class {
			async open(path: string, flags: string) {
				const target = join(guest.dir, path);
				// RealFSProvider resolves an existing link before open, including dangling links.
				if ((await lstat(target).catch(() => undefined))?.isSymbolicLink()) await realpath(target);
				return open(target, flags);
			}
			lstat(path: string) {
				return lstat(join(guest.dir, path));
			}
		},
		VM: {
			create: async () => ({
				id: "fixture-vm",
				close: async () => {},
				fs: {
					access: (path: string) => access(local(path)),
					mkdir: (path: string, options: { recursive: boolean }) => mkdir(local(path), options),
					readFile: async (path: string, options?: { encoding?: "utf8" }) => {
						try {
							return await readFile(local(path), options?.encoding);
						} catch (error) {
							// Gondolin 0.12.0's VmFsController discards code and keeps this message.
							throw new Error(`failed to read guest file '${path}': ${(error as Error).message}`);
						}
					},
					// Its writeFile has no flag option and always truncates.
					writeFile: (path: string, content: string) => writeFile(local(path), content),
				},
				exec: async (args: string[], options?: { stdin?: string | Buffer }) => {
					const result = spawnSync("sh", args.slice(1).map(local), {
						cwd: guest.dir,
						input: options?.stdin,
						encoding: "utf8",
					});
					if (result.error) throw result.error;
					if (result.status === 44 && guest.race) {
						guest.race = false;
						if (guest.dangling) await symlink("missing-referent", local(args[4]));
						else await writeFile(local(args[4]), "external winner\n");
					}
					return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
				},
			}),
		},
	};
}

// Compile the complete example against injected transport dependencies. The optional
// VM package and QEMU need not be installed to exercise its registered tool handlers.
const source = await readFile(new URL("../examples/extensions/gondolin/index.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source)
	.replace('import path from "node:path";', "const path = deps.path;")
	.replace(/import \{([\s\S]*?)\} from "@bastani\/atomic";/, "const {$1} = deps.atomic;")
	.replace(/import \{([\s\S]*?)\} from "@earendil-works\/gondolin";/, "const {$1} = deps.gondolin;")
	.replace("export default function", "return function");
const gondolinExtension: (api: ExtensionAPI) => void = new Function("deps", compiled)({
	path,
	gondolin: gondolinFixture(),
	// The preexisting unused grep factory is absent from the current SDK. Do not
	// replace read/write/edit or conceal this unrelated example startup defect.
	atomic: { ...atomic, createGrepTool: () => ({ name: "grep" }) },
});

async function session() {
	const tools = new Map<string, ToolDefinition>();
	let start: (() => Promise<void>) | undefined;
	const ctx = {
		ui: { setStatus() {}, notify() {}, theme: { fg: (_color: string, text: string) => text } },
	} as unknown as ExtensionContext;
	gondolinExtension({
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		registerCommand() {},
		on(name: string, handler: (event: object, ctx: ExtensionContext) => Promise<void>) {
			if (name === "session_start") start = () => handler({ type: "session_start" }, ctx);
		},
	} as unknown as ExtensionAPI);
	assert.ok(start);
	await start();
	return { tools, ctx, restart: start };
}

describe("Gondolin write target observations", () => {
	beforeEach(async () => {
		guest.dir = await mkdtemp(join(tmpdir(), "atomic-gondolin-write-"));
		guest.race = false;
		guest.dangling = false;
	});
	afterEach(async () => {
		await rm(guest.dir, { recursive: true, force: true });
	});

	it("retains a guest read observation for a later overwrite", async () => {
		// #2482: registered callbacks must share the session's observation store.
		const { tools, ctx } = await session();
		await writeFile(join(guest.dir, "observed.txt"), "guest bytes\n");
		await tools.get("read")!.execute("read", { path: "observed.txt" }, undefined, undefined, ctx);
		await tools
			.get("write")!
			.execute("write", { path: "observed.txt", content: "replacement\n" }, undefined, undefined, ctx);
		assert.equal(await readFile(join(guest.dir, "observed.txt"), "utf8"), "replacement\n");
	});

	it("creates a missing guest file despite the controller's plain error shape", async () => {
		// #2482: VmFsController does not retain ENOENT.code.
		const { tools, ctx } = await session();
		await tools
			.get("write")!
			.execute("create", { path: "new/file.txt", content: "created\n" }, undefined, undefined, ctx);
		assert.equal(await readFile(join(guest.dir, "new/file.txt"), "utf8"), "created\n");
	});

	it.each(["/workspace", "/data/workspace", "/native"])("retains a concurrent creator under %s", async (root) => {
		// #2482: VmFsWriteFileOptions has no flag and ignores an attempted wx request.
		const { tools, ctx } = await session();
		guest.race = true;
		await assert.rejects(
			tools
				.get("write")!
				.execute("race", { path: `${root}/raced.txt`, content: "loser\n" }, undefined, undefined, ctx),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "target_exists",
		);
		assert.equal(
			await readFile(join(guest.dir, root === "/native" ? "native/raced.txt" : "raced.txt"), "utf8"),
			"external winner\n",
		);
	});

	it("reports a concurrent dangling symlink as a typed collision without changing it", async () => {
		// #2482: the mounted provider throws ENOENT while resolving this occupied path.
		const { tools, ctx } = await session();
		guest.race = true;
		guest.dangling = true;
		await assert.rejects(
			tools.get("write")!.execute("race", { path: "raced.txt", content: "loser\n" }, undefined, undefined, ctx),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "target_exists",
		);
		assert.equal(await readlink(join(guest.dir, "raced.txt")), "missing-referent");
		await assert.rejects(lstat(join(guest.dir, "missing-referent")), { code: "ENOENT" });
	});

	it.each(["", "line\n$() `quoted` 雪\n"])("creates verbatim native guest content: %j", async (content) => {
		const { tools, ctx } = await session();
		await tools.get("write")!.execute("native", { path: "/native/new.txt", content }, undefined, undefined, ctx);
		assert.equal(await readFile(join(guest.dir, "native/new.txt"), "utf8"), content);
	});

	it("retains its own writes but isolates a new session", async () => {
		const { tools, ctx, restart } = await session();
		const write = tools.get("write")!;
		await write.execute("create", { path: "own.txt", content: "first\n" }, undefined, undefined, ctx);
		await write.execute("replace", { path: "own.txt", content: "second\n" }, undefined, undefined, ctx);
		await restart();
		await assert.rejects(
			write.execute("new-session", { path: "own.txt", content: "forbidden\n" }, undefined, undefined, ctx),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "no_prior_observation",
		);
		assert.equal(await readFile(join(guest.dir, "own.txt"), "utf8"), "second\n");
	});

	it("still rejects an externally changed guest target", async () => {
		const { tools, ctx } = await session();
		await writeFile(join(guest.dir, "stale.txt"), "observed\n");
		await tools.get("read")!.execute("read", { path: "stale.txt" }, undefined, undefined, ctx);
		await writeFile(join(guest.dir, "stale.txt"), "external winner\n");
		await assert.rejects(
			tools.get("write")!.execute("stale", { path: "stale.txt", content: "loser\n" }, undefined, undefined, ctx),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "changed_since_observation",
		);
		assert.equal(await readFile(join(guest.dir, "stale.txt"), "utf8"), "external winner\n");
	});

	it("shares read and edit snapshots with a later guest write", async () => {
		const { tools, ctx } = await session();
		await writeFile(join(guest.dir, "edited.txt"), "original\n");
		const result = await tools.get("read")!.execute("read", { path: "edited.txt" }, undefined, undefined, ctx);
		const tag = JSON.stringify(result.content).match(/#([A-F0-9]{4})/)?.[1];
		assert.ok(tag);
		await tools
			.get("edit")!
			.execute("edit", { input: `[edited.txt#${tag}]\nreplace 1:\n+edited` }, undefined, undefined, ctx);
		await tools.get("write")!.execute("write", { path: "edited.txt", content: "final\n" }, undefined, undefined, ctx);
		assert.equal(await readFile(join(guest.dir, "edited.txt"), "utf8"), "final\n");
	});

	it("does not classify an unreadable guest directory as missing", async () => {
		const { tools, ctx } = await session();
		await mkdir(join(guest.dir, "directory"));
		await assert.rejects(
			tools
				.get("write")!
				.execute("directory", { path: "directory", content: "forbidden" }, undefined, undefined, ctx),
			(error: Error) => error instanceof FileMutationConflict && error.reason === "target_unreadable",
		);
	});
});
