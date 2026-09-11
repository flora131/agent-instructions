import assert from "node:assert/strict";
import {
	chmodSync,
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { observeStagedExecutable } from "./test-helpers/staging-permissions.mjs";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "atomic-pg-permissions-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const work = join(root, "work");
	const source = join(work, "extracted", "bin", "initdb");
	const destination = join(root, "initdb");
	const artifact = join(root, "artifact.tgz");
	mkdirSync(join(work, "extracted", "bin"), { recursive: true });
	writeFileSync(artifact, "artifact");
	writeFileSync(source, "real executable bytes", { mode: 0o755 });
	// Creation modes are filtered by umask; these exact-mode regressions require 0755.
	chmodSync(source, 0o755);
	const observation = observeStagedExecutable(t, artifact);
	copyFileSync(artifact, join(work, "artifact.tgz"));
	const mode = lstatSync(source).mode & 0o777;
	return { source, destination, mode, observation };
}

test("executable-copy observation forwards a real copy and exact chmod", (t) => {
	const { source, destination, mode, observation } = fixture(t);
	copyFileSync(source, destination);
	chmodSync(destination, mode);
	observation.assertCopiedTo(destination);
	assert.equal(readFileSync(destination, "utf8"), "real executable bytes");
	if (process.platform !== "win32") assert.equal(lstatSync(destination).mode & 0o111, 0o111);
});

test("executable-copy fixture retains exact permissions under a restrictive umask", (t) => {
	const previousMask = process.umask(0o077);
	try {
		const { source, destination, mode, observation } = fixture(t);
		copyFileSync(source, destination);
		chmodSync(destination, mode);
		observation.assertCopiedTo(destination);
	} finally {
		process.umask(previousMask);
	}
});

for (const [label, chmod] of [
	["omitted chmod", () => {}],
	["non-executable mode", (_source, destination) => chmodSync(destination, 0o644)],
	["partial execute mode", (_source, destination) => chmodSync(destination, 0o754)],
	["wrong same-basename target", (source) => chmodSync(source, 0o755)],
	[
		"later non-executable mode",
		(_source, destination) => {
			chmodSync(destination, 0o755);
			chmodSync(destination, 0o644);
		},
	],
]) {
	test(`executable-copy observation rejects ${label}`, (t) => {
		const { source, destination, observation } = fixture(t);
		copyFileSync(source, destination);
		chmod(source, destination);
		assert.throws(() => observation.assertCopiedTo(destination), /staging must chmod the exact copied executable/u);
	});
}

test("executable-copy observation rejects omitted copy even after a successful chmod", (t) => {
	const { destination, mode, observation } = fixture(t);
	writeFileSync(destination, "not copied");
	chmodSync(destination, mode);
	assert.throws(() => observation.assertCopiedTo(destination), /staging must copy the executable/u);
});

test("executable-copy observation forwards chmod failures without recording success", (t) => {
	const { destination, mode, observation } = fixture(t);
	assert.throws(() => chmodSync(destination, mode), { code: "ENOENT" });
	assert.deepEqual(observation.chmods, []);
});
