import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";

// Observe real staging I/O. NTFS drops POSIX execute bits, so supply only the
// fixture's original source mode on reads of the exact extracted executable.
// Destination stats, copies and chmod calls are always real; failed calls throw
// before recording success. POSIX source metadata is never substituted.
export function observeStagedExecutable(t, artifactFile, mode = 0o755) {
	const { copyFileSync, chmodSync, lstatSync } = fs;
	const copies = [];
	const chmods = [];
	let source;
	let observedSourceMode;
	const copy = t.mock.method(fs, "copyFileSync", (from, to, ...args) => {
		const result = copyFileSync(from, to, ...args);
		if (resolve(from) === resolve(artifactFile)) source = join(dirname(to), "extracted", "bin", "initdb");
		copies.push({ from, to });
		return result;
	});
	const stat = t.mock.method(fs, "lstatSync", (path, ...args) => {
		const result = lstatSync(path, ...args);
		if (path === source) {
			if (process.platform === "win32") result.mode = (result.mode & ~0o777) | mode;
			observedSourceMode = result.mode & 0o777;
		}
		return result;
	});
	const chmod = t.mock.method(fs, "chmodSync", (path, requestedMode) => {
		const result = chmodSync(path, requestedMode);
		chmods.push({ path, mode: requestedMode });
		return result;
	});
	syncBuiltinESMExports();
	t.after(() => {
		copy.mock.restore();
		stat.mock.restore();
		chmod.mock.restore();
		syncBuiltinESMExports();
	});
	return {
		chmods,
		assertCopiedTo(destination) {
			assert.equal(observedSourceMode, mode, "staging must read the original executable source mode");
			assert.ok(
				copies.some(({ from, to }) => from === source && to === destination),
				"staging must copy the executable",
			);
			assert.equal(
				chmods.findLast(({ path }) => path === destination)?.mode,
				mode,
				"staging must chmod the exact copied executable to its source mode",
			);
		},
	};
}
