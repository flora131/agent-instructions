import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
	BASELINE,
	DOCS,
	digest,
	MAIN,
	normalize,
	orderedContains,
	PR,
	PROVENANCE,
	splitBlocks,
	verifyCommittedDocumentation,
	verifyWorkingTreeDocumentation,
} from "./verify-docs-preservation.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");
const manifest = JSON.parse(read(`${PROVENANCE}manifest.json`));
const mapRows = (source) => manifest[`${source}_map`].flatMap((name) => JSON.parse(read(PROVENANCE + name)));
const check = (overrides = new Map()) => verifyWorkingTreeDocumentation({ repoRoot, overrides });

// #2847: neither a current-tree snapshot nor the old baseline alone proves the reconciliation.
test("two immutable source corpora and the original PR connective content are preserved", () => {
	const result = check();
	assert.deepEqual([result.baseline.pages, result.baseline.blocks], [44, 1038]);
	assert.deepEqual([result.main.pages, result.main.blocks], [47, 1090]);
	assert.equal(result.main.active, 1090);
	assert.equal(result.main.historical, 0);
	assert.deepEqual(result.prConnective, { blocks: 514, lines: 1255 });
	assert.equal(result.readerPages, 85);
});

function deletionFixture(source, kind) {
	const candidates = mapRows(source).filter((row) =>
		source === "baseline"
			? row.status === "historical"
			: row.target.path === `${DOCS}background-tasks.md` && row.source_anchor !== null,
	);
	for (const row of candidates) {
		const lines = read(row.target.path).split("\n");
		const block = row.target.lines
			? { start: row.target.lines[0], end: row.target.lines[1] }
			: splitBlocks(lines.join("\n")).find((entry) => entry.anchor === row.target.anchor);
		let fenced = false;
		let executableExample = false;
		for (let index = block.start - 1; index < block.end; index++) {
			const line = lines[index];
			const marker = /^\s*(```|~~~)(\S*)/u.exec(line);
			if (marker) {
				if (!fenced) executableExample = /^(ts|typescript|bash|sh|json|javascript)$/u.test(marker[2]);
				fenced = !fenced;
				continue;
			}
			const prose = !fenced && /^[A-Za-z]/u.test(line) && line.length > 50;
			const match =
				kind === "example"
					? fenced && executableExample && line.trim().length > 12
					: kind === "table"
						? !fenced && /^\|[^|]*[A-Za-z`]/u.test(line) && !/^\|\s*[-:]/u.test(lines[index + 1] ?? "")
						: kind === "caveat"
							? prose && /\b(not|never|cannot)\b/iu.test(line)
							: prose;
			if (!match) continue;
			lines[index] = ""; // Preserve all other spans; never write to source or destination files.
			return { overrides: new Map([[row.target.path, lines.join("\n")]]), row, removed: line };
		}
	}
	assert.fail(`no meaningful ${source} ${kind} negative-control specimen`);
}

for (const source of ["baseline", "main"]) {
	for (const kind of ["prose", "example", "table", "caveat"]) {
		test(`${source} source proof rejects deleted ${kind}, without mutating files`, () => {
			const fixture = deletionFixture(source, kind);
			const before = digest(read(fixture.row.target.path));
			assert.throws(() => check(fixture.overrides), new RegExp(`${source}:.*source prose/example/table/caveat`));
			assert.equal(digest(read(fixture.row.target.path)), before);
		});
	}
}

function changedJSON(path, change) {
	const value = JSON.parse(read(path));
	change(value);
	return new Map([[path, JSON.stringify(value)]]);
}

for (const field of ["main_inventory", "main_map", "baseline_map", "pr_connective"]) {
	test(`omitting a ${field} row cannot reduce the preservation universe`, () => {
		const path = PROVENANCE + manifest[field][0];
		assert.throws(
			() => check(changedJSON(path, (rows) => rows.splice(1, 1))),
			/reconstruct|missing or multiply claimed/u,
		);
	});
}

test("main inventory digest tampering fails independent reconstruction", () => {
	const path = PROVENANCE + manifest.main_inventory[0];
	assert.throws(
		() =>
			check(
				changedJSON(path, (rows) => {
					rows[0].sha256 = "0".repeat(64);
				}),
			),
		/independently reconstruct/u,
	);
});

test("duplicate source IDs and duplicate destination occurrences fail", () => {
	const path = PROVENANCE + manifest.main_map[0];
	assert.throws(
		() =>
			check(
				changedJSON(path, (rows) => {
					rows[1].id = rows[0].id;
				}),
			),
		/multiply claimed/u,
	);
	assert.throws(
		() =>
			check(
				changedJSON(path, (rows) => {
					rows[1].target = rows[0].target;
				}),
			),
		/claimed twice/u,
	);
});

test("an arbitrary archive cannot satisfy current main coverage", () => {
	const path = PROVENANCE + manifest.main_map[0];
	assert.throws(
		() =>
			check(
				changedJSON(path, (rows) => {
					rows[0].status = "historical";
					rows[0].active = rows[0].target;
					rows[0].target = { path: "docs/migrations/2847-history/citation-corrections.md", lines: [9, 38] };
				}),
			),
		/main cannot be satisfied by an arbitrary archive/u,
	);
});

test("correction policy cannot be expanded by changing its accompanying checksum", () => {
	const corrections = JSON.parse(read(`${PROVENANCE}corrections.json`));
	corrections.push({ path: "background-tasks.md", old: "do not", new: "do", reason: "pretend approval" });
	const altered = { ...manifest, corrections_sha256: digest(JSON.stringify(corrections)) };
	assert.throws(
		() =>
			check(
				new Map([
					[`${PROVENANCE}corrections.json`, JSON.stringify(corrections)],
					[`${PROVENANCE}manifest.json`, JSON.stringify(altered)],
				]),
			),
		/unreviewed correction policy/u,
	);
});

test("same-fragment rewrites cannot silently point at another valid page", () => {
	const shard = manifest.main_map.find((name) =>
		JSON.parse(read(PROVENANCE + name)).some((row) => row.edits.some((edit) => edit.kind === "link")),
	);
	const path = PROVENANCE + shard;
	assert.throws(
		() =>
			check(
				changedJSON(path, (rows) => {
					const row = rows.find((entry) => entry.edits.some((edit) => edit.kind === "link"));
					const edit = row.edits.find((entry) => entry.kind === "link");
					edit.to = edit.to.replace(/\]\([^#]+#/u, "](/quickstart#");
				}),
			),
		/route rewrite does not lead to the mapped content/u,
	);
});

test("reviewed supersession verifies both its full original and its current replacement", () => {
	const row = mapRows("main").find(
		(entry) => entry.source_path === "subagents.md" && entry.source_anchor === "task-inspection",
	);
	assert.ok(row.history);
	const history = read(row.history.path).split("\n");
	history[row.history.lines[0] + 1] = "lost historical source sentence";
	assert.throws(
		() => check(new Map([[row.history.path, history.join("\n")]])),
		/correction history lost source text/u,
	);
	const current = read(row.target.path).replace(
		"Completed tasks leave the live indicator",
		"Completed tasks stay in the live indicator",
	);
	assert.notEqual(current, read(row.target.path));
	assert.throws(() => check(new Map([[row.target.path, current]])), /source prose\/example\/table\/caveat/u);
});

test("normalization is limited to blank lines, trailing space, and prose heading depth", () => {
	assert.equal(normalize("## Label  \n\nBody\t\n"), normalize("# Label\nBody"));
	for (const [before, after] of [
		["```sh\n# comment\n```", "```sh\n## comment\n```"],
		["cost 10", "cost 11"],
		["[source](https://one.test)", "[source](https://two.test)"],
		["  indented", "indented"],
		["must not proceed", "must proceed"],
		["[events](/extensions#events)", "[events](/extensions/events#events)"],
	])
		assert.notEqual(normalize(before), normalize(after));
	assert.equal(orderedContains("same\nsame", "same"), false);
	assert.equal(orderedContains("first\nsecond", "second\nfirst"), false);
	assert.equal(orderedContains("first\nsecond", "first\nconnective\nsecond"), true);
});

test("baseline and main identities cannot be swapped or advanced to a moving ref", () => {
	for (const value of [MAIN, "origin/main"]) {
		assert.throws(() =>
			check(
				changedJSON(`${PROVENANCE}manifest.json`, (record) => {
					record.baseline = value;
				}),
			),
		);
	}
	assert.equal(manifest.baseline, BASELINE);
	assert.equal(manifest.pr, PR);
});

test("committed API and data-URL import never fall back to working-tree provenance", async () => {
	// PR predates the supplemental manifests. They exist in the worktree, but must not rescue it.
	assert.throws(() => verifyCommittedDocumentation({ repoRoot, revision: PR }), /manifest\.json/u);
	const source = read("scripts/verify-docs-preservation.mjs");
	const imported = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
	assert.equal(typeof imported.verifyCommittedDocumentation, "function");
	assert.throws(() => imported.verifyCommittedDocumentation({ repoRoot, revision: PR }), /manifest\.json/u);
});

test("long code fences keep embedded short fences and example headings inside code", () => {
	const text = "# Guide\n````markdown\n```sh\n# shell comment\n```\n## still code\n````\n## Real heading\n";
	assert.deepEqual(
		splitBlocks(text).map((block) => block.anchor),
		["guide", "real-heading"],
	);
	assert.ok(normalize(text).includes("## still code"));
});

test("the external stdin wrapper can import the verifier through a data URL", async () => {
	const { spawnSync } = await import("node:child_process");
	const source = read("scripts/verify-docs-preservation.mjs");
	const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
		input: `const module = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)}); if (typeof module.verifyCommittedDocumentation !== 'function') process.exit(2);`,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(child.status, 0, child.stderr);
});

test("duplicate occurrence identity is independent of manifest object-key order", () => {
	const shard = manifest.main_map.find((name) =>
		JSON.parse(read(PROVENANCE + name)).some((row) => row.id === "rpc::048"),
	);
	const first = mapRows("main").find((row) => row.id === "rpc::005");
	assert.throws(
		() =>
			check(
				changedJSON(PROVENANCE + shard, (rows) => {
					rows.find((row) => row.id === "rpc::048").target = {
						occurrence: first.target.occurrence,
						anchor: first.target.anchor,
						path: first.target.path,
					};
				}),
			),
		/claimed twice/u,
	);
});

test("original PR connective prose is independently checked, not only snapshotted", () => {
	const path = `${DOCS}build.md`;
	const paragraph =
		"Build covers everything you add to Atomic: customization mechanisms that change how a session behaves, and programmatic interfaces that embed Atomic in your own software.";
	assert.ok(read(path).includes(paragraph));
	assert.throws(() => check(new Map([[path, read(path).replace(paragraph, "")]])), /PR connective content missing/u);
});

test("historical originals cannot substitute for still-valid reader-facing release facts", () => {
	const path = `${DOCS}development.md`;
	const paragraph =
		"Atomic's release bases remain at the `0.0.0` placeholder. `scripts/cut-release.ts` stamps the real version only on a detached tagged release commit.";
	assert.ok(read(path).includes(paragraph));
	assert.throws(
		() => check(new Map([[path, read(path).replace(paragraph, "")]])),
		/still-valid original prose fragment lost/u,
	);
});

test("additive containment requires the exact disclosed additive lines", () => {
	const shard = manifest.main_map.find((name) =>
		JSON.parse(read(PROVENANCE + name)).some((row) => row.mode === "ordered"),
	);
	assert.throws(
		() =>
			check(
				changedJSON(PROVENANCE + shard, (rows) => {
					rows.find((row) => row.mode === "ordered").additions.pop();
				}),
			),
		/additive content was not precisely disclosed/u,
	);
});

test("still-valid retention claims cannot omit reviewed source lines", () => {
	assert.throws(
		() =>
			check(
				changedJSON(`${PROVENANCE}reader-retention.json`, (rows) => {
					rows[0].source_line_numbers.pop();
				}),
			),
		/reviewed still-valid reader retention changed/u,
	);
});
