import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
	BASELINE,
	DOCS,
	digest,
	FIRST_RECONCILIATION,
	FOLLOWUP,
	FOURTH_FOLLOWUP,
	FOURTH_MAIN,
	FOURTH_PREDECESSOR,
	FOURTH_README,
	fourthMainEvidence,
	HISTORY_PARTS,
	LATEST_MAIN,
	latestMainEvidence,
	MAIN,
	normalize,
	orderedContains,
	PR,
	PRE_REBASE,
	PROVENANCE,
	REBASE_FOLLOWUP,
	REBASE_MAIN,
	REBASE_README,
	REVIEW_PREDECESSOR,
	REVIEW_README,
	REVIEW_REPAIRS,
	readExactSource,
	rebaseMainEvidence,
	reconstructFourthMainDelta,
	reconstructLatestMainDelta,
	reconstructRebaseMainDelta,
	reconstructWaitMainDelta,
	SECOND_RECONCILIATION,
	splitBlocks,
	verifyCommittedDocumentation,
	verifyWorkingTreeDocumentation,
	WAIT_FOLLOWUP,
	WAIT_MAIN,
	waitMainEvidence,
} from "./verify-docs-preservation.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");
const manifest = JSON.parse(read(`${PROVENANCE}manifest.json`));
const mapRows = (source) => manifest[`${source}_map`].flatMap((name) => JSON.parse(read(PROVENANCE + name)));
const check = (overrides = new Map()) => verifyWorkingTreeDocumentation({ repoRoot, overrides });

test("true-rebased preservation proves the selected main and every earlier layer", () => {
	const result = check();
	assert.equal(result.rebaseMain.revision, "fadc434c561da387db764b53f41367fedf721a95");
	assert.equal(result.rebaseMain.predecessor, "5053a6aa244d7b97346c99f2b508e56783c42fa8");
	assert.equal(result.rebaseMain.changedPages, 2);
	assert.equal(result.rebaseMain.edits, 9);
	assert.equal(result.rebaseMain.activeRetentions, 3);
	assert.equal(result.authoringReferenceAdditions, 5);
	assert.equal(result.reviewRepairs.aliases, 8);
});

// #2847: neither a current-tree snapshot nor the old baseline alone proves the reconciliation.
test("two immutable source corpora and the original PR connective content are preserved", () => {
	const result = check();
	assert.deepEqual([result.baseline.pages, result.baseline.blocks], [44, 1038]);
	assert.deepEqual([result.main.pages, result.main.blocks], [47, 1090]);
	assert.equal(result.main.active, 1090);
	assert.equal(result.main.historical, 0);
	assert.deepEqual(result.prConnective, { blocks: 514, lines: 1255 });
	assert.equal(result.readerPages, 86);
	assert.deepEqual(result.latestMain, { revision: LATEST_MAIN, pages: 47, unchangedPages: 44, edits: 5 });
	assert.equal(result.readerAnchorRepairs, 4);
	assert.deepEqual(result.waitMain, {
		revision: "32059e25f6608770280eacc0285b49a454a3f2f0",
		pages: 47,
		unchangedPages: 45,
		edits: 3,
		compatibilityPointers: 1,
	});
	assert.deepEqual(result.fourthMain, {
		revision: FOURTH_MAIN,
		pages: 48,
		unchangedPages: 33,
		changedPages: 14,
		newPages: 1,
		edits: 44,
		readerRepairs: 11,
	});
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

// #2847 / PR #2971: newest-main proof is a closed source delta, not a refreshed reader hash.
const latestDelta = reconstructLatestMainDelta(repoRoot);
const waitDelta = reconstructWaitMainDelta(repoRoot);
for (const [index, edit] of latestDelta.edits.entries()) {
	test(`latest-main addition ${index + 1} cannot be deleted or tampered with at ${edit.target_path}`, () => {
		const text = read(edit.target_path);
		// New wait prose splits the older background-shell hunk. Reconstruct its exact
		// predecessor view, but delete the original added lines from the real current reader.
		let previousView = text;
		for (const waitEdit of [...waitDelta.edits].reverse().filter((row) => row.target_path === edit.target_path))
			previousView = previousView.replace(waitEdit.after, () => waitEdit.before);
		assert.ok(previousView.includes(edit.after));
		const addedLines = edit.after.split("\n").filter((line) => line && !edit.before.split("\n").includes(line));
		for (const line of addedLines) assert.ok(text.includes(line));
		const deleted = addedLines.reduce((have, line) => have.replace(line, ""), text);
		assert.notEqual(deleted, text);
		assert.throws(() => check(new Map([[edit.target_path, deleted]])), /latest-main delta must occur exactly once/u);
		const addedLine = edit.after.split("\n").find((line) => line && !edit.before.split("\n").includes(line));
		assert.ok(addedLine);
		assert.throws(
			() => check(new Map([[edit.target_path, text.replace(addedLine, `${addedLine} altered`)]])),
			/latest-main delta must occur exactly once/u,
		);
	});
}

test("latest-main source inventory covers every page and rejects omitted or forged evidence", () => {
	assert.deepEqual(JSON.parse(read(FOLLOWUP)), latestMainEvidence(latestDelta));
	assert.equal(latestDelta.pages.length, 47);
	assert.deepEqual(
		latestDelta.pages.filter((page) => !page.unchanged).map((page) => page.path),
		["background-tasks.md", "sdk.md", "tools.md"].map((path) => DOCS + path),
	);
	for (const change of [
		(record) => record.unchanged_source_paths.pop(),
		(record) => record.changed_source_pages.pop(),
		(record) => record.edits.pop(),
		(record) => {
			record.source_trees.unchanged_sha256 = "0".repeat(64);
		},
		(record) => {
			record.edits[0].after_sha256 = "0".repeat(64);
		},
		(record) => {
			record.edits[1].target_path = `${DOCS}sdk.md`;
		},
	])
		assert.throws(() => check(changedJSON(FOLLOWUP, change)), /latest-main evidence does not reconstruct/u);
});

test("SDK additions are active in its reference and the SDK hub preserves its predecessor plus exact repairs", async () => {
	const oldHub = readExactSource({ repoRoot, revision: FIRST_RECONCILIATION, path: `${DOCS}sdk.md` });
	const pointer = waitDelta.compatibility_pointers[0];
	// #2847 / PR #2971: preserve the entire hub, with only the reviewed image-shape correction.
	const oldImage = '  images: [{ type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } }]';
	const currentImage = '  images: [{ type: "image", data: "...", mimeType: "image/png" }]';
	assert.equal(oldHub.split(oldImage).length, 2);
	assert.equal(
		read(`${DOCS}sdk.md`),
		oldHub.replace(pointer.before, () => pointer.after).replace(oldImage, () => currentImage),
	);
	for (const edit of latestDelta.edits.filter((row) => row.source_path === `${DOCS}sdk.md`))
		assert.ok(read(`${DOCS}sdk/reference.md`).includes(edit.after));
	const path = `${DOCS}sdk/reference.md`;
	const sentence = "Specify which tools to expose by name:";
	assert.throws(() => check(new Map([[path, read(path).replace(sentence, "")]])), /latest-main delta/u);
});

test("exact closure rejects old whitespace loss and frozen manifest reformatting", () => {
	const path = `${DOCS}build.md`;
	assert.ok(read(path).includes("\n\n"));
	assert.throws(() => check(new Map([[path, read(path).replace("\n\n", "\n")]])), /latest-main exact preservation/u);
	const manifestPath = `${PROVENANCE}manifest.json`;
	assert.throws(() => check(new Map([[manifestPath, `${read(manifestPath)}\n`]])), /latest-main exact preservation/u);
});

test("committed predecessor proof works from a data URL with filesystem document reads forbidden", async () => {
	const { spawnSync } = await import("node:child_process");
	const source = read("scripts/verify-docs-preservation.mjs");
	const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
		cwd: repoRoot,
		input: `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
		const module = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)});
		fs.readFileSync = fs.readdirSync = () => { throw new Error('working-tree read forbidden'); };
		syncBuiltinESMExports();
		const result = module.verifyCommittedDocumentation({repoRoot: ${JSON.stringify(repoRoot)}, revision: module.FIRST_RECONCILIATION});
		if (result.readerPages !== 85 || module.MAIN !== ${JSON.stringify(MAIN)}) process.exit(2);
		try { module.verifyCommittedDocumentation({repoRoot: ${JSON.stringify(repoRoot)}, revision: module.LATEST_MAIN}); process.exit(3); }
		catch (error) { if (!error.message.includes(module.FOLLOWUP)) throw error; }`,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(child.status, 0, child.stderr);
});

test("latest-main executable example and cancellation caveats cannot be lost behind retained headings", () => {
	for (const [path, fragment] of [
		["background-tasks.md", "\nkill({ id: taskId })\n"],
		["background-tasks.md", "Cleanup failures remain errors, not successful stops."],
		["tools.md", "A request is not confirmation of termination."],
		["sdk/reference.md", "Without a binding they reject execution."],
	]) {
		const text = read(DOCS + path);
		assert.ok(text.includes(fragment));
		assert.throws(() => check(new Map([[DOCS + path, text.replace(fragment, "")]])), /latest-main delta/u);
	}
});

test("exact preservation compares original image bytes, not lossy UTF-8 strings", () => {
	const path = `${DOCS}images/workflow-graph.png`;
	const bytes = readFileSync(resolve(repoRoot, path));
	const changed = Buffer.from(bytes);
	// An invalid UTF-8 lead byte can decode to the same replacement character as another.
	const index = bytes.findIndex((byte, at) => byte === 0xff && bytes[at + 1] < 0x80);
	assert.ok(index >= 0);
	changed[index] = 0xfe;
	assert.equal(changed.toString("utf8"), bytes.toString("utf8"));
	assert.throws(() => check(new Map([[path, changed]])), /latest-main exact preservation/u);
});

// #2847 / PR #2971: the four reader repairs are additive, closed, and exactly positioned.
for (const repair of latestDelta.reader_anchor_repairs) {
	test(`reader anchor ${repair.id} cannot be missing, forged, moved, fenced, or duplicated`, () => {
		const text = read(repair.target_path);
		const exact = `${repair.addition}${repair.heading}\n`;
		assert.equal(text.split(exact).length, 2);
		for (const replacement of [
			`${repair.heading}\n`,
			exact.replace(`id="${repair.id}"`, 'id="forged"'),
			`${repair.heading}\n\n${repair.addition}`,
			`\`\`\`html\n${repair.addition}\`\`\`\n${repair.heading}\n`,
			`${repair.addition}${exact}`,
		]) {
			assert.throws(() => check(new Map([[repair.target_path, text.replace(exact, replacement)]])));
		}
	});
}

test("reader-anchor evidence cannot authorize omitted, forged, or arbitrary additions", () => {
	assert.equal(latestDelta.reader_anchor_repairs.length, 4);
	for (const change of [
		(record) => record.reader_anchor_repairs.pop(),
		(record) => {
			record.reader_anchor_repairs[0].id = "forged";
		},
		(record) => {
			record.reader_anchor_repairs[0].addition = '<a id="forged" />\n\n';
		},
		(record) => {
			record.reader_anchor_repairs[0].predecessor_heading_line++;
		},
		(record) => {
			record.reader_anchor_repairs[0].heading = "#### 3. Adversarial verification";
		},
		(record) => record.reader_anchor_repairs.push({ ...record.reader_anchor_repairs[0], id: "arbitrary" }),
	])
		assert.throws(() => check(changedJSON(FOLLOWUP, change)), /latest-main evidence does not reconstruct/u);
	const repair = latestDelta.reader_anchor_repairs[0];
	const text = read(repair.target_path);
	assert.throws(() => check(new Map([[repair.target_path, `${text}\n<a id="arbitrary" />\n`]])));
	// Even forged matching evidence and reader bytes cannot extend the closed policy.
	const overrides = changedJSON(FOLLOWUP, (record) => {
		record.reader_anchor_repairs[0].id = "forged";
		record.reader_anchor_repairs[0].addition = '<a id="forged" />\n\n';
	});
	overrides.set(repair.target_path, text.replace(`id="${repair.id}"`, 'id="forged"'));
	assert.throws(() => check(overrides), /latest-main evidence does not reconstruct/u);
});

// #2847 / PR #2971: PR #2972 guidance must remain active, not merely archived.
for (const [index, edit] of waitDelta.edits.entries()) {
	test(`wait-main source hunk ${index + 1} rejects deletion and tampering`, () => {
		const text = read(edit.target_path);
		assert.equal(text.split(edit.after).length, 2);
		const added = edit.after.split("\n").filter((line) => line && !edit.before.split("\n").includes(line));
		assert.ok(added.length > 0);
		for (const replacement of [edit.before, edit.after.replace(added[0], `${added[0]} altered`)])
			assert.throws(
				() => check(new Map([[edit.target_path, text.replace(edit.after, () => replacement)]])),
				/latest-main delta/u,
			);
	});
}

test("wait-main examples and settled-output, ownership, UTF-8 and lifetime caveats cannot be deleted", () => {
	for (const [path, fragment] of [
		["background-tasks.md", 'bash({ action: "wait", id: taskId, budgetMs: 1000 })'],
		["background-tasks.md", 'powershell({ action: "wait", id: taskId, budgetMs: 1000 })'],
		["background-tasks.md", "Settled waits return all retained output again"],
		["background-tasks.md", "Waiting never extends the original execution timeout or the owner's lifetime."],
		["sdk/reference.md", "Partial UTF-8 characters continue on the next page."],
		["sdk/reference.md", "Custom `operations.exec` does not provide existing-task ownership."],
	]) {
		const text = read(DOCS + path);
		assert.ok(text.includes(fragment));
		assert.throws(() => check(new Map([[DOCS + path, text.replace(fragment, "")]])), /latest-main delta/u);
	}
});

test("wait-main evidence rejects source omissions, forged hunks and missing compatibility disclosure", () => {
	assert.deepEqual(JSON.parse(read(WAIT_FOLLOWUP)), waitMainEvidence(waitDelta));
	assert.equal(waitDelta.latest_main, WAIT_MAIN);
	assert.equal(waitDelta.previous_main, LATEST_MAIN);
	assert.equal(waitDelta.predecessor, SECOND_RECONCILIATION);
	assert.equal(waitDelta.pages.length, 47);
	assert.equal(waitDelta.edits.length, 3);
	for (const mutate of [
		(record) => record.unchanged_source_paths.pop(),
		(record) => record.changed_source_pages.pop(),
		(record) => record.edits.pop(),
		(record) => record.compatibility_pointers.pop(),
		(record) => {
			record.edits[2].target_path = `${DOCS}sdk.md`;
		},
		(record) => {
			record.source_trees.unchanged_sha256 = "0".repeat(64);
		},
		(record) => {
			record.edits[0].after_sha256 = "0".repeat(64);
		},
	])
		assert.throws(() => check(changedJSON(WAIT_FOLLOWUP, mutate)), /wait-main evidence does not reconstruct/u);
});

test("wait-main SDK compatibility pointer cannot be deleted, retargeted or forged with matching evidence", () => {
	const pointer = waitDelta.compatibility_pointers[0];
	const text = read(pointer.target_path);
	assert.equal(text.split(pointer.after).length, 2);
	for (const replacement of [
		pointer.before,
		pointer.after.replace("#waiting-for-existing-shell-tasks", "#bash-tool-behavior"),
	])
		assert.throws(
			() => check(new Map([[pointer.target_path, text.replace(pointer.after, () => replacement)]])),
			/latest-main delta/u,
		);
	const forged = pointer.after.replace("#waiting-for-existing-shell-tasks", "#bash-tool-behavior");
	const overrides = changedJSON(WAIT_FOLLOWUP, (record) => {
		record.compatibility_pointers[0].after = forged;
	});
	overrides.set(
		pointer.target_path,
		text.replace(pointer.after, () => forged),
	);
	assert.throws(() => check(overrides), /wait-main evidence does not reconstruct/u);
});

test("wait-main freezes second-source evidence bytes including whitespace", () => {
	assert.throws(
		() => check(new Map([[FOLLOWUP, `${read(FOLLOWUP)}\n`]])),
		/immutable second-reconciliation evidence changed/u,
	);
});

test("committed second predecessor works from a data URL without filesystem document reads", async () => {
	const { spawnSync } = await import("node:child_process");
	const source = read("scripts/verify-docs-preservation.mjs");
	const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
		cwd: repoRoot,
		input: `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
		const module = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)});
		fs.readFileSync = fs.readdirSync = () => { throw new Error('working-tree read forbidden'); };
		syncBuiltinESMExports();
		const result = module.verifyCommittedDocumentation({repoRoot: ${JSON.stringify(repoRoot)}, revision: module.SECOND_RECONCILIATION});
		if (result.readerPages !== 85 || result.latestMain.revision !== module.LATEST_MAIN || 'waitMain' in result) process.exit(2);`,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(child.status, 0, child.stderr);
});

// #2847 / PR #2971 review 3: exact additions never excuse loss of earlier content.
for (const [page, target] of [
	["skills/authoring.md", "/skills/reference#frontmatter"],
	["extensions/authoring.md", "/extensions/api-reference"],
	["extensions/events.md", "/extensions/api-reference#extensioncontext"],
	["extensions/ui.md", "/extensions/api-reference"],
	["extensions/examples.md", "/extensions/api-reference"],
]) {
	test(`${page} reference handoff is required verbatim and cannot mask prior content loss`, () => {
		const path = DOCS + page;
		const text = read(path);
		const start = text.lastIndexOf("\n## Next steps\n");
		assert.ok(start > 0);
		const addition = text.slice(start);
		assert.ok(addition.includes(`](${target})`));
		for (const changed of [
			text.slice(0, start),
			text.slice(0, start) + addition.replace(target, "/reference"),
			addition + text.slice(0, start),
		]) {
			assert.throws(() => check(new Map([[path, changed]])), /authoring reference addition differs/u);
		}
		assert.throws(() => check(new Map([[path, text + addition]])), /reader content changed/u);
		const retainedLine = text
			.slice(0, start)
			.split("\n")
			.find((line) => line.length > 100);
		assert.ok(retainedLine, `${page} must exercise substantive content, not a blank or heading`);
		assert.throws(
			() => check(new Map([[path, text.replace(retainedLine, "")]])),
			/source prose\/example\/table\/caveat (?:differs|missing or reordered)/u,
		);
	});
}

test("authoring reference handoffs are counted separately from immutable source reconciliation", () => {
	assert.equal(check().authoringReferenceAdditions, 5);
});

// #2847 / PR #2971 review 3: the fourth capture must be active, not an archive-only claim.
test("fourth-main computer-use recipes and platform caveats cannot disappear", () => {
	const path = `${DOCS}computer-use.md`;
	const text = read(path);
	for (const fragment of ["pyautogui", "AppleScript", "VBA", "Accessibility"]) {
		assert.ok(text.includes(fragment), `missing specimen ${fragment}`);
		assert.throws(() => check(new Map([[path, text.replace(fragment, "")]])), /fourth-main new page differs/u);
	}
});

const fourthDelta = reconstructFourthMainDelta(repoRoot);
for (const path of new Set(fourthDelta.reader_edits.map((edit) => edit.source_path))) {
	test(`fourth-main changed source remains active: ${path}`, () => {
		const edit = fourthDelta.reader_edits.find((row) => row.source_path === path);
		const added = edit.after.split("\n").find((line) => line.length > 20 && !edit.before.split("\n").includes(line));
		assert.ok(added, `no substantive changed specimen for ${path}`);
		const text = read(edit.target_path);
		assert.ok(text.includes(added));
		assert.throws(() => check(new Map([[edit.target_path, text.replace(added, "")]])), /latest-main delta/u);
	});
}

test("fourth-main evidence cannot omit sources, invent history or authorize matching reader edits", () => {
	assert.deepEqual(JSON.parse(read(FOURTH_FOLLOWUP)), fourthMainEvidence(fourthDelta));
	assert.equal(fourthDelta.predecessor, FOURTH_PREDECESSOR);
	assert.equal(fourthDelta.previous_main, WAIT_MAIN);
	for (const change of [
		(record) => record.edits.pop(),
		(record) => record.unchanged_source_paths.pop(),
		(record) => record.changed_source_paths.pop(),
		(record) => record.new_pages.pop(),
		(record) => {
			record.history.revision = "HEAD";
		},
		(record) => {
			record.new_pages[0].target_path = "docs/migrations/arbitrary-history.md";
		},
		(record) => {
			record.reader_repairs_sha256 = "0".repeat(64);
		},
	])
		assert.throws(() => check(changedJSON(FOURTH_FOLLOWUP, change)), /fourth-main evidence does not reconstruct/u);
});

test("fourth-main default inventories and observation repair cannot be reverted or forged", () => {
	for (const repair of fourthDelta.reader_repairs.filter((row) =>
		/default-tool|windows-tool|bash-observation/u.test(row.kind),
	)) {
		const text = read(repair.target_path);
		assert.ok(text.includes(repair.after));
		for (const replacement of [repair.before, `${repair.after.trimEnd()} altered\n`])
			assert.throws(
				() => check(new Map([[repair.target_path, text.replace(repair.after, () => replacement)]])),
				/latest-main delta/u,
			);
	}
});

test("fourth-main anchors, navigation and compatibility pointers cannot disappear", () => {
	for (const repair of fourthDelta.reader_repairs.filter((row) => /anchor|pointer|navigation/u.test(row.kind))) {
		let text = read(repair.target_path);
		// The maintainer pointer precedes the desktop alias; remove only this repair's addition.
		const publishedPointer = reconstructRebaseMainDelta(repoRoot).reader_repairs[0];
		const after = repair.after.replace(publishedPointer.before, () => publishedPointer.after);
		assert.ok(text.includes(after));
		text = text.replace(after, () => repair.before);
		assert.throws(() => check(new Map([[repair.target_path, text]])), /latest-main delta/u);
	}
});

test("fourth-main preserves the active source-checkout recipe and immutable earlier evidence", () => {
	const recipe = fourthDelta.maintainer_retention;
	assert.equal(read(recipe.target_path), recipe.text);
	assert.throws(
		() => check(new Map([[recipe.target_path, recipe.text.replace("No provider credentials are needed.", "")]])),
		/fourth-main active maintainer recipe differs/u,
	);
	assert.throws(
		() => check(new Map([[WAIT_FOLLOWUP, `${read(WAIT_FOLLOWUP)}\n`]])),
		/immutable third-reconciliation evidence changed/u,
	);
	assert.throws(
		() => check(new Map([[FOURTH_README, `${read(FOURTH_README)}\n`]])),
		/fourth-main provenance explanation changed/u,
	);
});

test("fourth-main repair retains the complete bash snapshot table, not just its heading", () => {
	const path = `${DOCS}reference/cli.md`;
	const text = read(path);
	const row = text.split("\n").find((line) => line.startsWith("| `ATOMIC_SESSION_ID`"));
	assert.ok(row);
	assert.throws(() => check(new Map([[path, text.replace(row, "")]])), /source prose\/example\/table\/caveat/u);
});

// #2847 / PR #2971: file-by-file Git children exhausted the existing unit-test budget under load.
test("cold data-URL verification batches each immutable blob once and isolates working overrides", async () => {
	const { spawnSync } = await import("node:child_process");
	const source = read("scripts/verify-docs-preservation.mjs");
	const moduleURL = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
	const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
		cwd: repoRoot,
		input: `import assert from 'node:assert/strict';
		import cp from 'node:child_process';
		import fs from 'node:fs';
		import { syncBuiltinESMExports } from 'node:module';
		const execute = cp.execFileSync;
		const calls = [];
		cp.execFileSync = (command, args, options) => {
			if (command === 'git') calls.push({ args: args.slice(2), input: options.input, encoding: options.encoding });
			return execute(command, args, options);
		};
		syncBuiltinESMExports();
		const verifier = await import(${JSON.stringify(moduleURL)});
		const repoRoot = ${JSON.stringify(repoRoot)};
		const committed = verifier.verifyCommittedDocumentation({ repoRoot });
		assert.equal(committed.readerPages, 86);
		assert.equal(committed.fourthMain.pages, 48);
		const beforeRepeat = calls.length;
		assert.deepEqual(verifier.verifyCommittedDocumentation({ repoRoot }), committed);
		assert.deepEqual(calls.slice(beforeRepeat).map(call => call.args[0]), ['rev-parse']);
		const path = verifier.DOCS + 'computer-use.md';
		const text = fs.readFileSync(repoRoot + '/' + path, 'utf8');
		const overrides = new Map([[path, text.replace('pyautogui', '')]]);
		assert.throws(() => verifier.verifyWorkingTreeDocumentation({ repoRoot, overrides }), /fourth-main new page differs/u);
		assert.equal(verifier.verifyWorkingTreeDocumentation({ repoRoot }).readerPages, 86);
		assert.throws(() => verifier.verifyWorkingTreeDocumentation({ repoRoot, overrides }), /fourth-main new page differs/u);
		const batches = calls.filter(call => call.args[0] === 'cat-file');
		assert.ok(batches.length > 0);
		const objects = batches.flatMap(call => {
			assert.deepEqual(call.args, ['cat-file', '--batch']);
			assert.equal(call.encoding, null, 'batch must preserve raw image bytes');
			return call.input.trim().split('\\n');
		});
		assert.ok(objects.length > batches.length, 'read corpora, not one process per file');
		assert.equal(new Set(objects).size, objects.length, 'unchanged blobs must be shared across revisions');
		assert.ok(objects.every(oid => /^[a-f0-9]{40}$/u.test(oid)), 'cache only immutable object IDs');
		assert.deepEqual(calls.filter(call => call.args[0] === 'show'), [], 'no per-file Git children');`,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(child.status, 0, child.stderr);
});

// #2847 / PR #2971 review 1: corrections must not rewrite the previously proved corpus.
test("review repairs preserve the immutable checkpoint and expose eight compatible fragments", () => {
	const result = check();
	assert.equal(result.reviewRepairs.predecessor, "98acef56143df33311536a23a9ea95d796a61ed9");
	assert.equal(result.reviewRepairs.aliases, 8);
});

test("review repairs reject reverting or altering every authentication and SDK correction", () => {
	const policy = JSON.parse(read(REVIEW_REPAIRS));
	for (const edit of policy.edits.filter((row) => row.kind !== "compatible-fragment")) {
		const text = read(edit.target_path);
		assert.ok(text.includes(edit.after));
		for (const replacement of [edit.before, `${edit.after} altered`]) {
			assert.throws(() => check(new Map([[edit.target_path, text.replace(edit.after, () => replacement)]])));
		}
	}
});

test("review repairs reject removing each compatible fragment", () => {
	const policy = JSON.parse(read(REVIEW_REPAIRS));
	const aliases = policy.edits.filter((row) => row.kind === "compatible-fragment");
	assert.equal(aliases.length, 8);
	for (const edit of aliases) {
		const text = read(edit.target_path);
		assert.ok(text.includes(edit.after));
		assert.throws(
			() => check(new Map([[edit.target_path, text.replace(edit.after, () => edit.before)]])),
			/latest-main delta must occur exactly once/u,
		);
	}
});

test("review repairs reject missing history and self-authorized policy changes", () => {
	const history = read(REVIEW_README);
	for (const replacement of ["", history.replace("mediaType", "mimeType")])
		assert.throws(() => check(new Map([[REVIEW_README, replacement]])), /review-repair history changed/u);
	const policy = JSON.parse(read(REVIEW_REPAIRS));
	const edit = policy.edits.find((row) => row.kind === "sdk-image-shape");
	const text = read(edit.target_path);
	const before = edit.after;
	edit.after = edit.before;
	assert.throws(
		() =>
			check(
				new Map([
					[REVIEW_REPAIRS, JSON.stringify(policy)],
					[edit.target_path, text.replace(before, () => edit.after)],
				]),
			),
		/review-repair policy changed/u,
	);
});

test("review repairs reject unrelated content edits on a corrected page", () => {
	const path = `${DOCS}sdk.md`;
	const text = read(path);
	assert.ok(text.includes('await session.prompt("What files are here?");'));
	assert.throws(() => check(new Map([[path, text.replace('await session.prompt("What files are here?");', "")]])));
});

test("review repairs leave committed checkpoint verification independent of working files", () => {
	const result = verifyCommittedDocumentation({ repoRoot, revision: REVIEW_PREDECESSOR });
	assert.equal(result.readerPages, 86);
	assert.equal(result.reviewRepairs, undefined);
});

test("rebase-main requires every new upstream hunk and complete, actively placed VBA retention", () => {
	const delta = reconstructRebaseMainDelta(repoRoot);
	assert.deepEqual(JSON.parse(read(REBASE_FOLLOWUP)), rebaseMainEvidence(delta));
	const path = `${DOCS}computer-use.md`;
	const current = read(path);
	const old = readExactSource({ repoRoot, revision: PRE_REBASE, path });
	assert.equal(delta.retentions[0].text, `${old.split("\n")[46]}\n`);
	assert.equal(delta.retentions[1].text, `${old.split("\n").slice(82, 112).join("\n")}\n`);
	assert.equal(delta.retentions[2].text, `${delta.retentions[2].prefix}${old.split("\n").slice(52, 54).join("\n")}\n`);
	let upstream = current;
	for (const retention of delta.retentions) {
		assert.ok(current.includes(retention.after));
		upstream = upstream.replace(retention.after, () => retention.before);
		for (const altered of [
			current.replace(retention.text, ""),
			current.replace(retention.text, "") + retention.text,
			current.replace(retention.text, () => `\`\`\`markdown\n${retention.text}\`\`\`\n`),
			current + retention.text,
		])
			assert.throws(() => check(new Map([[path, altered]])), /fourth-main new page differs/u);
	}
	assert.equal(upstream, readExactSource({ repoRoot, revision: REBASE_MAIN, path }));
	for (const edit of delta.edits) {
		const text = read(edit.target_path);
		const added = edit.after.split("\n").find((line) => line.length > 20 && !edit.before.split("\n").includes(line));
		assert.ok(added && text.includes(added));
		assert.throws(() => check(new Map([[edit.target_path, text.replace(added, "")]])), /delta|new page differs/u);
	}
	for (const fragment of ["deck.save(stream)", "Never enable all macros", "Saving as `.xlsx` cannot retain VBA"]) {
		assert.ok(current.includes(fragment));
		assert.throws(() => check(new Map([[path, current.replace(fragment, "")]])), /new page differs/u);
	}
});

test("rebase-main rejects missing or self-authorized supplemental policy and pointer changes", () => {
	for (const change of [
		(value) => value.edits.pop(),
		(value) => value.unchanged_source_paths.pop(),
		(value) => value.active_retentions.pop(),
		(value) => {
			value.predecessor = REBASE_MAIN;
		},
		(value) => {
			value.history_transport.sha256 = "0".repeat(64);
		},
	])
		assert.throws(() => check(changedJSON(REBASE_FOLLOWUP, change)), /rebase-main evidence does not reconstruct/u);
	assert.throws(() => check(new Map([[REBASE_README, ""]])), /rebase-main explanation changed/u);
	assert.throws(() => verifyCommittedDocumentation({ repoRoot, revision: REBASE_MAIN }), /2847-rebase-main\.json/u);
	const repair = reconstructRebaseMainDelta(repoRoot).reader_repairs[0];
	const text = read(repair.target_path);
	assert.ok(text.includes(repair.after));
	for (const replacement of [repair.before, repair.after.replace("/docs/", "/missing/")]) {
		const overrides = changedJSON(REBASE_FOLLOWUP, (policy) => {
			policy.reader_repairs[0].after = replacement;
		});
		overrides.set(
			repair.target_path,
			text.replace(repair.after, () => replacement),
		);
		assert.throws(() => check(overrides), /rebase-main evidence does not reconstruct/u);
		assert.throws(
			() => check(new Map([[repair.target_path, text.replace(repair.after, () => replacement)]])),
			/latest-main delta/u,
		);
	}
});

test("rebase-main requires authentic transport even with warm original-object caches", () => {
	assert.equal(check().rebaseMain.revision, REBASE_MAIN);
	for (const path of HISTORY_PARTS) {
		const bytes = readFileSync(resolve(repoRoot, path));
		const changed = Buffer.from(bytes);
		changed[changed.length - 1] ^= 1;
		assert.throws(() => check(new Map([[path, changed]])), /history transport checksum changed/u);
		assert.throws(() => check(new Map([[path, Buffer.alloc(0)]])), /history transport part size changed/u);
	}
	assert.equal(check().rebaseMain.revision, REBASE_MAIN);
});

test("cold committed rebase proof uses authentic disposable history without Git writes or working reads", async () => {
	const { execFileSync, spawnSync } = await import("node:child_process");
	const fs = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const directory = fs.mkdtempSync(resolve(tmpdir(), "docs-preservation-cold-"));
	const fixture = resolve(directory, "repo");
	const run = (args, input) =>
		execFileSync("git", ["-C", fixture, ...args], {
			input,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "Preservation fixture",
				GIT_AUTHOR_EMAIL: "fixture@example.invalid",
				GIT_COMMITTER_NAME: "Preservation fixture",
				GIT_COMMITTER_EMAIL: "fixture@example.invalid",
			},
		});
	const absent = () => {
		for (const revision of [PR, FIRST_RECONCILIATION, PRE_REBASE])
			assert.throws(
				() => run(["cat-file", "-e", `${revision}^{commit}`]),
				`original commit unexpectedly present: ${revision}`,
			);
	};
	try {
		const branch = execFileSync("git", ["-C", repoRoot, "branch", "--show-current"], { encoding: "utf8" }).trim();
		// Network-style transfer excludes backup refs and unreachable local checkpoints.
		execFileSync(
			"git",
			["clone", "--no-local", "--single-branch", "--no-checkout", "--branch", branch, repoRoot, fixture],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		absent();
		run(["read-tree", "HEAD"]);
		const files = [
			REBASE_FOLLOWUP,
			REBASE_README,
			...HISTORY_PARTS,
			`${DOCS}computer-use.md`,
			`${DOCS}workflows/verification.md`,
		];
		const put = (path, bytes) => {
			const oid = run(["hash-object", "-w", "--stdin"], bytes).trim();
			run(["update-index", "--add", "--cacheinfo", `100644,${oid},${path}`]);
		};
		for (const path of files) put(path, readFileSync(resolve(repoRoot, path)));
		const parent = run(["rev-parse", "HEAD"]).trim();
		const commit = () =>
			run(["commit-tree", run(["write-tree"]).trim(), "-p", parent], "isolated preservation candidate\n").trim();
		const candidate = commit();
		run(["update-ref", "HEAD", candidate]);
		assert.equal(run(["merge-base", candidate, REBASE_MAIN]).trim(), REBASE_MAIN);
		absent();
		const invalid = [];
		for (const path of HISTORY_PARTS) {
			const changed = Buffer.from(readFileSync(resolve(repoRoot, path)));
			changed[changed.length - 1] ^= 1;
			put(path, changed);
			invalid.push([commit(), "history transport checksum changed"]);
			run(["read-tree", candidate]);
			run(["update-index", "--force-remove", path]);
			invalid.push([commit(), "missing committed blob"]);
			run(["read-tree", candidate]);
		}
		// Artifact presence does not select rebase mode without selected-main ancestry.
		const noAncestry = run(["commit-tree", run(["write-tree"]).trim(), "-p", FOURTH_MAIN], "wrong ancestry\n").trim();
		invalid.push([noAncestry, "fourth-main requires all predecessor proofs"]);
		const originalLedger = "docs/migrations/2847-content-ledger.md";
		put(originalLedger, `${read(originalLedger)}\n`);
		invalid.push([commit(), "immutable original provenance changed"]);
		run(["read-tree", candidate]);
		// There are deliberately no checked-out docs or bundle parts in this clone.
		assert.equal(fs.existsSync(resolve(fixture, REBASE_FOLLOWUP)), false);
		const gitState = () =>
			fs
				.readdirSync(resolve(fixture, ".git"), { recursive: true, withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => {
					const path = resolve(entry.parentPath, entry.name);
					return [path.slice(fixture.length), digest(readFileSync(path))];
				})
				.sort(([a], [b]) => a.localeCompare(b));
		const before = gitState();
		const source = read("scripts/verify-docs-preservation.mjs");
		const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
			cwd: fixture,
			input: `import assert from 'node:assert/strict'; import fs from 'node:fs'; import cp from 'node:child_process';
			import { syncBuiltinESMExports } from 'node:module';
			const owned = []; const make = fs.mkdtempSync; const write = fs.writeFileSync; const remove = fs.rmSync;
			fs.mkdtempSync = (...args) => { const path = make(...args); assert.match(path, /atomic-docs-history-/u); owned.push(path); return path; };
			fs.writeFileSync = (path, ...args) => { assert.ok(owned.some(root => path.startsWith(root + '/'))); return write(path, ...args); };
			fs.rmSync = (path, ...args) => { assert.ok(owned.includes(path)); return remove(path, ...args); };
			fs.readFileSync = fs.readdirSync = () => { throw new Error('working-tree read forbidden'); };
			const execute = cp.execFileSync; let imports = 0;
			cp.execFileSync = (command, args, options) => {
				if (args[2] === 'bundle') { imports++; assert.equal(args[3], 'unbundle');
					assert.ok(owned.some(root => options.env.GIT_OBJECT_DIRECTORY === root + '/objects')); }
				return execute(command, args, options);
			};
			syncBuiltinESMExports();
			const module = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)});
			const repoRoot = ${JSON.stringify(fixture)};
			const result = module.verifyCommittedDocumentation({ repoRoot });
			assert.equal(result.rebaseMain.revision, module.REBASE_MAIN);
			assert.equal(result.authoringReferenceAdditions, 5); assert.equal(result.reviewRepairs.aliases, 8);
			assert.ok(imports > 0, 'cold proof must unbundle authentic Git objects');
			assert.ok(owned.every(path => !fs.existsSync(path)), 'successful proof leaked temporary objects');
			for (const [revision, message] of ${JSON.stringify(invalid)}) {
				assert.throws(() => module.verifyCommittedDocumentation({ repoRoot, revision }), error => error.message.includes(message));
				assert.ok(owned.every(path => !fs.existsSync(path)), 'failed proof leaked temporary objects');
			}
			for (const [revision, pages] of [[module.FIRST_RECONCILIATION, 85], [module.SECOND_RECONCILIATION, 85],
				[module.FOURTH_PREDECESSOR, 85], [module.REVIEW_PREDECESSOR, 86], [module.PRE_REBASE, 86]]) {
				assert.equal(module.verifyCommittedDocumentation({ repoRoot, revision }).readerPages, pages);
				assert.ok(owned.every(path => !fs.existsSync(path)));
			}
			assert.equal(module.verifyCommittedDocumentation({ repoRoot }).rebaseMain.revision, module.REBASE_MAIN);`,
			encoding: "utf8",
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024,
		});
		assert.equal(child.status, 0, child.stderr);
		assert.deepEqual(gitState(), before, "verification changed original Git files/objects/refs");
		absent();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
