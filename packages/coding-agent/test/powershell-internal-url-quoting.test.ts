import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { createPowerShellToolDefinition } from "../src/core/tools/powershell.ts";
import { getPowerShellConfig } from "../src/utils/shell.ts";

// Windows CI uses its real PowerShell; POSIX can opt in with a portable pwsh executable.
const portablePowerShell = process.env.ATOMIC_TEST_PWSH;
describe.skipIf(process.platform !== "win32" && !portablePowerShell)("PowerShell internal URL safety", () => {
	let cwd: string;
	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "atomic-powershell-url-"));
	});
	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	// Code scanning #195–197: generated paths are data, not deliberate shell code.
	it.each(
		["-Command", "-EncodedCommand"].flatMap((transport) =>
			["'", "\u2018", "\u2019", "\u201a", "\u201b"].map((quote) => ({ transport, quote })),
		),
	)("keeps resolved paths containing $quote literal via $transport", async ({ transport, quote }) => {
		const shell = portablePowerShell ?? getPowerShellConfig().shell;
		const tool = createPowerShellToolDefinition(cwd, {
			operations: {
				exec: async (command, executionCwd, { onData }) => {
					const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${command}`;
					const payload =
						transport === "-EncodedCommand" ? Buffer.from(script, "utf16le").toString("base64") : script;
					const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", transport, payload], {
						cwd: executionCwd,
						encoding: "utf8",
						timeout: 5000,
					});
					assert.ifError(result.error);
					assert.equal(result.status, 0, result.stderr);
					onData(Buffer.from(result.stdout));
					return { exitCode: result.status };
				},
			},
		});
		const path = join(cwd, `x${quote}; Set-Content -LiteralPath injected.txt -Value INJECTED; #`);
		const result = await tool.execute("literal", { command: "Write-Output artifact://path" }, undefined, undefined, {
			resolveInternalUrl: () => path,
		});
		assert.equal(existsSync(join(cwd, "injected.txt")), false, "resolved path executed a second command");
		assert.deepEqual(result.content, [
			{ type: "text", text: `${path}${process.platform === "win32" ? "\r\n" : "\n"}` },
		]);
		const literalPath = join(cwd, "spaces \t\n $() ` \" € ‘ ’ ‚ ‛ ' ; artifact://other");
		const literal = await tool.execute(
			"metacharacters",
			{ command: "Write-Output artifact://path" },
			undefined,
			undefined,
			{
				resolveInternalUrl: () => literalPath,
			},
		);
		assert.deepEqual(literal.content, [
			{ type: "text", text: `${literalPath}${process.platform === "win32" ? "\r\n" : "\n"}` },
		]);
	});
});
