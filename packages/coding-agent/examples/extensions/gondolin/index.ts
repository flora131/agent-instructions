/**
 * Gondolin Tool Routing Example
 *
 * Routes read, write, edit, bash, find, ls and user ! commands into a local
 * Gondolin micro-VM. The host working directory is mounted at /workspace;
 * changes there write through to the host. Other guest changes stay in the VM.
 * Search and other unoverridden tools still run on the host. For guest-only
 * content searches use the routed shell; this is not whole-session isolation.
 *
 * Setup:
 *   cd packages/coding-agent/examples/extensions/gondolin
 *   npm ci --ignore-scripts
 *   npm run check  # from this repository: full Gondolin + SSH adapter typecheck
 *
 * Usage:
 *   cd /path/to/project
 *   atomic -e /path/to/atomic/packages/coding-agent/examples/extensions/gondolin
 *
 * Requirements:
 *   - Node.js >= 23.6.0 for @earendil-works/gondolin
 *   - QEMU installed (for example, `brew install qemu` on macOS)
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@bastani/atomic";
import {
	type BashOperations,
	createBashTool,
	createCodingTools,
	createEditTool,
	createFindTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type EditOperations,
	type FindOperations,
	type LsOperations,
	type ReadOperations,
	type WriteOperations,
} from "@bastani/atomic";
import { RealFSProvider, VM } from "@earendil-works/gondolin";

const GUEST_WORKSPACE = "/workspace";
const GUEST_FUSE_MOUNT = "/data";

function stripAtPrefix(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function toPosix(value: string): string {
	return value.split(path.sep).join(path.posix.sep);
}

function isInsideHostPath(root: string, value: string): boolean {
	const relativePath = path.relative(root, value);
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function hostPathToGuest(localCwd: string, hostPath: string): string {
	const relativePath = path.relative(localCwd, hostPath);
	if (!isInsideHostPath(localCwd, hostPath)) return toPosix(hostPath);
	return relativePath ? path.posix.join(GUEST_WORKSPACE, toPosix(relativePath)) : GUEST_WORKSPACE;
}

function toGuestPath(localCwd: string, inputPath: string): string {
	const trimmed = stripAtPrefix(inputPath.trim());
	if (!trimmed) return GUEST_WORKSPACE;
	if (path.isAbsolute(trimmed)) {
		if (isInsideHostPath(localCwd, trimmed)) return hostPathToGuest(localCwd, trimmed);
		return path.posix.resolve("/", toPosix(trimmed));
	}
	return path.posix.resolve(GUEST_WORKSPACE, toPosix(trimmed));
}

function createGondolinReadOps(vm: VM, localCwd: string): ReadOperations {
	return {
		readFile: async (filePath) => vm.fs.readFile(toGuestPath(localCwd, filePath)),
		access: async (filePath) => {
			await vm.fs.access(toGuestPath(localCwd, filePath));
		},
		detectImageMimeType: async (filePath) => {
			const ext = path.posix.extname(toGuestPath(localCwd, filePath)).toLowerCase();
			if (ext === ".png") return "image/png";
			if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
			if (ext === ".gif") return "image/gif";
			if (ext === ".webp") return "image/webp";
			return null;
		},
	};
}

function createGondolinWriteOps(vm: VM, localCwd: string, workspace: RealFSProvider): WriteOperations {
	const workspaceRelativePath = (target: string) => {
		for (const mount of [GUEST_WORKSPACE, `${GUEST_FUSE_MOUNT}${GUEST_WORKSPACE}`]) {
			if (target === mount || target.startsWith(`${mount}/`)) return target.slice(mount.length) || "/";
		}
		return undefined;
	};
	return {
		writeFile: async (filePath, content, options) => {
			const target = toGuestPath(localCwd, filePath);
			if (!options?.exclusive) {
				await vm.fs.writeFile(target, content, { encoding: "utf8" });
				return;
			}
			// Both fs.writeFile and the 0.12.0 FUSE bridge discard exclusive flags.
			// Open through the exact provider mounted at /workspace, not unrelated host IO.
			let relativePath = workspaceRelativePath(target);
			if (relativePath === undefined) {
				// A guest symlink can route an otherwise native-looking parent onto FUSE.
				const parent = await vm.exec(["/bin/sh", "-c", 'cd "$1" && pwd -P', "sh", path.posix.dirname(target)]);
				if (parent.exitCode !== 0) throw new Error(parent.stderr);
				relativePath = workspaceRelativePath(
					path.posix.join(parent.stdout.replace(/\n$/, ""), path.posix.basename(target)),
				);
			}
			if (relativePath !== undefined) {
				const mountedPath = relativePath;
				const handle = await workspace.open(mountedPath, "wx").catch(async (error: NodeJS.ErrnoException) => {
					// The provider resolves links before open: a dangling collision becomes ENOENT.
					// Check occupancy in that same mounted namespace, without following the link.
					if (
						error.code === "ENOENT" &&
						(await workspace.lstat(mountedPath).catch(() => undefined))?.isSymbolicLink()
					) {
						throw Object.assign(new Error(`EEXIST: file already exists, open '${target}'`), { code: "EEXIST" });
					}
					throw error;
				});
				try {
					await handle.writeFile(content, { encoding: "utf8" });
				} finally {
					await handle.close();
				}
				return;
			}
			// Native guest paths do not cross FUSE. Noclobber is enforced by the guest OS.
			const result = await vm.exec(
				[
					"/bin/sh",
					"-c",
					'(set -C; cat > "$1") || { if [ -e "$1" ] || [ -L "$1" ]; then exit 17; else exit 1; fi; }',
					"sh",
					target,
				],
				{ stdin: content },
			);
			if (result.exitCode !== 0) {
				const error = new Error(`Failed to create guest file '${target}': ${result.stderr}`);
				if (result.exitCode === 17) throw Object.assign(error, { code: "EEXIST" });
				throw error;
			}
		},
		mkdir: async (dirPath) => {
			await vm.fs.mkdir(toGuestPath(localCwd, dirPath), { recursive: true });
		},
		// Reads inside the guest, so the checks `write` runs before overwriting see the same
		// filesystem the write lands on rather than the host's. Absence is `undefined`; a path
		// that exists but cannot be read keeps throwing, since it is not a free path.
		readFile: async (filePath) => {
			const target = toGuestPath(localCwd, filePath);
			try {
				return await vm.fs.readFile(target, { encoding: "utf8" });
			} catch (error) {
				// Gondolin 0.12.0 wraps filesystem errors without preserving errno. Probe
				// the guest namespace rather than parsing localized error messages.
				const probe = await vm.exec([
					"/bin/sh",
					"-c",
					'(cd "$2") && { if [ -e "$1" ] || [ -L "$1" ]; then exit 0; else exit 44; fi; }',
					"sh",
					target,
					path.posix.dirname(target),
				]);
				if (probe.exitCode === 44) return undefined;
				throw error;
			}
		},
	};
}

function createGondolinEditOps(vm: VM, localCwd: string, workspace: RealFSProvider): EditOperations {
	const readOps = createGondolinReadOps(vm, localCwd);
	const writeOps = createGondolinWriteOps(vm, localCwd, workspace);
	return {
		readFile: readOps.readFile,
		writeFile: writeOps.writeFile,
		access: readOps.access,
	};
}

function createGondolinLsOps(vm: VM, localCwd: string): LsOperations {
	return {
		exists: async (filePath) => {
			try {
				await vm.fs.access(toGuestPath(localCwd, filePath));
				return true;
			} catch {
				return false;
			}
		},
		stat: async (filePath) => vm.fs.stat(toGuestPath(localCwd, filePath)),
		readdir: async (dirPath) => vm.fs.listDir(toGuestPath(localCwd, dirPath)),
	};
}

async function walkGuestFiles(
	vm: VM,
	root: string,
	visit: (guestPath: string, relativePath: string) => Promise<boolean>,
	signal?: AbortSignal,
): Promise<boolean> {
	if (signal?.aborted) throw new Error("Operation aborted");
	const stat = await vm.fs.stat(root, { signal });
	if (!stat.isDirectory()) return visit(root, path.posix.basename(root));

	const walkDirectory = async (dir: string, relativeDir: string): Promise<boolean> => {
		if (signal?.aborted) throw new Error("Operation aborted");
		const entries = await vm.fs.listDir(dir, { signal });
		for (const entry of entries) {
			if (entry === ".git" || entry === "node_modules") continue;
			const guestPath = path.posix.join(dir, entry);
			const relativePath = relativeDir ? path.posix.join(relativeDir, entry) : entry;
			let entryStat: Awaited<ReturnType<VM["fs"]["stat"]>>;
			try {
				entryStat = await vm.fs.stat(guestPath, { signal });
			} catch {
				continue;
			}
			if (entryStat.isDirectory()) {
				if (!(await walkDirectory(guestPath, relativePath))) return false;
			} else if (!(await visit(guestPath, relativePath))) {
				return false;
			}
		}
		return true;
	};

	return walkDirectory(root, "");
}

function matchesToolGlob(relativePath: string, pattern: string): boolean {
	const normalizedPattern = toPosix(pattern);
	if (normalizedPattern.includes("/")) {
		return (
			path.posix.matchesGlob(relativePath, normalizedPattern) ||
			path.posix.matchesGlob(relativePath, `**/${normalizedPattern}`)
		);
	}
	return path.posix.matchesGlob(path.posix.basename(relativePath), normalizedPattern);
}

function createGondolinFindOps(vm: VM, localCwd: string): FindOperations {
	return {
		exists: async (filePath) => {
			try {
				await vm.fs.access(toGuestPath(localCwd, filePath));
				return true;
			} catch {
				return false;
			}
		},
		glob: async (pattern, cwd, options) => {
			const root = toGuestPath(localCwd, cwd);
			const results: string[] = [];
			await walkGuestFiles(vm, root, async (guestPath, relativePath) => {
				if (results.length >= options.limit) return false;
				if (matchesToolGlob(relativePath, pattern)) results.push(guestPath);
				return results.length < options.limit;
			});
			return results;
		},
	};
}

function createGondolinBashOps(vm: VM, localCwd: string, shellPath: string): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout }) => {
			if (signal?.aborted) throw new Error("aborted");
			const guestCwd = toGuestPath(localCwd, cwd);
			const controller = new AbortController();
			const onAbort = () => controller.abort();
			signal?.addEventListener("abort", onAbort, { once: true });
			let timedOut = false;
			const timer =
				timeout && timeout > 0
					? setTimeout(() => {
							timedOut = true;
							controller.abort();
						}, timeout * 1000)
					: undefined;
			try {
				const proc = vm.exec([shellPath, "-lc", command], {
					cwd: guestCwd,
					// Deliberately do not forward the host shell environment into the VM.
					// Atomic authentication and other host secrets stay on the host.
					signal: controller.signal,
					stdout: "pipe",
					stderr: "pipe",
				});
				for await (const chunk of proc.output()) onData(chunk.data);
				const result = await proc;
				return { exitCode: result.exitCode };
			} catch (error) {
				if (signal?.aborted) throw new Error("aborted");
				if (timedOut) throw new Error(`timeout:${timeout}`);
				throw error;
			} finally {
				if (timer) clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}
export default function (pi: ExtensionAPI) {
	const localCwd = process.cwd();
	const workspace = new RealFSProvider(localCwd);
	const localRead = createReadTool(localCwd);
	const localWrite = createWriteTool(localCwd);
	const localEdit = createEditTool(localCwd);
	const localBash = createBashTool(localCwd);
	const localFind = createFindTool(localCwd);
	const localLs = createLsTool(localCwd);
	let vm: VM | undefined;
	let vmStarting: Promise<VM> | undefined;
	let shellPath = "/bin/sh";
	let fileTools: ReturnType<typeof createCodingTools> | undefined;
	function getFileTools(activeVm: VM) {
		fileTools ??= createCodingTools(GUEST_WORKSPACE, {
			read: { operations: createGondolinReadOps(activeVm, localCwd) },
			write: { operations: createGondolinWriteOps(activeVm, localCwd, workspace) },
			edit: { operations: createGondolinEditOps(activeVm, localCwd, workspace) },
		});
		return fileTools;
	}
	async function startVm(ctx?: ExtensionContext): Promise<VM> {
		ctx?.ui.setStatus("gondolin", ctx.ui.theme.fg("accent", `Gondolin: starting ${GUEST_WORKSPACE}`));
		const created = await VM.create({
			sessionLabel: `atomic ${path.basename(localCwd)}`,
			vfs: {
				fuseMount: GUEST_FUSE_MOUNT,
				mounts: {
					[GUEST_WORKSPACE]: workspace,
				},
			},
		});
		const bashProbe = await created.exec(["/bin/sh", "-lc", "command -v bash || true"]);
		shellPath = bashProbe.stdout.trim() || "/bin/sh";
		vm = created;
		ctx?.ui.setStatus(
			"gondolin",
			ctx.ui.theme.fg("accent", `Gondolin: ${created.id.slice(0, 8)} (${GUEST_WORKSPACE})`),
		);
		ctx?.ui.notify(`Gondolin VM ready. ${localCwd} is mounted at ${GUEST_WORKSPACE}.`, "info");
		return created;
	}
	async function ensureVm(ctx?: ExtensionContext): Promise<VM> {
		if (vm) return vm;
		if (!vmStarting) {
			vmStarting = startVm(ctx).finally(() => {
				vmStarting = undefined;
			});
		}
		return vmStarting;
	}
	pi.on("session_start", async (_event, ctx) => {
		fileTools = undefined;
		await ensureVm(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		fileTools = undefined;
		const activeVm = vm;
		vm = undefined;
		vmStarting = undefined;
		if (!activeVm) return;
		ctx.ui.setStatus("gondolin", ctx.ui.theme.fg("muted", "Gondolin: stopping"));
		try {
			await activeVm.close();
		} finally {
			ctx.ui.setStatus("gondolin", undefined);
		}
	});
	pi.registerCommand("gondolin", {
		description: "Show Gondolin VM status",
		handler: async (_args, ctx) => {
			const activeVm = await ensureVm(ctx);
			ctx.ui.notify(
				[
					`Gondolin VM: ${activeVm.id}`,
					`Host workspace: ${localCwd}`,
					`Guest workspace: ${GUEST_WORKSPACE}`,
					`Shell: ${shellPath}`,
				].join("\n"),
				"info",
			);
		},
	});
	pi.registerTool({
		...localRead,
		async execute(id, params, signal, onUpdate, ctx) {
			const activeVm = await ensureVm(ctx);
			return getFileTools(activeVm)
				.find((tool) => tool.name === "read")!
				.execute(id, params, signal, onUpdate);
		},
	});
	pi.registerTool({
		...localWrite,
		async execute(id, params, signal, onUpdate, ctx) {
			const activeVm = await ensureVm(ctx);
			return getFileTools(activeVm)
				.find((tool) => tool.name === "write")!
				.execute(id, params, signal, onUpdate);
		},
	});
	pi.registerTool({
		...localEdit,
		async execute(id, params, signal, onUpdate, ctx) {
			const activeVm = await ensureVm(ctx);
			return getFileTools(activeVm)
				.find((tool) => tool.name === "edit")!
				.execute(id, params, signal, onUpdate);
		},
	});
	pi.registerTool({
		...localBash,
		async execute(id, params, signal, onUpdate, ctx) {
			const activeVm = await ensureVm(ctx);
			const tool = createBashTool(GUEST_WORKSPACE, {
				operations: createGondolinBashOps(activeVm, localCwd, shellPath),
			});
			return tool.execute(id, params, signal, onUpdate);
		},
	});
	pi.registerTool({
		...localLs,
		async execute(id, params, signal, onUpdate, ctx) {
			const activeVm = await ensureVm(ctx);
			const tool = createLsTool(GUEST_WORKSPACE, {
				operations: createGondolinLsOps(activeVm, localCwd),
			});
			return tool.execute(id, params, signal, onUpdate);
		},
	});
	pi.registerTool({
		...localFind,
		async execute(id, params, signal, onUpdate, ctx) {
			const activeVm = await ensureVm(ctx);
			const tool = createFindTool(GUEST_WORKSPACE, {
				operations: createGondolinFindOps(activeVm, localCwd),
			});
			return tool.execute(id, params, signal, onUpdate);
		},
	});
	pi.on("user_bash", async (_event, ctx) => {
		const activeVm = await ensureVm(ctx);
		return { operations: createGondolinBashOps(activeVm, localCwd, shellPath) };
	});
	pi.on("before_agent_start", async (event, ctx) => {
		await ensureVm(ctx);
		const localLine = `Current working directory: ${localCwd}`;
		const guestLine = `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM; host workspace mounted from ${localCwd})`;
		const systemPrompt = event.systemPrompt.includes(localLine)
			? event.systemPrompt.replace(localLine, guestLine)
			: `${event.systemPrompt}\n\n${guestLine}`;
		return { systemPrompt };
	});
}
