import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE = "59586efd26afd32a27c999ac8bcce102777e40e4";
export const PR = "24f58842493deb8ec15dea44ef7e25936feeea60";
export const MAIN = "cb13229bebe30ea7cb65689569569494b4bc651c";
export const DOCS = "packages/coding-agent/docs/";
export const FIRST_RECONCILIATION = "bf8dcd1bc02a7cb02caf557bb13d281b260c1704";
export const LATEST_MAIN = "daf6d2747ce95ae25d0b7e46660d92f0c39101d8";
export const FOLLOWUP = "docs/migrations/2847-latest-main.json";
export const WAIT_MAIN = "32059e25f6608770280eacc0285b49a454a3f2f0";
export const SECOND_RECONCILIATION = "37bbd794fdcafac4b883e31e46d95eb60c26923d";
export const WAIT_FOLLOWUP = "docs/migrations/2847-wait-main.json";
export const PROVENANCE = "docs/migrations/2847-reconciliation/";
export const FOURTH_MAIN = "7b2bf523216448ad4efb4b2e1c1e52fbcf0c2e12";
export const FOURTH_PREDECESSOR = "c075c61a7dcae05a767db7372d991f421b3fc507";
export const FOURTH_FOLLOWUP = "docs/migrations/2847-fourth-main.json";
export const FOURTH_README = "docs/migrations/2847-fourth-main.md";
const FOURTH_README_SHA256 = "19202517c989bb552d7f5e7fd3679cf3616fd541789664bfbc1156d2507572bb";
// #2847 / PR #2971 review 3: exact append-only reader handoffs, not upstream changes.
export const AUTHORING_PREDECESSOR = "8da40cc4ddb88b16baf8b4291722c6dabee8cfbb";
const authoringReferenceAdditions = new Map(
	[
		[
			"skills/authoring.md",
			"Check the skill reference for [frontmatter fields](/skills/reference#frontmatter) and [validation rules](/skills/reference#validation) before sharing your skill.",
		],
		[
			"extensions/authoring.md",
			"Continue with [extension events](/extensions/events) to hook into the session lifecycle. Use the [Extension API reference](/extensions/api-reference) to look up context properties and registration methods.",
		],
		[
			"extensions/events.md",
			"Continue with [extension UI](/extensions/ui) to add user interaction. Look up the context available to event handlers in the [Extension API reference](/extensions/api-reference#extensioncontext).",
		],
		[
			"extensions/ui.md",
			"Try the runnable [extension examples](/extensions/examples), and use the [Extension API reference](/extensions/api-reference) for context and method contracts.",
		],
		[
			"extensions/examples.md",
			"Use the [Extension API reference](/extensions/api-reference) to check the context properties and method contracts used by these examples.",
		],
	].map(([path, paragraph]) => [`${DOCS}${path}`, `\n## Next steps\n\n${paragraph}\n`]),
);
const originalArtifacts = ["2847-baseline-inventory.json", "2847-destination-map.json", "2847-content-ledger.md"];
const sourceCache = new Map();
// Closed reviewed corrections: changing both a manifest and its checksum cannot authorize prose edits.
const REVIEWED_CORRECTIONS_SHA256 = "89912afa14fa7efe86737b9c1c0db60f9a41e53357527f046b06ddcdeed523f7";
export const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const gitSnapshotCache = new Map();
const revisionBlobCache = new Map();
const blobCache = new Map();
const snapshotRoots = [DOCS, "docs/migrations/", "docs/2847-stage-skill-verification.md"];

/** Batch immutable trees once; share raw bytes across paths, revisions, and text/binary reads. */
function revisionBlobs(repoRoot, revision) {
	assert.match(revision, /^[a-f0-9]{40}$/u, "blob cache requires an immutable commit");
	const root = realpathSync(repoRoot);
	const key = `${root}:${revision}`;
	if (revisionBlobCache.has(key)) return revisionBlobCache.get(key);
	const tree = git(repoRoot, ["ls-tree", "-rz", revision, "--", ...snapshotRoots]);
	const paths = new Map();
	for (const entry of tree.split("\0").filter(Boolean)) {
		const match = /^\d+ blob ([a-f0-9]+)\t([\s\S]+)$/u.exec(entry);
		assert.ok(match, `unreadable tree entry ${entry}`);
		paths.set(match[2], match[1]);
	}
	const missing = [...new Set(paths.values())].filter((oid) => !blobCache.has(`${root}:${oid}`));
	if (missing.length) {
		const bytes = git(repoRoot, ["cat-file", "--batch"], `${missing.join("\n")}\n`, "buffer");
		let offset = 0;
		for (const oid of missing) {
			const headerEnd = bytes.indexOf(10, offset);
			assert.ok(headerEnd >= offset, `missing blob header ${oid}`);
			const header = bytes.subarray(offset, headerEnd).toString("utf8");
			assert.match(header, new RegExp(`^${oid} blob \\d+$`, "u"), `unreadable blob ${oid}`);
			const size = Number(header.split(" ")[2]);
			const end = headerEnd + 1 + size;
			assert.ok(Number.isSafeInteger(size) && end < bytes.length, `truncated blob ${oid}`);
			assert.equal(bytes[end], 10, `missing blob terminator ${oid}`);
			blobCache.set(`${root}:${oid}`, bytes.subarray(headerEnd + 1, end));
			offset = end + 1;
		}
		assert.equal(offset, bytes.length, "unexpected batch output");
	}
	const blobs = new Map([...paths].map(([path, oid]) => [path, blobCache.get(`${root}:${oid}`)]));
	revisionBlobCache.set(key, blobs);
	return blobs;
}

function git(repoRoot, args, input, encoding = "utf8") {
	if (args[0] === "show" && args.length === 2) {
		const match = /^([a-f0-9]{40}):(.+)$/u.exec(args[1]);
		if (
			match &&
			snapshotRoots.some((path) => match[2] === path || (path.endsWith("/") && match[2].startsWith(path)))
		) {
			const bytes = revisionBlobs(repoRoot, match[1]).get(match[2]);
			assert.ok(bytes, `missing committed blob ${args[1]}`);
			return encoding === "buffer" ? bytes : bytes.toString(encoding);
		}
	}
	const key = JSON.stringify([realpathSync(repoRoot), args, input, encoding]);
	// Resolve a caller's revision afresh; all subsequent reads use the resolved commit.
	const cacheable = args[0] !== "rev-parse";
	if (cacheable && gitSnapshotCache.has(key)) return gitSnapshotCache.get(key);
	const output = execFileSync("git", ["-C", repoRoot, ...args], {
		encoding: encoding === "buffer" ? null : encoding,
		input,
		timeout: 30_000,
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["pipe", "pipe", "pipe"],
	});
	if (cacheable) gitSnapshotCache.set(key, output);
	return output;
}

function nextFence(marker, fence) {
	if (!fence) return { character: marker[1][0], length: marker[1].length };
	return marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim() ? undefined : fence;
}

export function mintlifyAnchor(heading) {
	return heading
		.replace(/`([^`]*)`/gu, "$1")
		.replace(/\*\*([^*]*)\*\*/gu, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
		.toLowerCase()
		.replaceAll(".", "-")
		.replaceAll("'", "")
		.replaceAll("’", "")
		.replace(/["(),:?!]/gu, "-")
		.replace(/[^\w\s/&+\u2013\u2014-]/gu, "-")
		.trim()
		.replace(/\s+/gu, "-")
		.replace(/-{2,}/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

/** Heading depth is presentation, but a '#' inside a code fence is code. */
export function normalize(text) {
	let fence;
	return text
		.split("\n")
		.map((raw) => {
			let line = raw.replace(/\s+$/u, "");
			const marker = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
			if (marker) fence = nextFence(marker, fence);
			else if (!fence) line = line.replace(/^#{1,6}\s+(.*)$/u, "# $1");
			return line;
		})
		.filter(Boolean)
		.join("\n");
}

/** Kept separately: the original artifact's intentionally broader 2847-v1 rules. */
export function normalizeOriginal(text) {
	return text
		.split("\n")
		.map((raw) =>
			raw
				.replace(/\s+$/u, "")
				.replace(/^#{1,6}\s+(.*)$/u, "# $1")
				.replaceAll('src="../images/', 'src="images/')
				.replace(/\]\(\/[A-Za-z0-9._/-]*#/gu, "](#"),
		)
		.filter(Boolean)
		.join("\n");
}

export function splitBlocks(text) {
	const lines = text.split("\n");
	const headings = [];
	const seen = new Map();
	let fence;
	for (const [index, line] of lines.entries()) {
		const marker = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
		if (marker) {
			fence = nextFence(marker, fence);
			continue;
		}
		if (fence) continue;
		const match = /^(#{1,6})\s+(.*?)\s*$/u.exec(line);
		if (!match) continue;
		const base = mintlifyAnchor(match[2]);
		const occurrence = (seen.get(base) ?? 0) + 1;
		seen.set(base, occurrence);
		headings.push({
			start: index + 1,
			anchor: occurrence === 1 ? base : `${base}-${occurrence}`,
			heading: match[2],
			level: match[1].length,
			occurrence,
		});
	}
	const first = (headings[0]?.start ?? lines.length + 1) - 1;
	if (lines.slice(0, first).some((line) => line.trim()))
		headings.unshift({ start: 1, anchor: null, heading: null, level: 0, occurrence: null });
	return headings.map((head, index) => {
		const end = (headings[index + 1]?.start ?? lines.length + 1) - 1;
		return { ...head, end, text: lines.slice(head.start - 1, end).join("\n") };
	});
}

function elements(text, legacy = false) {
	let fences = 0,
		tables = 0,
		callouts = 0,
		fence;
	for (const line of text.split("\n")) {
		const marker = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
		if (marker) {
			if (!fence) fences++;
			fence = legacy ? !fence : nextFence(marker, fence);
			continue;
		}
		if (fence) continue;
		if (/^\s*\|[-: |]+\|\s*$/u.test(line)) tables++;
		if (line.startsWith(">") || /^\s*<(Note|Warning|Info|Tip|Card|Accordion)/u.test(line)) callouts++;
	}
	return { fences, tables, callouts };
}

/** Source enumeration and content are read exclusively from an exact immutable commit. */
export function sourceDocuments(repoRoot, revision) {
	assert.ok([BASELINE, PR, MAIN].includes(revision), "source must use a pinned commit");
	const key = `${realpathSync(repoRoot)}:${revision}`;
	if (sourceCache.has(key)) return sourceCache.get(key);
	const documents = new Map(
		[...revisionBlobs(repoRoot, revision)]
			.filter(([path]) => path.startsWith(DOCS) && /\.mdx?$/u.test(path))
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([path, bytes]) => [path.slice(DOCS.length), bytes.toString("utf8")]),
	);
	sourceCache.set(key, documents);
	return documents;
}

export function reconstructInventory(repoRoot, revision) {
	const documents = sourceDocuments(repoRoot, revision);
	const pages = [],
		blocks = [];
	for (const [path, text] of documents) {
		pages.push({ path, sha256: digest(text) });
		for (const [index, block] of splitBlocks(text).entries()) {
			blocks.push({
				id: `${path.replace(/\.mdx?$/u, "")}::${String(index + 1).padStart(3, "0")}`,
				source_path: path,
				source_anchor: block.anchor,
				source_heading: block.heading,
				source_lines: [block.start, block.end],
				occurrence: block.occurrence,
				sha256: digest(block.text),
				normalized_sha256: digest(normalize(block.text)),
				kind: block.heading === null ? "preamble" : `h${block.level}`,
				...elements(block.text, revision === BASELINE),
				class:
					block.heading?.toLowerCase() === "table of contents" ||
					(block.heading !== null && !block.text.split("\n").slice(1).join("\n").trim())
						? "navigation"
						: "substantive",
			});
		}
	}
	return { revision, normalization: "2847-v2", pages, blocks };
}

function safePath(path) {
	assert.equal(typeof path, "string");
	assert.ok(
		path && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes(".."),
		`unsafe path ${path}`,
	);
	return path;
}
/** Independently recover PR-authored connective lines by multiplicity subtraction from its
 * original mapped baseline block. 2847-v1 is used only to identify the old source lines;
 * retained additions are verified with strict v2 text, including their exact link targets. */
export function reconstructPRConnective(repoRoot) {
	const inventory = JSON.parse(git(repoRoot, ["show", `${PR}:docs/migrations/2847-baseline-inventory.json`]));
	const mapping = JSON.parse(git(repoRoot, ["show", `${PR}:docs/migrations/2847-destination-map.json`]));
	const baseline = sourceDocuments(repoRoot, BASELINE);
	const records = [];
	for (const [path, text] of sourceDocuments(repoRoot, PR)) {
		for (const block of splitBlocks(text)) {
			const old = inventory.blocks.find(
				(row) => mapping.blocks[row.id].dest_path === path && mapping.blocks[row.id].dest_anchor === block.anchor,
			);
			let original = "";
			if (old) {
				original = baseline
					.get(old.source_path)
					.split("\n")
					.slice(old.source_lines[0] - 1, old.source_lines[1])
					.join("\n");
				for (const edit of mapping.anchor_corrections.filter((entry) => entry.block_id === old.id))
					original = original.replaceAll(`](${edit.baseline_target})`, `](${edit.corrected_target})`);
			}
			const counts = new Map();
			for (const line of normalizeOriginal(original).split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
			const added = normalize(block.text)
				.split("\n")
				.filter((line) => {
					const key = normalizeOriginal(line);
					if (counts.get(key) > 0) {
						counts.set(key, counts.get(key) - 1);
						return false;
					}
					return true;
				});
			if (added.length)
				records.push({
					path: DOCS + path,
					anchor: block.anchor,
					occurrence: block.occurrence,
					source_lines: [block.start, block.end],
					source_sha256: digest(block.text),
					added_lines: added,
				});
		}
	}
	return records;
}

function reader(repoRoot, revision, overrides = new Map()) {
	const cache = new Map();
	const read = (path) => {
		safePath(path);
		if (!cache.has(path))
			cache.set(
				path,
				revision
					? git(repoRoot, ["show", `${revision}:${path}`])
					: overrides.has(path)
						? overrides.get(path)
						: readFileSync(join(repoRoot, path), "utf8"),
			);
		assert.equal(typeof cache.get(path), "string", `missing destination ${path}`);
		return cache.get(path);
	};
	const paths = revision
		? git(repoRoot, ["ls-tree", "-r", "--name-only", revision, "--", DOCS]).trim().split("\n")
		: readdirSync(join(repoRoot, DOCS), { recursive: true, encoding: "utf8" }).map(
				(path) => DOCS + path.replaceAll("\\", "/"),
			);
	return { read, pages: paths.filter((path) => /\.mdx?$/u.test(path)).sort() };
}

export function destinationText(read, target) {
	const text = read(target.path);
	if (target.lines) {
		assert.ok(
			target.path.startsWith("docs/migrations/2847-history/"),
			"only explicit historical records use line spans",
		);
		assert.ok(target.lines[0] > 0 && target.lines[1] >= target.lines[0], "invalid history span");
		return text
			.split("\n")
			.slice(target.lines[0] - 1, target.lines[1])
			.join("\n");
	}
	const block = splitBlocks(text).find((candidate) => candidate.anchor === target.anchor);
	assert.ok(block, `missing destination ${target.path}#${target.anchor}`);
	assert.equal(block.occurrence, target.occurrence, `wrong occurrence ${target.path}#${target.anchor}`);
	return block.text;
}

export function orderedContains(wanted, have) {
	const lines = have.split("\n");
	let cursor = 0;
	for (const line of wanted.split("\n")) {
		const at = lines.indexOf(line, cursor);
		if (at === -1) return false;
		cursor = at + 1;
	}
	return true;
}

function resolveLink(read, page, target) {
	assert.ok(!/^(https?:|mailto:)/u.test(target), `external URL rewrite is not permitted: ${target}`);
	const [path, anchor] = target.split("#");
	const relative = path ? (path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(page), path)) : page;
	const candidates = /\.mdx?$/u.test(relative) ? [relative] : [`${relative}.md`, `${relative}.mdx`];
	let text;
	for (const candidate of candidates) {
		try {
			text = read(DOCS + candidate);
			break;
		} catch {
			/* Try the other documented page extension. */
		}
	}
	assert.notEqual(text, undefined, `retarget page does not resolve: ${page}: ${target}`);
	if (anchor)
		assert.ok(
			splitBlocks(text).some((block) => block.anchor === anchor),
			`retarget anchor does not resolve: ${page}: ${target}`,
		);
}

function transformed(text, row, corrections, read, sourceRows, original) {
	let result = text;
	for (const edit of row.edits) {
		assert.ok(result.includes(edit.from), `${row.id}: edit source is absent: ${edit.from}`);
		if (edit.kind === "reviewed-correction") {
			assert.ok(
				corrections.some(
					(record) =>
						(record.path === row.source_path || DOCS + record.path === row.target.path) &&
						record.old === edit.from &&
						record.new === edit.to,
				),
				`${row.id}: unreviewed correction`,
			);
		} else if (edit.kind === "link") {
			const from = /^\]\(([^)]+)\)$/u.exec(edit.from)?.[1];
			const to = /^\]\(([^)]+)\)$/u.exec(edit.to)?.[1];
			assert.ok(
				from && to && from.includes("#") && to.includes("#"),
				`${row.id}: not a fragment-preserving route edit`,
			);
			const [fromPath, anchor] = from.split("#");
			const [toPath, toAnchor] = to.split("#");
			assert.equal(anchor, toAnchor, `${row.id}: undisclosed anchor correction`);
			const sourcePath = fromPath ? `${fromPath.replace(/^\//u, "")}.md` : row.source_path;
			const source = sourceRows.find(
				(entry) =>
					entry.source_path.replace(/\.mdx?$/u, "") === sourcePath.replace(/\.mdx?$/u, "") &&
					entry.source_anchor === anchor,
			);
			const historic = original.find(
				(entry) =>
					entry.source_path.replace(/\.mdx?$/u, "") === sourcePath.replace(/\.mdx?$/u, "") &&
					entry.source_anchor === anchor,
			);
			const expected = source?.active ?? source?.target ?? historic?.active;
			assert.ok(expected, `${row.id}: link has no source-to-reader mapping: ${from}`);
			assert.equal(
				`${DOCS}${toPath ? toPath.replace(/^\//u, "") : row.target.path.slice(DOCS.length).replace(/\.mdx?$/u, "")}`.replace(
					/\.mdx?$/u,
					"",
				),
				expected.path.replace(/\.mdx?$/u, ""),
				`${row.id}: route rewrite does not lead to the mapped content`,
			);
		} else if (edit.kind === "image") {
			assert.equal(edit.from, 'src="images/');
			assert.equal(edit.to, 'src="../images/');
			assert.equal(posix.dirname(row.source_path), ".");
			assert.equal(posix.dirname(row.target.path.slice(DOCS.length)).split("/").length, 1);
		} else if (edit.kind === "heading") {
			assert.equal(row.id, "usage::011");
			assert.equal(edit.from, "## CLI Reference");
			assert.equal(edit.to, "## CLI reference");
		} else assert.fail(`${row.id}: unsupported transformation ${edit.kind}`);
		result = result.replaceAll(edit.from, edit.to);
		// Fragment-only correction records must resolve too; do not validate only full-link edits.
		const oldLinks = new Set([...text.matchAll(/\]\(([^)]+)\)/gu)].map((match) => match[1]));
		for (const link of result.matchAll(/\]\(([^)]+)\)/gu)) {
			if (!oldLinks.has(link[1]) && !/^(https?:|mailto:)/u.test(link[1]))
				resolveLink(read, row.target.path.slice(DOCS.length), link[1]);
		}
		if (edit.kind === "image")
			for (const image of result.matchAll(/src="(\.\.\/images\/[^\x22]+)"/gu))
				read(posix.join(posix.dirname(row.target.path), image[1]));
		for (const link of edit.to.matchAll(/\]\(([^)]+)\)/gu))
			resolveLink(read, row.target.path.slice(DOCS.length), link[1]);
	}
	return result;
}

function verify({ repoRoot, revision, overrides, snapshot }) {
	const { read, pages } = snapshot ?? reader(repoRoot, revision, overrides);
	for (const name of originalArtifacts) {
		const path = `docs/migrations/${name}`;
		assert.equal(
			read(path),
			git(repoRoot, ["show", `${PR}:${path}`]),
			`immutable original provenance changed: ${path}`,
		);
	}
	const originalInventory = JSON.parse(read("docs/migrations/2847-baseline-inventory.json"));
	const originalMapping = JSON.parse(read("docs/migrations/2847-destination-map.json")).blocks;
	assert.equal(originalInventory.baseline_rev, BASELINE);
	const manifest = JSON.parse(read(`${PROVENANCE}manifest.json`));
	assert.equal(manifest.schema, "2847-reconciliation-v1");
	assert.equal(manifest.normalization, "2847-v2");
	assert.equal(manifest.baseline, BASELINE);
	assert.equal(manifest.main, MAIN);
	assert.equal(manifest.pr, PR);
	const loadShards = (names) =>
		names.flatMap((name) => {
			const text = read(PROVENANCE + name);
			assert.ok(Buffer.byteLength(text) < 512000, `oversize provenance shard ${name}`);
			return JSON.parse(text);
		});
	const corrections = JSON.parse(read(`${PROVENANCE}corrections.json`));
	assert.equal(digest(JSON.stringify(corrections)), manifest.corrections_sha256, "correction records changed");
	assert.equal(manifest.corrections_sha256, REVIEWED_CORRECTIONS_SHA256, "unreviewed correction policy");
	const inventories = {
		baseline: reconstructInventory(repoRoot, BASELINE),
		main: reconstructInventory(repoRoot, MAIN),
	};
	assert.deepEqual(
		loadShards(manifest.main_inventory),
		inventories.main.blocks,
		"main inventory does not independently reconstruct",
	);
	assert.deepEqual(manifest.main_pages, inventories.main.pages, "main page inventory omitted or changed a page");
	assert.equal(inventories.baseline.blocks.length, originalInventory.blocks.length, "original source block omitted");
	for (const [index, block] of inventories.baseline.blocks.entries()) {
		const old = originalInventory.blocks[index];
		const text = sourceDocuments(repoRoot, BASELINE)
			.get(block.source_path)
			.split("\n")
			.slice(block.source_lines[0] - 1, block.source_lines[1])
			.join("\n");
		for (const field of [
			"id",
			"source_path",
			"source_anchor",
			"source_heading",
			"source_lines",
			"kind",
			"class",
			"fences",
			"tables",
			"callouts",
		])
			assert.deepEqual(old[field], block[field], `baseline reconstruction ${block.id}:${field}`);
		assert.equal(old.hash, `sha256:${digest(normalizeOriginal(text)).slice(0, 16)}`, `baseline digest ${block.id}`);
	}
	const mappings = { baseline: loadShards(manifest.baseline_map), main: loadShards(manifest.main_map) };
	const counts = {};
	for (const source of ["baseline", "main"]) {
		const rows = mappings[source];
		assert.deepEqual(
			rows.map((row) => row.id).sort(),
			inventories[source].blocks.map((block) => block.id).sort(),
			`${source}: missing or multiply claimed source IDs`,
		);
		const targets = new Set();
		let active = 0,
			historical = 0,
			corrected = 0;
		for (const block of inventories[source].blocks) {
			const row = rows.find((entry) => entry.id === block.id);
			assert.equal(row.source_path, block.source_path);
			assert.equal(row.source_anchor, block.source_anchor);
			const key = JSON.stringify(
				row.target.lines
					? ["span", row.target.path, ...row.target.lines]
					: ["anchor", row.target.path, row.target.anchor, row.target.occurrence],
			);
			assert.ok(!targets.has(key), `${source}:${row.id}: destination occurrence claimed twice`);
			targets.add(key);
			const sourceText = sourceDocuments(repoRoot, inventories[source].revision)
				.get(block.source_path)
				.split("\n")
				.slice(block.source_lines[0] - 1, block.source_lines[1])
				.join("\n");
			if (source === "baseline") {
				const active = row.active ?? row.target;
				assert.deepEqual(
					active,
					{
						path: DOCS + originalMapping[row.id].dest_path,
						anchor: originalMapping[row.id].dest_anchor,
						occurrence: originalMapping[row.id].dest_occurrence || null,
					},
					`${row.id}: original reader compatibility destination changed`,
				);
			}
			if (row.status === "historical") {
				assert.equal(source, "baseline", "main cannot be satisfied by an arbitrary archive");
				assert.deepEqual(row.edits, [], `${row.id}: historical originals cannot be transformed`);
				assert.equal(row.mode, "exact", `${row.id}: historical originals require complete comparison`);
				assert.ok(row.target.path.startsWith("docs/migrations/2847-history/"));
				assert.ok(
					row.reason.length > 20 && row.active.path.startsWith(DOCS),
					`${row.id}: history must name reader replacement and rationale`,
				);
				destinationText(read, row.active);
				historical++;
			} else {
				assert.equal(row.status, "active");
				assert.ok(row.target.path.startsWith(DOCS), `${row.id}: active destination outside reader docs`);
				active++;
			}
			const expected = transformed(sourceText, row, corrections, read, rows, mappings.baseline);
			const have = destinationText(read, row.target);
			if (row.mode === "exact")
				assert.equal(
					digest(normalize(have)),
					digest(normalize(expected)),
					`${source}:${row.id}: source prose/example/table/caveat differs`,
				);
			else {
				assert.equal(row.mode, "ordered");
				assert.ok(row.reason.length > 20, `${row.id}: additive containment needs disclosure`);
				assert.ok(
					orderedContains(normalize(expected), normalize(have)),
					`${source}:${row.id}: source prose/example/table/caveat missing or reordered`,
				);
				const wanted = normalize(expected).split("\n");
				let cursor = 0;
				const additions = normalize(have)
					.split("\n")
					.filter((line) => {
						if (line === wanted[cursor]) {
							cursor++;
							return false;
						}
						return true;
					});
				assert.deepEqual(
					row.additions,
					additions,
					`${source}:${row.id}: additive content was not precisely disclosed`,
				);
			}
			assert.equal(
				digest(normalize(have)),
				row.target_sha256,
				`${source}:${row.id}: disclosed destination/additive text changed`,
			);
			if (row.history) {
				assert.equal(
					normalize(destinationText(read, row.history)),
					normalize(sourceText),
					`${source}:${row.id}: correction history lost source text`,
				);
				corrected++;
			}
			if (
				row.edits.some(
					(edit) =>
						edit.kind === "reviewed-correction" && !edit.from.startsWith("](") && !edit.from.startsWith("#"),
				)
			) {
				assert.ok(row.history, `${source}:${row.id}: reviewed prose supersession requires exact source history`);
			}
		}
		counts[source] = { pages: inventories[source].pages.length, blocks: rows.length, active, historical, corrected };
	}
	const supersessions = JSON.parse(read(`${PROVENANCE}supersessions.json`));
	assert.equal(
		digest(JSON.stringify(supersessions)),
		"fc979814f75f49256867ce2944cf02d2535f80909a2497b438f97895c098eae0",
		"reviewed supersession evidence changed",
	);
	for (const record of supersessions) {
		const source = inventories.main.blocks.find((block) => block.id === record.source_id);
		const row = mappings.main.find((entry) => entry.id === record.source_id);
		assert.equal(record.source_rev, MAIN);
		assert.equal(source.source_path, record.source_path);
		assert.equal(source.source_anchor, record.source_anchor);
		assert.deepEqual(source.source_lines, record.source_lines);
		assert.equal(row.status, "active", "reviewed supersession still requires a verified active replacement");
		assert.deepEqual(row.target, record.active);
		assert.deepEqual(row.history, record.history);
		for (const evidence of record.evidence) {
			const block = inventories.main.blocks.find((entry) => entry.id === evidence.source_id);
			assert.equal(block.sha256, evidence.sha256, "supersession evidence does not match immutable main");
			assert.equal(mappings.main.find((entry) => entry.id === evidence.source_id).status, "active");
		}
	}
	const retention = JSON.parse(read(`${PROVENANCE}reader-retention.json`));
	assert.equal(
		digest(JSON.stringify(retention)),
		"6ed7e1cd8b8b9e92e4b9fb8ae8ff9ef69dabf119bb79d3962e920f9d2201452f",
		"reviewed still-valid reader retention changed",
	);
	for (const record of retention) {
		const block = inventories.baseline.blocks.find((entry) => entry.id === record.source_id);
		const lines = sourceDocuments(repoRoot, BASELINE).get(block.source_path).split("\n");
		const have = normalize(destinationText(read, record.target));
		const expected = record.source_line_numbers
			.map((line) => {
				assert.ok(line >= block.source_lines[0] && line <= block.source_lines[1]);
				return normalize(lines[line - 1]);
			})
			.join("\n");
		assert.equal(digest(expected), record.sha256, "reader retention source does not reconstruct");
		assert.ok(
			orderedContains(expected, have),
			`${record.source_id}: still-valid original detail lost from reader destination`,
		);
		for (const fragment of record.source_fragments) {
			assert.ok(fragment.line >= block.source_lines[0] && fragment.line <= block.source_lines[1]);
			assert.ok(
				fragment.end > fragment.start && fragment.start >= 0 && fragment.end <= lines[fragment.line - 1].length,
			);
			assert.ok(
				have.includes(lines[fragment.line - 1].slice(fragment.start, fragment.end)),
				`${record.source_id}: still-valid original prose fragment lost`,
			);
		}
	}
	const connective = reconstructPRConnective(repoRoot);
	assert.deepEqual(
		loadShards(manifest.pr_connective),
		connective,
		"PR connective inventory does not independently reconstruct",
	);
	for (const record of connective) {
		assert.ok(
			orderedContains(record.added_lines.join("\n"), normalize(destinationText(read, record))),
			`PR connective content missing: ${record.path}#${record.anchor}`,
		);
	}
	// A second, closed snapshot protects connective additions and still-valid restored details,
	// including regions that do not belong to either source block. It cannot replace source proof above.
	assert.deepEqual(
		manifest.reader_pages.map((page) => page.path),
		pages,
		"reader page omitted, added without review, or deleted",
	);
	for (const page of manifest.reader_pages)
		assert.equal(digest(normalize(read(page.path))), page.sha256, `reader content changed: ${page.path}`);
	assert.equal(digest(read(`${DOCS}docs.json`)), manifest.navigation_sha256, "reader navigation changed");
	return {
		...counts,
		readerPages: pages.length,
		prConnective: {
			blocks: connective.length,
			lines: connective.reduce((sum, record) => sum + record.added_lines.length, 0),
		},
	};
}

// The first proof and its manifests stay frozen. This small, closed delta is reconstructed
// from both immutable main sources, not authorized by hashes of the resulting reader pages.
export function reconstructLatestMainDelta(repoRoot) {
	const specs = [
		["background-tasks.md", "background-tasks.md", 168, 6, 168, 18],
		["sdk.md", "sdk/reference.md", 795, 7, 795, 7],
		["sdk.md", "sdk/reference.md", 910, 6, 910, 8],
		["tools.md", "tools.md", 1, 6, 1, 6],
		["tools.md", "tools.md", 42, 6, 42, 12],
	];
	// Include non-Markdown assets and navigation in the unchanged-source proof too.
	const changedPaths = new Set(specs.map(([path]) => DOCS + path));
	const tree = (revision) => git(repoRoot, ["ls-tree", "-r", revision, "--", DOCS]);
	const previousTree = tree(MAIN),
		latestTree = tree(LATEST_MAIN);
	const unchangedTree = (text) =>
		text
			.split("\n")
			.filter((line) => !changedPaths.has(line.split("\t")[1]))
			.join("\n");
	assert.equal(unchangedTree(latestTree), unchangedTree(previousTree), "unmapped latest-main source file change");
	const sourceTrees = {
		previous_sha256: digest(previousTree),
		latest_sha256: digest(latestTree),
		unchanged_sha256: digest(unchangedTree(previousTree)),
	};
	const sourcePaths = (revision) =>
		git(repoRoot, ["ls-tree", "-r", "--name-only", revision, "--", DOCS])
			.trim()
			.split("\n")
			.filter((path) => /\.mdx?$/u.test(path))
			.sort();
	const paths = sourcePaths(LATEST_MAIN);
	assert.deepEqual(paths, sourcePaths(MAIN), "latest-main source path set changed");
	const source = (revision, path) => git(repoRoot, ["show", `${revision}:${path}`]);
	const slice = (revision, path, start, count) =>
		`${source(revision, DOCS + path)
			.split("\n")
			.slice(start - 1, start - 1 + count)
			.join("\n")}\n`;
	const edits = specs.map(([path, target, oldStart, oldCount, newStart, newCount]) => ({
		source_path: DOCS + path,
		target_path: DOCS + target,
		previous_lines: [oldStart, oldStart + oldCount - 1],
		latest_lines: [newStart, newStart + newCount - 1],
		before: slice(MAIN, path, oldStart, oldCount),
		after: slice(LATEST_MAIN, path, newStart, newCount),
	}));
	const pages = paths.map((path) => {
		const before = source(MAIN, path),
			after = source(LATEST_MAIN, path);
		let expected = before;
		for (const edit of edits.filter((row) => row.source_path === path))
			expected = replaceDelta(expected, edit.before, edit.after, path);
		assert.equal(expected, after, `unmapped latest-main source change: ${path}`);
		return { path, previous_sha256: digest(before), latest_sha256: digest(after), unchanged: before === after };
	});
	// Closed additive reader repairs, not upstream edits or new source-inventory rules.
	// Mintlify 4.2.731 generates no h5 ID; preserve each existing heading and link verbatim.
	const anchorPath = `${DOCS}workflows/reliable-design.md`;
	const predecessorLines = source(FIRST_RECONCILIATION, anchorPath).split("\n");
	const readerAnchorRepairs = [
		[1451, "3. Adversarial verification", "3-adversarial-verification"],
		[1517, "5. Tournament", "5-tournament"],
		[1550, "6. Loop until done", "6-loop-until-done"],
		[1611, "Stacked implementation slices starter pattern", "stacked-implementation-slices-starter-pattern"],
	].map(([line, title, id]) => {
		const heading = `##### ${title}`;
		assert.equal(predecessorLines[line - 1], heading, "reader-anchor predecessor heading differs");
		return {
			kind: "additive-reader-anchor",
			target_path: anchorPath,
			predecessor_heading_line: line,
			heading,
			id,
			addition: `<a id="${id}" />\n\n`,
		};
	});
	return {
		schema: "2847-latest-main-v1",
		predecessor: FIRST_RECONCILIATION,
		previous_main: MAIN,
		latest_main: LATEST_MAIN,
		source_trees: sourceTrees,
		pages,
		edits,
		reader_anchor_repairs: readerAnchorRepairs,
	};
}

function replaceDelta(text, before, after, path) {
	assert.equal(text.split(before).length, 2, `latest-main delta must occur exactly once: ${path}`);
	return text.replace(before, () => after);
}

export function latestMainEvidence(delta) {
	return {
		schema: delta.schema,
		predecessor: delta.predecessor,
		previous_main: delta.previous_main,
		latest_main: delta.latest_main,
		source_trees: delta.source_trees,
		history: {
			revision: FIRST_RECONCILIATION,
			path: DOCS,
			policy:
				"The complete older reader corpus, including superseded default-tool lists, remains at this immutable predecessor. All existing reader bytes remain active except the two exact default-tool list updates; five source-derived edits add the latest main instructions. Original baseline and first-reconciliation artifacts remain byte-identical.",
		},
		pages_sha256: digest(JSON.stringify(delta.pages)),
		unchanged_source_paths: delta.pages.filter((page) => page.unchanged).map((page) => page.path),
		changed_source_pages: delta.pages.filter((page) => !page.unchanged),
		edits: delta.edits.map(({ before, after, ...location }) => ({
			...location,
			before_sha256: digest(before),
			after_sha256: digest(after),
		})),
		reader_anchor_repairs: delta.reader_anchor_repairs,
	};
}

/** Closed third-source delta; every source asset and every changed page is reconstructed. */
export function reconstructWaitMainDelta(repoRoot) {
	const specs = [
		["background-tasks.md", "background-tasks.md", 35, 7, 35, 7],
		["background-tasks.md", "background-tasks.md", 168, 6, 168, 17],
		["sdk.md", "sdk/reference.md", 832, 6, 832, 14],
	];
	const changedPaths = new Set(specs.map(([path]) => DOCS + path));
	const tree = (revision) => git(repoRoot, ["ls-tree", "-r", revision, "--", DOCS]);
	const previousTree = tree(LATEST_MAIN),
		latestTree = tree(WAIT_MAIN);
	const unchangedTree = (text) =>
		text
			.split("\n")
			.filter((line) => !changedPaths.has(line.split("\t")[1]))
			.join("\n");
	assert.equal(unchangedTree(latestTree), unchangedTree(previousTree), "unmapped wait-main source file change");
	const paths = (text) =>
		text
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split("\t")[1]);
	assert.deepEqual(paths(latestTree), paths(previousTree), "wait-main source path set changed");
	const source = (revision, path) => git(repoRoot, ["show", `${revision}:${path}`]);
	const slice = (revision, path, start, count) =>
		`${source(revision, DOCS + path)
			.split("\n")
			.slice(start - 1, start - 1 + count)
			.join("\n")}\n`;
	const edits = specs.map(([path, target, oldStart, oldCount, newStart, newCount]) => ({
		source_path: DOCS + path,
		target_path: DOCS + target,
		previous_lines: [oldStart, oldStart + oldCount - 1],
		latest_lines: [newStart, newStart + newCount - 1],
		before: slice(LATEST_MAIN, path, oldStart, oldCount),
		after: slice(WAIT_MAIN, path, newStart, newCount),
	}));
	const pages = paths(latestTree)
		.filter((path) => /\.mdx?$/u.test(path))
		.sort()
		.map((path) => {
			const before = source(LATEST_MAIN, path),
				after = source(WAIT_MAIN, path);
			let expected = before;
			for (const edit of edits.filter((row) => row.source_path === path))
				expected = replaceDelta(expected, edit.before, edit.after, path);
			assert.equal(expected, after, `unmapped wait-main source change: ${path}`);
			return { path, previous_sha256: digest(before), latest_sha256: digest(after), unchanged: before === after };
		});
	const heading = "#### Waiting for existing shell tasks";
	assert.ok(edits[2].after.includes(`\n${heading}\n`), "wait-main compatibility heading absent from source");
	const before = "#### PowerShell tool behavior\n";
	const compatibilityPointers = [
		{
			kind: "additive-sdk-compatibility-pointer",
			target_path: `${DOCS}sdk.md`,
			before,
			after: `${heading}\n\nMoved to [SDK API reference](/sdk/reference#waiting-for-existing-shell-tasks).\n\n${before}`,
		},
	];
	return {
		schema: "2847-wait-main-v1",
		predecessor: SECOND_RECONCILIATION,
		previous_main: LATEST_MAIN,
		latest_main: WAIT_MAIN,
		source_trees: {
			previous_sha256: digest(previousTree),
			latest_sha256: digest(latestTree),
			unchanged_sha256: digest(unchangedTree(previousTree)),
		},
		pages,
		edits,
		compatibility_pointers: compatibilityPointers,
	};
}

export function waitMainEvidence(delta) {
	return {
		schema: delta.schema,
		predecessor: delta.predecessor,
		previous_main: delta.previous_main,
		latest_main: delta.latest_main,
		source_trees: delta.source_trees,
		pages_sha256: digest(JSON.stringify(delta.pages)),
		unchanged_source_paths: delta.pages.filter((page) => page.unchanged).map((page) => page.path),
		changed_source_pages: delta.pages.filter((page) => !page.unchanged),
		edits: delta.edits.map(({ before, after, ...location }) => ({
			...location,
			before_sha256: digest(before),
			after_sha256: digest(after),
		})),
		compatibility_pointers: delta.compatibility_pointers,
	};
}

/** Fourth exact capture: source hunks are closed here, never learned from reader hashes. */
export function reconstructFourthMainDelta(repoRoot) {
	const specs = [
		["docs.json", "docs.json", 17, 6, 17, 7],
		["extensions.md", "extensions/events.md", 1074, 7, 1074, 7],
		["herdr.md", "herdr.md", 2, 6, 2, 8],
		["index.md", "guides.md", 61, 1, 61, 2],
		["intercom.md", "intercom/operations.md", 137, 3, 137, 9],
		["quickstart.md", "getting-started/first-session.md", 218, 7, 218, 7],
		["subagents.md", "subagents.md", 83, 7, 83, 7],
		["subagents.md", "subagents.md", 163, 16, 163, 16],
		["subagents.md", "subagents.md", 248, 7, 248, 7],
		["tmux.md", "tmux.md", 2, 6, 2, 8],
		["usage.md", "usage.md", 51, 7, 51, 7],
		["workflows.md", "workflows.md", 11, 7, 11, 7],
		["workflows.md", "workflows.md", 40, 6, 40, 8],
		["workflows.md", "workflows.md", 66, 7, 68, 7],
		["workflows/api-reference.md", "workflows/api-reference.md", 405, 7, 405, 7],
		["workflows/api-reference.md", "workflows/api-reference.md", 571, 7, 571, 7],
		["workflows/api-reference.md", "workflows/api-reference.md", 955, 6, 955, 7],
		["workflows/api-reference.md", "workflows/api-reference.md", 988, 7, 989, 7],
		["workflows/authoring.md", "workflows/authoring.md", 409, 7, 409, 7],
		["workflows/authoring.md", "workflows/authoring.md", 474, 7, 474, 7],
		["workflows/authoring.md", "workflows/authoring.md", 631, 7, 631, 7],
		["workflows/operations.md", "workflows/operations.md", 61, 7, 61, 7],
		["workflows/operations.md", "workflows/operations.md", 77, 13, 77, 13],
		["workflows/operations.md", "workflows/operations.md", 122, 6, 122, 8],
		["workflows/operations.md", "workflows/operations.md", 131, 10, 133, 9],
		["workflows/operations.md", "workflows/operations.md", 147, 7, 148, 7],
		["workflows/operations.md", "workflows/operations.md", 166, 7, 167, 7],
		["workflows/operations.md", "workflows/operations.md", 222, 9, 223, 7],
		["workflows/operations.md", "workflows/operations.md", 234, 7, 233, 7],
		["workflows/operations.md", "workflows/operations.md", 243, 7, 242, 7],
		["workflows/operations.md", "workflows/operations.md", 254, 21, 253, 20],
		["workflows/operations.md", "workflows/operations.md", 277, 7, 275, 7],
		["workflows/operations.md", "workflows/operations.md", 377, 7, 375, 7],
		["workflows/operations.md", "workflows/operations.md", 452, 11, 450, 11],
		["workflows/operations.md", "workflows/operations.md", 472, 7, 470, 7],
		["workflows/operations.md", "workflows/operations.md", 564, 7, 562, 7],
		["workflows/operations.md", "workflows/operations.md", 589, 7, 587, 7],
		["workflows/operations.md", "workflows/operations.md", 605, 7, 603, 7],
		["workflows/operations.md", "workflows/operations.md", 724, 7, 722, 7],
		["workflows/operations.md", "workflows/operations.md", 777, 7, 775, 7],
		["workflows/reliable-design.md", "workflows/reliable-design.md", 1168, 7, 1168, 7],
		["workflows/reliable-design.md", "workflows/reliable-design.md", 1348, 7, 1348, 7],
		["workflows/reliable-design.md", "workflows/reliable-design.md", 2093, 7, 2093, 7],
		["workflows/verification.md", "workflows/verification.md", 1, 79, 1, 138],
	];
	const newPath = `${DOCS}computer-use.md`;
	const changedPaths = new Set([...specs.map(([path]) => DOCS + path), newPath]);
	const previousTree = git(repoRoot, ["ls-tree", "-r", WAIT_MAIN, "--", DOCS]);
	const latestTree = git(repoRoot, ["ls-tree", "-r", FOURTH_MAIN, "--", DOCS]);
	const unchangedTree = (text) =>
		text
			.split("\n")
			.filter((line) => !changedPaths.has(line.split("\t")[1]))
			.join("\n");
	assert.equal(unchangedTree(latestTree), unchangedTree(previousTree), "unmapped fourth-main source file change");
	const paths = (text) =>
		text
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split("\t")[1]);
	assert.deepEqual(paths(latestTree), [...paths(previousTree), newPath].sort(), "fourth-main source path set changed");
	const source = (revision, path) => git(repoRoot, ["show", `${revision}:${path}`]);
	const slice = (revision, path, start, count) =>
		`${source(revision, DOCS + path)
			.split("\n")
			.slice(start - 1, start - 1 + count)
			.join("\n")}\n`;
	const edits = specs.map(([path, target, oldStart, oldCount, newStart, newCount]) => ({
		source_path: DOCS + path,
		target_path: DOCS + target,
		previous_lines: [oldStart, oldStart + oldCount - 1],
		latest_lines: [newStart, newStart + newCount - 1],
		before: slice(WAIT_MAIN, path, oldStart, oldCount),
		after: slice(FOURTH_MAIN, path, newStart, newCount),
	}));
	// Rebuild complete files, including navigation; omitted hunks and asset changes fail closed.
	const pages = paths(latestTree)
		.filter((path) => /\.mdx?$/u.test(path) || path === `${DOCS}docs.json`)
		.map((path) => {
			const added = path === newPath;
			const before = added ? "" : source(WAIT_MAIN, path),
				after = source(FOURTH_MAIN, path);
			let expected = added ? source(FOURTH_MAIN, newPath) : before;
			for (const edit of edits.filter((row) => row.source_path === path))
				expected = replaceDelta(expected, edit.before, edit.after, path);
			assert.equal(expected, after, `unmapped fourth-main source change: ${path}`);
			return {
				path,
				previous_sha256: added ? null : digest(before),
				latest_sha256: digest(after),
				unchanged: before === after,
				added,
			};
		});
	const readerEdits = edits
		.filter((edit) => edit.source_path !== `${DOCS}docs.json`)
		.map((edit) => {
			// Preserve the existing migrated absolute rediscovery link, not the upstream fragment spelling.
			const retarget = (text) =>
				edit.source_path === `${DOCS}workflows/operations.md`
					? text.replaceAll(
							"](#reloading-workflow-resources)",
							"](/workflows/operations#reloading-workflow-resources)",
						)
					: text;
			return { ...edit, before: retarget(edit.before), after: retarget(edit.after) };
		});
	const cliPath = `${DOCS}reference/cli.md`;
	const oldInventory = source(FOURTH_PREDECESSOR, cliPath)
		.split("\n")
		.find((line) => line.startsWith("Default built-in tools:"));
	assert.ok(oldInventory);
	const readerRepairs = [
		{
			kind: "navigation-placement",
			target_path: `${DOCS}docs.json`,
			before: '              "background-tasks",\n',
			after: '              "background-tasks",\n              "computer-use",\n',
			reason:
				"Place the selected upstream computer-use route in the existing Learn/Guides navigation without replacing the reader IA.",
		},
		{
			kind: "intercom-compatibility-pointer",
			target_path: `${DOCS}intercom.md`,
			before: "## The intercom Tool\n",
			after: "### Troubleshooting initialization\n\nMoved to [Intercom operations](/intercom/operations#troubleshooting-initialization).\n\n## The intercom Tool\n",
			reason:
				"Keep the new upstream anchor on the compatibility page; its complete substantive guidance remains active in Intercom operations.",
		},
		{
			kind: "default-tool-correction",
			target_path: `${DOCS}getting-started/first-session.md`,
			before: "- `bash` - run shell commands\n",
			after: "- `bash` - run shell commands\n- `kill` - cancel owned background shell tasks by task ID\n",
			reason:
				"The runtime getDefaultToolNames contract includes kill; preserve the old incomplete list at the exact predecessor.",
		},
		{
			kind: "windows-tool-caveat",
			target_path: `${DOCS}getting-started/first-session.md`,
			before: "- `todo` - manage file-based todos\n",
			after: "- `todo` - manage file-based todos\n\nOn native Windows, `powershell` is also enabled when a PowerShell executable is available.\n",
			reason:
				"Make the runtime's conditional native-Windows PowerShell default explicit without changing the other onboarding details.",
		},
		{
			kind: "default-tool-correction",
			target_path: cliPath,
			before: `${oldInventory}\n`,
			after: `${oldInventory.replace("`read`, `bash`, `edit`", "`read`, `bash`, `kill`, `edit`")}\n`,
			reason:
				"Add the enabled kill tool while retaining the complete Windows availability and tool-selection caveats.",
		},
		{
			kind: "bash-observation-correction",
			target_path: cliPath,
			before:
				"Every bash execution runs in the foreground and receives one execution-time snapshot of the active session:\n",
			after: "Every bash execution receives one execution-time snapshot of the active session. Foreground/background observation controls how long the caller waits, not the command's execution timeout. Omitted `wait` uses the owner's policy, normally yielding after 10 seconds; explicit background observation requires a supported task owner. Without one, foreground execution waits until completion. See [Background tasks](/background-tasks#choose-how-long-to-wait).\n",
			reason:
				"Replace the obsolete absolute foreground restriction with the supported observation policy; the entire execution-time snapshot table remains byte-exact.",
		},
	];
	for (const [path, heading, id] of [
		["workflows/reliable-design.md", "#### 8. Pause stale or wrong work", "8-interrupt-stale-or-wrong-work"],
		["workflows/verification.md", "## Choose checks that answer the question", "select-the-verification-environment"],
		["workflows/verification.md", "### Terminal changes", "terminal-contracts"],
		["workflows/verification.md", "### Desktop, simulator, and emulator changes", "desktop-safety"],
	])
		readerRepairs.push({
			kind: "additive-compatibility-anchor",
			target_path: DOCS + path,
			before: `${heading}\n`,
			after: `<a id="${id}" />\n\n${heading}\n`,
			reason:
				"Preserve a predecessor heading's public fragment while keeping the new upstream heading and guidance active.",
		});
	readerRepairs.push({
		kind: "maintainer-recipe-pointer",
		target_path: `${DOCS}workflows/verification.md`,
		before: '<a id="desktop-safety" />\n',
		after: '<a id="reproduce-stage-skill-terminal-evidence" />\n\nFor Atomic source-checkout testing, see the retained [stage-skill terminal reproduction recipe](https://github.com/bastani-inc/atomic/blob/c075c61a7dcae05a767db7372d991f421b3fc507/packages/coding-agent/docs/workflows/verification.md#reproduce-stage-skill-terminal-evidence).\n\n<a id="desktop-safety" />\n',
		reason:
			"Keep the complete still-valid source-checkout recipe active in maintainer docs, outside user-facing docs, with its old reader fragment and an explicit pointer.",
	});
	const maintainerPrefix = `# Stage-skill terminal verification\n\nThis active maintainer recipe is retained from \`packages/coding-agent/docs/workflows/verification.md\` at \`${FOURTH_PREDECESSOR}\`. The upstream guide at \`${FOURTH_MAIN}\` now teaches general verification; this source-checkout procedure remains separate from that user-facing guide.\n\n`;
	const maintainerRetention = {
		source_revision: FOURTH_PREDECESSOR,
		source_path: `${DOCS}workflows/verification.md`,
		source_lines: [36, 47],
		target_path: "docs/2847-stage-skill-verification.md",
		text: maintainerPrefix + slice(FOURTH_PREDECESSOR, "workflows/verification.md", 36, 12),
	};
	const predecessorViews = new Map();
	for (const edit of [...readerEdits, ...readerRepairs]) {
		const before = predecessorViews.get(edit.target_path) ?? source(FOURTH_PREDECESSOR, edit.target_path);
		predecessorViews.set(edit.target_path, replaceDelta(before, edit.before, edit.after, edit.target_path));
	}
	return {
		schema: "2847-fourth-main-v1",
		predecessor: FOURTH_PREDECESSOR,
		previous_main: WAIT_MAIN,
		latest_main: FOURTH_MAIN,
		source_trees: {
			previous_sha256: digest(previousTree),
			latest_sha256: digest(latestTree),
			unchanged_sha256: digest(unchangedTree(previousTree)),
		},
		pages,
		edits,
		reader_edits: readerEdits,
		reader_repairs: readerRepairs,
		new_pages: [{ source_path: newPath, target_path: newPath, text: source(FOURTH_MAIN, newPath) }],
		maintainer_retention: maintainerRetention,
	};
}

export function fourthMainEvidence(delta) {
	const locations = (edits) =>
		edits.map(({ source_path, target_path, previous_lines, latest_lines }) => [
			source_path.slice(DOCS.length),
			target_path.slice(DOCS.length),
			previous_lines,
			latest_lines,
		]);
	return {
		schema: delta.schema,
		predecessor: delta.predecessor,
		previous_main: delta.previous_main,
		latest_main: delta.latest_main,
		source_trees: delta.source_trees,
		history: {
			revision: FOURTH_PREDECESSOR,
			source_revision: WAIT_MAIN,
			path: DOCS,
			policy:
				"The complete previous reader and upstream corpora remain at these immutable commits, including superseded interrupt/kill/pause policy, verification guidance, default-tool inventories and absolute foreground wording. New selected upstream substantive content is required at active reader destinations, never satisfied by history alone. Every other predecessor byte, including original and all earlier supplemental provenance, remains unchanged.",
		},
		changed_source_paths: delta.pages.filter((page) => !page.unchanged && !page.added).map((page) => page.path),
		unchanged_source_paths: delta.pages.filter((page) => page.unchanged).map((page) => page.path),
		pages_sha256: digest(JSON.stringify(delta.pages)),
		new_pages: delta.new_pages.map(({ text, ...location }) => ({
			...location,
			sha256: digest(text),
			lines: text.split("\n").length - 1,
		})),
		edits: locations(delta.edits),
		edits_sha256: digest(JSON.stringify(delta.edits)),
		reader_edits_sha256: digest(JSON.stringify(delta.reader_edits)),
		retarget: {
			path: `${DOCS}workflows/operations.md`,
			before: "](#reloading-workflow-resources)",
			after: "](/workflows/operations#reloading-workflow-resources)",
		},
		reader_repairs: delta.reader_repairs.map(({ kind, target_path }) => ({ kind, target_path })),
		reader_repairs_sha256: digest(JSON.stringify(delta.reader_repairs)),
		maintainer_retention: {
			source_revision: delta.maintainer_retention.source_revision,
			source_path: delta.maintainer_retention.source_path,
			source_lines: delta.maintainer_retention.source_lines,
			target_path: delta.maintainer_retention.target_path,
			sha256: digest(delta.maintainer_retention.text),
		},
	};
}

function verifyLatest({
	repoRoot,
	revision,
	overrides,
	waitMain = false,
	authoringReferences = false,
	fourthMain = false,
}) {
	// Prove the immutable predecessor with the original rules; reverse the closed
	// reader anchors, source-derived edits and new SDK pointer before the prior proof.
	verify({ repoRoot, revision: FIRST_RECONCILIATION });
	const current = reader(repoRoot, revision, overrides);
	const delta = reconstructLatestMainDelta(repoRoot);
	assert.deepEqual(
		JSON.parse(current.read(FOLLOWUP)),
		latestMainEvidence(delta),
		"latest-main evidence does not reconstruct",
	);
	const readerEdits = [
		...delta.edits,
		...delta.reader_anchor_repairs.map((repair) => ({
			target_path: repair.target_path,
			before: `\n${repair.heading}\n`,
			after: `\n${repair.addition}${repair.heading}\n`,
		})),
	];
	const waitDelta = waitMain ? reconstructWaitMainDelta(repoRoot) : undefined;
	if (waitDelta) {
		assert.equal(
			current.read(FOLLOWUP),
			git(repoRoot, ["show", `${SECOND_RECONCILIATION}:${FOLLOWUP}`]),
			"immutable second-reconciliation evidence changed",
		);
		assert.deepEqual(
			JSON.parse(current.read(WAIT_FOLLOWUP)),
			waitMainEvidence(waitDelta),
			"wait-main evidence does not reconstruct",
		);
		readerEdits.push(...waitDelta.edits, ...waitDelta.compatibility_pointers);
	}
	const fourthDelta = fourthMain ? reconstructFourthMainDelta(repoRoot) : undefined;
	const fourthEdits = fourthDelta ? [...fourthDelta.reader_edits, ...fourthDelta.reader_repairs] : [];
	const newPaths = new Set(fourthDelta?.new_pages.map((page) => page.target_path) ?? []);
	if (fourthDelta) {
		assert.ok(waitMain && authoringReferences, "fourth-main requires all predecessor proofs");
		assert.deepEqual(
			JSON.parse(current.read(FOURTH_FOLLOWUP)),
			fourthMainEvidence(fourthDelta),
			"fourth-main evidence does not reconstruct",
		);
		assert.equal(
			current.read(WAIT_FOLLOWUP),
			git(repoRoot, ["show", `${FOURTH_PREDECESSOR}:${WAIT_FOLLOWUP}`]),
			"immutable third-reconciliation evidence changed",
		);
		for (const page of fourthDelta.new_pages)
			assert.equal(current.read(page.target_path), page.text, `fourth-main new page differs: ${page.target_path}`);
		assert.equal(
			current.read(fourthDelta.maintainer_retention.target_path),
			fourthDelta.maintainer_retention.text,
			"fourth-main active maintainer recipe differs",
		);
		assert.equal(
			digest(current.read(FOURTH_README)),
			FOURTH_README_SHA256,
			"fourth-main provenance explanation changed",
		);
		readerEdits.push(...fourthEdits);
	}
	const restored = new Map();
	if (authoringReferences) {
		for (const [path, addition] of authoringReferenceAdditions) {
			const text = current.read(path);
			assert.ok(text.endsWith(addition), `authoring reference addition differs: ${path}`);
			// Remove only the exact disclosed suffix. Every preceding byte still faces the prior proof.
			restored.set(path, text.slice(0, -addition.length));
		}
	}
	for (const edit of [...readerEdits].reverse()) {
		const text = restored.get(edit.target_path) ?? current.read(edit.target_path);
		restored.set(edit.target_path, replaceDelta(text, edit.after, edit.before, edit.target_path));
	}
	const result = verify({
		repoRoot,
		snapshot: {
			pages: current.pages.filter((path) => !newPaths.has(path)),
			read: (path) => restored.get(path) ?? current.read(path),
		},
	});
	// Byte-exact closure includes all docs assets/navigation, histories, and original and
	// supplemental manifests. No refreshed final snapshot can bless an unrelated change.
	const roots = [DOCS, "docs/migrations/"];
	const frozenPaths = git(repoRoot, ["ls-tree", "-r", "--name-only", FIRST_RECONCILIATION, "--", ...roots])
		.trim()
		.split("\n");
	if (waitMain)
		assert.deepEqual(
			git(repoRoot, ["ls-tree", "-r", "--name-only", SECOND_RECONCILIATION, "--", ...roots])
				.trim()
				.split("\n")
				.sort(),
			[...frozenPaths, FOLLOWUP].sort(),
			"second-reconciliation frozen file set differs",
		);
	if (fourthMain)
		assert.deepEqual(
			git(repoRoot, ["ls-tree", "-r", "--name-only", FOURTH_PREDECESSOR, "--", ...roots])
				.trim()
				.split("\n")
				.sort(),
			[...frozenPaths, FOLLOWUP, WAIT_FOLLOWUP].sort(),
			"fourth-main predecessor frozen file set differs",
		);
	const currentPaths = revision
		? git(repoRoot, ["ls-tree", "-r", "--name-only", revision, "--", ...roots])
				.trim()
				.split("\n")
		: roots.flatMap((root) =>
				readdirSync(join(repoRoot, root), { recursive: true, withFileTypes: true })
					.filter((entry) => entry.isFile())
					.map((entry) =>
						posix.join(
							root,
							resolve(entry.parentPath, entry.name)
								.slice(resolve(repoRoot, root).length + 1)
								.replaceAll("\\", "/"),
						),
					),
			);
	assert.deepEqual(
		currentPaths
			.filter(
				(path) =>
					path !== FOLLOWUP &&
					!(waitMain && path === WAIT_FOLLOWUP) &&
					!(fourthMain && (path === FOURTH_FOLLOWUP || path === FOURTH_README || newPaths.has(path))),
			)
			.sort(),
		frozenPaths.sort(),
		"latest-main reconciliation changed the frozen file set",
	);
	for (const path of frozenPaths) {
		let expected = git(repoRoot, ["show", `${FIRST_RECONCILIATION}:${path}`], undefined, "buffer");
		for (const edit of readerEdits.filter(
			(row) =>
				row.target_path === path &&
				!waitDelta?.edits.includes(row) &&
				!waitDelta?.compatibility_pointers.includes(row) &&
				!fourthEdits.includes(row),
		))
			expected = Buffer.from(replaceDelta(expected.toString("utf8"), edit.before, edit.after, path));
		if (waitDelta) {
			assert.ok(
				expected.equals(git(repoRoot, ["show", `${SECOND_RECONCILIATION}:${path}`], undefined, "buffer")),
				`second-reconciliation predecessor differs: ${path}`,
			);
			for (const edit of [...waitDelta.edits, ...waitDelta.compatibility_pointers].filter(
				(row) => row.target_path === path,
			))
				expected = Buffer.from(replaceDelta(expected.toString("utf8"), edit.before, edit.after, path));
		}
		if (authoringReferences && authoringReferenceAdditions.has(path))
			expected = Buffer.concat([expected, Buffer.from(authoringReferenceAdditions.get(path))]);
		if (fourthDelta) {
			assert.ok(
				expected.equals(git(repoRoot, ["show", `${FOURTH_PREDECESSOR}:${path}`], undefined, "buffer")),
				`fourth-main predecessor differs: ${path}`,
			);
			for (const edit of fourthEdits.filter((row) => row.target_path === path))
				expected = Buffer.from(replaceDelta(expected.toString("utf8"), edit.before, edit.after, path));
		}
		const actual = revision
			? git(repoRoot, ["show", `${revision}:${path}`], undefined, "buffer")
			: overrides?.has(path)
				? Buffer.from(overrides.get(path))
				: readFileSync(join(repoRoot, path));
		assert.ok(actual.equals(expected), `latest-main exact preservation differs: ${path}`);
	}
	return {
		...result,
		readerPages: current.pages.length,
		...(fourthDelta
			? {
					fourthMain: {
						revision: FOURTH_MAIN,
						pages: fourthDelta.pages.filter((page) => /\.mdx?$/u.test(page.path)).length,
						unchangedPages: fourthDelta.pages.filter((page) => page.unchanged).length,
						changedPages: fourthDelta.pages.filter(
							(page) => !page.unchanged && !page.added && /\.mdx?$/u.test(page.path),
						).length,
						newPages: fourthDelta.new_pages.length,
						edits: fourthDelta.edits.length,
						readerRepairs: fourthDelta.reader_repairs.length,
					},
				}
			: {}),
		...(authoringReferences ? { authoringReferenceAdditions: authoringReferenceAdditions.size } : {}),
		readerAnchorRepairs: delta.reader_anchor_repairs.length,
		latestMain: {
			revision: LATEST_MAIN,
			pages: delta.pages.length,
			unchangedPages: delta.pages.filter((page) => page.unchanged).length,
			edits: delta.edits.length,
		},
		...(waitDelta
			? {
					waitMain: {
						revision: WAIT_MAIN,
						pages: waitDelta.pages.length,
						unchangedPages: waitDelta.pages.filter((page) => page.unchanged).length,
						edits: waitDelta.edits.length,
						compatibilityPointers: waitDelta.compatibility_pointers.length,
					},
				}
			: {}),
	};
}

/** Committed mode never consults working-tree docs, manifests, or ledger. Safe through a data URL. */
export function verifyCommittedDocumentation({ repoRoot, revision = "HEAD" }) {
	const commit = git(repoRoot, ["rev-parse", "--verify", `${revision}^{commit}`]).trim();
	const latest = git(repoRoot, ["merge-base", commit, LATEST_MAIN]).trim() === LATEST_MAIN;
	const waitMain = git(repoRoot, ["merge-base", commit, WAIT_MAIN]).trim() === WAIT_MAIN;
	const fourthMain = git(repoRoot, ["merge-base", commit, FOURTH_MAIN]).trim() === FOURTH_MAIN;
	const authoringReferences =
		commit !== AUTHORING_PREDECESSOR &&
		git(repoRoot, ["merge-base", commit, AUTHORING_PREDECESSOR]).trim() === AUTHORING_PREDECESSOR;
	const result = latest
		? verifyLatest({ repoRoot, revision: commit, waitMain, authoringReferences, fourthMain })
		: verify({ repoRoot, revision: commit });
	console.log(JSON.stringify({ mode: "committed", revision: commit, ...result }));
	return result;
}

/** Explicit precommit mode; overrides are a disposable in-memory negative-control fixture. */
export function verifyWorkingTreeDocumentation({ repoRoot, overrides = new Map() }) {
	return verifyLatest({ repoRoot, overrides, waitMain: true, authoringReferences: true, fourthMain: true });
}

if (
	import.meta.url.startsWith("file:") &&
	process.argv[1] &&
	process.argv[1] !== "-" &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	assert.ok(
		["--working-tree", "--committed"].includes(process.argv[2]),
		"choose --working-tree or --committed [revision]",
	);
	const repoRoot = resolve(process.cwd());
	if (process.argv[2] === "--committed")
		verifyCommittedDocumentation({ repoRoot, revision: process.argv[3] ?? "HEAD" });
	else console.log(JSON.stringify({ mode: "working-tree", ...verifyWorkingTreeDocumentation({ repoRoot }) }));
}
