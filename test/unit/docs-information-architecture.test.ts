import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "vitest";
import { moduleDir } from "../helpers/runtime.js";

/**
 * Information-architecture contract for bastani-inc/atomic#2847.
 *
 * The pinned Mintlify commands cover what they cover and no more:
 * `validate` rejects a navigation entry with no file, `broken-links` resolves
 * page and image targets but not anchors (that needs `--check-anchors`, which
 * CI does not pass), and neither one notices a page that exists on disk but
 * fell out of navigation. This suite is the mechanical guard for the rest of
 * the migration contract.
 *
 * Nothing here trusts ledger metadata on its own. Source blocks are re-read
 * from the recorded baseline commit and re-hashed; destination blocks are
 * located by their exact anchor and re-hashed; compatibility pointers are
 * compared target-for-target, duplicate `-N` suffix included. A ledger row that
 * claims a destination whose content no longer matches fails here.
 */

const repoRoot = resolve(moduleDir(import.meta.url), "../..");
const docsDir = join(repoRoot, "packages/coding-agent/docs");
const docsJson = JSON.parse(readFileSync(join(docsDir, "docs.json"), "utf8")) as DocsConfig;

interface DocsConfig {
	navigation?: unknown;
	redirects?: { source: string; destination: string; permanent?: boolean }[];
}

type NavNode = string | { [key: string]: unknown };

function collectNavPages(value: unknown, out: string[] = []): string[] {
	if (typeof value === "string") {
		out.push(value);
		return out;
	}
	if (Array.isArray(value)) {
		for (const item of value as NavNode[]) collectNavPages(item, out);
		return out;
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of ["tabs", "anchors", "groups", "pages"]) {
			if (record[key] !== undefined) collectNavPages(record[key], out);
		}
	}
	return out;
}

function onDiskSlugs(): string[] {
	return readdirSync(docsDir, { recursive: true, encoding: "utf8" })
		.filter((name) => name.endsWith(".md") || name.endsWith(".mdx"))
		.map((name) => name.replaceAll("\\", "/").replace(/\.mdx?$/u, ""))
		.sort();
}

const navPages = collectNavPages(docsJson.navigation);
const diskSlugs = onDiskSlugs();
const pathForSlug = (slug: string): string => (existsSync(join(docsDir, `${slug}.md`)) ? `${slug}.md` : `${slug}.mdx`);
const routeToSlug = new Map(diskSlugs.map((slug) => [`/${slug}`, slug]));

/**
 * Mintlify 4.2.731's heading slugger, established by running the pinned CLI's
 * `broken-links --check-anchors` against probe pages rather than by reading its
 * prose docs, which are wrong about apostrophes and silent about collapsing:
 *
 *   1. strip markdown formatting to plain text, then lowercase
 *   2. `.` becomes `-`
 *   3. apostrophes are deleted outright
 *   4. other punctuation becomes a separator (so `foo(bar)` is `foo-bar`, not `foobar`)
 *   5. `/ & _ + - — –` survive
 *   6. whitespace becomes `-`, runs of `-` collapse to one, and edges are trimmed
 *   7. repeated headings are numbered page-wide: `x`, `x-2`, `x-3`
 *
 * It is NOT github-slugger, which is why several anchors recorded in the
 * released CHANGELOG have never resolved.
 */
function mintlifyAnchor(heading: string): string {
	return heading
		.replace(/`([^`]*)`/gu, "$1")
		.replace(/\*\*([^*]*)\*\*/gu, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
		.toLowerCase()
		.replaceAll(".", "-")
		.replaceAll("'", "")
		.replaceAll("\u2019", "")
		.replace(/["(),:?!]/gu, "-")
		.replace(/[^\w\s/&+\u2013\u2014-]/gu, "-")
		.trim()
		.replace(/\s+/gu, "-")
		.replace(/-{2,}/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

interface Heading {
	line: number;
	level: number;
	text: string;
	anchor: string;
}

/** Every heading a document declares outside fenced code, with its exact anchor. */
function headingsIn(text: string): Heading[] {
	const out: Heading[] = [];
	const seen = new Map<string, number>();
	let fence: string | undefined;
	const lines = text.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const marker = /^\s*(```|~~~)/u.exec(line);
		if (marker) {
			fence = fence ? undefined : marker[1];
			continue;
		}
		if (fence) continue;
		const heading = /^(#{1,6})\s+(.*?)\s*$/u.exec(line);
		if (!heading) continue;
		const text_ = heading[2] ?? "";
		const base = mintlifyAnchor(text_);
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		out.push({
			line: index,
			level: (heading[1] ?? "").length,
			text: text_,
			anchor: count === 1 ? base : `${base}-${count}`,
		});
	}
	return out;
}

/** Which lines of a document sit inside a fenced code block. */
function fencedLineFlags(lines: readonly string[]): boolean[] {
	const flags: boolean[] = [];
	let fence: string | undefined;
	for (const line of lines) {
		const marker = /^\s*(```|~~~)/u.exec(line);
		if (marker) {
			flags.push(true);
			fence = fence ? undefined : marker[1];
			continue;
		}
		flags.push(fence !== undefined);
	}
	return flags;
}

const headingCache = new Map<string, Heading[]>();
function headingsOfPage(slug: string): Heading[] {
	const cached = headingCache.get(slug);
	if (cached) return cached;
	const parsed = headingsIn(readFileSync(join(docsDir, pathForSlug(slug)), "utf8"));
	headingCache.set(slug, parsed);
	return parsed;
}

/**
 * `2847-v1` hash normalization, the single implementation this suite uses and
 * the one the ledger names in `hash_normalization`: trailing whitespace
 * trimmed, blank lines dropped, heading depth flattened, `../images/` folded to
 * `images/`, and an in-page `](#a)` link promoted to `](/route#a)` folded back.
 */
function normalizeBlock(lines: readonly string[]): string {
	const out: string[] = [];
	for (const raw of lines) {
		let line = raw.replace(/\s+$/u, "");
		line = line.replace(/^(#{1,6})\s+(.*)$/u, "# $2");
		line = line.replaceAll('src="../images/', 'src="images/');
		line = line.replace(/\]\(\/[A-Za-z0-9._/-]*#/gu, "](#");
		if (!line) continue;
		out.push(line);
	}
	return out.join("\n");
}

function blockDigest(lines: readonly string[]): string {
	return `sha256:${createHash("sha256").update(normalizeBlock(lines), "utf8").digest("hex").slice(0, 16)}`;
}

interface LedgerRow {
	id: string;
	source_path: string;
	source_anchor: string | null;
	source_heading: string | null;
	source_lines: [number, number];
	hash: string;
	kind: string;
	class: string;
	dest_path: string;
	dest_anchor: string | null;
	dest_occurrence: number | null;
	status: string;
	verification: string;
	note: string;
}
interface PublicRoute {
	id: string;
	source: string;
	kind: "page" | "canonical" | "redirect";
	page?: string;
	destination?: string;
}
interface RepositoryReference {
	id: string;
	category: string;
	source_path: string;
	source_line: number;
	kind: string;
	source_target: string;
	destination_target: string;
	status: string;
	note: string;
}
interface LinkRetarget {
	source_path: string;
	source_line: number;
	baseline_target: string;
	destination_target: string;
	reason: string;
}
interface LinkRetargetException {
	source_path: string;
	source_line: number;
	target: string;
	would_be: string;
	reason: string;
}

/**
 * A live citation whose baseline anchor never resolved. Unlike a route retarget,
 * an anchor change survives `2847-v1` normalization, so the destination check
 * applies exactly these corrections to the baseline before hashing.
 */
interface AnchorCorrection {
	block_id: string;
	source_path: string;
	source_line: number;
	baseline_target: string;
	corrected_target: string;
	reason: string;
}

/**
 * The Phase 1 guardrail: derived exclusively from the baseline commit, with no
 * field read from or influenced by the migrated tree. The regeneration test
 * below rebuilds this file from that commit alone and asserts equality, which
 * is what makes "baseline-only" mechanically true rather than a claim in prose.
 */
interface BaselineInventory {
	baseline_rev: string;
	hash_normalization: string;
	provenance: string;
	baseline: {
		pages: number;
		blocks: number;
		routes: string[];
		public_routes: PublicRoute[];
		anchors: { page: string; anchor: string; heading: string | null }[];
		links: { page: string; line: number; target: string }[];
		images: { page: string; line: number; src: string }[];
	};
	blocks: BaselineBlock[];
	repository_references: BaselineReference[];
}
interface BaselineBlock {
	id: string;
	source_path: string;
	source_anchor: string | null;
	source_heading: string | null;
	source_lines: [number, number];
	hash: string;
	kind: string;
	fences: number;
	tables: number;
	callouts: number;
	class: string;
}
interface BaselineReference {
	id: string;
	category: string;
	source_path: string;
	source_line: number;
	kind: string;
	source_target: string;
}

/** The post-move half: every field that requires the migrated tree, keyed by baseline id. */
interface DestinationMap {
	baseline_rev: string;
	hash_normalization: string;
	blocks: Record<
		string,
		{
			dest_path: string;
			dest_anchor: string | null;
			dest_occurrence: number | null;
			status: string;
			verification: string;
			note: string;
		}
	>;
	repository_references: Record<string, { destination_target: string; status: string; note: string }>;
	link_retargets: LinkRetarget[];
	link_retarget_exceptions: LinkRetargetException[];
	anchor_corrections: AnchorCorrection[];
}

const baselineInventory = JSON.parse(
	readFileSync(join(repoRoot, "docs/migrations/2847-baseline-inventory.json"), "utf8"),
) as BaselineInventory;
const destinationMap = JSON.parse(
	readFileSync(join(repoRoot, "docs/migrations/2847-destination-map.json"), "utf8"),
) as DestinationMap;

/** The joined view the content assertions read. The halves stay separate on disk. */
const ledger = {
	baseline_rev: baselineInventory.baseline_rev,
	hash_normalization: baselineInventory.hash_normalization,
	baseline: baselineInventory.baseline,
	blocks: baselineInventory.blocks.map((block) => ({
		...block,
		...(destinationMap.blocks[block.id] ?? {
			dest_path: "",
			dest_anchor: null,
			dest_occurrence: null,
			status: "unmapped",
			verification: "unmapped",
			note: "",
		}),
	})) as LedgerRow[],
	repository_references: baselineInventory.repository_references.map((reference) => ({
		...reference,
		...(destinationMap.repository_references[reference.id] ?? {
			destination_target: "",
			status: "unmapped",
			note: "",
		}),
	})) as RepositoryReference[],
	link_retargets: destinationMap.link_retargets,
	link_retarget_exceptions: destinationMap.link_retarget_exceptions,
	anchor_corrections: destinationMap.anchor_corrections,
};

/**
 * The baseline page as it existed at `ledger.baseline_rev`. CI checks out with
 * `fetch-depth: 0`, so the commit is reachable there; a missing object fails
 * loudly rather than quietly skipping the strongest assertion in this file.
 */
const baselineCache = new Map<string, string[]>();
function baselinePage(page: string): string[] {
	const cached = baselineCache.get(page);
	if (cached) return cached;
	let text: string;
	try {
		text = execFileSync(
			"git",
			["-C", repoRoot, "show", `${ledger.baseline_rev}:packages/coding-agent/docs/${page}`],
			{
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
			},
		);
	} catch (error) {
		throw new Error(
			`cannot read ${page} at baseline ${ledger.baseline_rev}: ${(error as Error).message}. ` +
				"The ledger's baseline commit must be reachable; fetch it rather than skipping this check.",
		);
	}
	const lines = text.split("\n");
	baselineCache.set(page, lines);
	return lines;
}

/** The destination block a ledger row names, located by its exact anchor. */
function destinationBlock(row: LedgerRow): string[] {
	const slug = row.dest_path.replace(/\.mdx?$/u, "");
	const text = readFileSync(join(docsDir, row.dest_path), "utf8");
	const lines = text.split("\n");
	const headings = headingsOfPage(slug);
	if (row.dest_anchor === null) {
		const first = headings[0]?.line ?? lines.length;
		return lines.slice(0, first);
	}
	const index = headings.findIndex((heading) => heading.anchor === row.dest_anchor);
	assert.notEqual(index, -1, `${row.id}: ${row.dest_path} has no heading with anchor "${row.dest_anchor}"`);
	const start = headings[index]?.line ?? 0;
	const end = headings[index + 1]?.line ?? lines.length;
	return lines.slice(start, end);
}

/**
 * The 44 routes that existed before the migration. #2847 requires every one of
 * them to keep working, so this list is frozen: a deletion has to fail loudly
 * rather than quietly 404 for readers and for agents reading published docs.
 */
const preMigrationRoutes = [
	"/changelog",
	"/compaction",
	"/containerization",
	"/custom-provider",
	"/development",
	"/environment-variables",
	"/extensions",
	"/index",
	"/intercom",
	"/json",
	"/keybindings",
	"/llama-cpp",
	"/models",
	"/models/artificial-analysis-index",
	"/models/model-selection",
	"/models/pareto-efficiency",
	"/packages",
	"/prompt-templates",
	"/providers",
	"/quickstart",
	"/rpc",
	"/sdk",
	"/security",
	"/session-format",
	"/sessions",
	"/settings",
	"/shell-aliases",
	"/skills",
	"/subagents",
	"/terminal-setup",
	"/termux",
	"/themes",
	"/tmux",
	"/tools",
	"/tools/edit",
	"/tui",
	"/usage",
	"/windows",
	"/workflows",
	"/workflows/api-reference",
	"/workflows/authoring",
	"/workflows/builtins",
	"/workflows/operations",
	"/workflows/reliable-design",
] as const;

/** Every route the issue's proposed structure names, transcribed from #2847. */
const proposedRoutes = [
	"/",
	"/build",
	"/changelog",
	"/compaction",
	"/compaction/reference",
	"/containerization",
	"/custom-provider",
	"/development",
	"/environment-variables",
	"/extensions",
	"/extensions/api-reference",
	"/getting-started/authentication",
	"/getting-started/first-session",
	"/getting-started/installation",
	"/getting-started/project-instructions",
	"/guides",
	"/intercom",
	"/json",
	"/keybindings",
	"/llama-cpp",
	"/models",
	"/models/reference",
	"/packages",
	"/programmatic",
	"/prompt-templates",
	"/providers",
	"/providers/reference",
	"/quickstart",
	"/reference",
	"/reference/cli",
	"/rpc",
	"/rpc/protocol",
	"/sdk",
	"/sdk/reference",
	"/security",
	"/session-format",
	"/sessions",
	"/settings",
	"/shell-aliases",
	"/skills",
	"/subagents",
	"/terminal-setup",
	"/termux",
	"/themes",
	"/tmux",
	"/tools",
	"/tools/edit",
	"/tui",
	"/tui/reference",
	"/usage",
	"/windows",
	"/workflows",
	"/workflows/api-reference",
	"/workflows/authoring",
	"/workflows/builtins",
	"/workflows/operations",
	"/workflows/reliable-design",
] as const;

/**
 * The reader-facing label #2847 gives each route in its proposed tree,
 * transcribed from the issue. Mintlify has no per-page label field in
 * `docs.json` — its navigation reference requires each `pages` entry to be a
 * page path — so a label is supplied by frontmatter `sidebarTitle` or `title`,
 * and otherwise falls back to a title-cased last path segment.
 */
const issueNavigationLabels: Record<string, string> = {
	"/": "Overview",
	"/quickstart": "Quickstart",
	"/getting-started/installation": "Installation",
	"/getting-started/authentication": "Authentication",
	"/getting-started/first-session": "First session",
	"/getting-started/project-instructions": "Project instructions",
	"/guides": "Guides",
	"/usage": "Interactive use",
	"/sessions": "Sessions",
	"/compaction": "Context and compaction",
	"/providers": "Providers",
	"/llama-cpp": "Local models",
	"/security": "Security",
	"/containerization": "Containerization",
	"/build": "Build with Atomic",
	"/skills": "Skills",
	"/subagents": "Subagents",
	"/intercom": "Intercom",
	"/workflows": "Workflows",
	"/workflows/builtins": "Builtins",
	"/workflows/authoring": "Authoring",
	"/workflows/reliable-design": "Reliable design",
	"/workflows/operations": "Operations",
	"/workflows/api-reference": "API reference",
	"/extensions": "Extensions",
	"/prompt-templates": "Prompt templates",
	"/themes": "Themes",
	"/packages": "Packages",
	"/models": "Custom models",
	"/custom-provider": "Custom providers",
	"/programmatic": "Programmatic use",
	"/sdk": "SDK",
	"/rpc": "RPC",
	"/json": "JSON event stream",
	"/tui": "TUI components",
	"/reference": "Reference index",
	"/reference/cli": "CLI reference",
	"/settings": "Settings",
	"/environment-variables": "Environment variables",
	"/keybindings": "Keybindings",
	"/tools": "Built-in tools",
	"/tools/edit": "edit",
	"/session-format": "Session format",
	"/providers/reference": "Provider reference",
	"/models/reference": "Model configuration",
	"/compaction/reference": "Compaction internals",
	"/extensions/api-reference": "Extension API",
	"/sdk/reference": "SDK API",
	"/rpc/protocol": "RPC protocol",
	"/tui/reference": "TUI API",
	"/windows": "Windows",
	"/termux": "Termux",
	"/terminal-setup": "Terminal setup",
	"/tmux": "tmux",
	"/shell-aliases": "Shell aliases",
	"/development": "Development",
	"/changelog": "Changelog",
};

/** Route order within each reader tab, transcribed from #2847's proposed tree. */
const issueNavigationOrder: Record<string, readonly string[]> = {
	Learn: [
		"/",
		"/quickstart",
		"/getting-started/installation",
		"/getting-started/authentication",
		"/getting-started/first-session",
		"/getting-started/project-instructions",
		"/guides",
		"/usage",
		"/sessions",
		"/compaction",
		"/providers",
		"/llama-cpp",
		"/security",
		"/containerization",
	],
	Build: [
		"/build",
		"/skills",
		"/subagents",
		"/intercom",
		"/workflows",
		"/workflows/builtins",
		"/workflows/authoring",
		"/workflows/reliable-design",
		"/workflows/operations",
		"/workflows/api-reference",
		"/extensions",
		"/prompt-templates",
		"/themes",
		"/packages",
		"/models",
		"/custom-provider",
		"/programmatic",
		"/sdk",
		"/rpc",
		"/json",
		"/tui",
	],
	Reference: [
		"/reference",
		"/reference/cli",
		"/settings",
		"/environment-variables",
		"/keybindings",
		"/tools",
		"/tools/edit",
		"/session-format",
		"/providers/reference",
		"/models/reference",
		"/compaction/reference",
		"/extensions/api-reference",
		"/sdk/reference",
		"/rpc/protocol",
		"/tui/reference",
		"/windows",
		"/termux",
		"/terminal-setup",
		"/tmux",
		"/shell-aliases",
		"/development",
		"/changelog",
	],
};

/**
 * Pages created by the migration but not named in the issue's route tree.
 * Each stays immediately after the route whose topic it extends. The reference
 * cluster follows compaction internals because its parents live in Build.
 */
const generatedNavigationInsertions: Record<string, readonly string[]> = {
	"/usage": ["/guides/configuration"],
	"/skills": ["/skills/authoring"],
	"/subagents": ["/subagents/authoring"],
	"/intercom": ["/intercom/operations"],
	"/extensions": ["/extensions/authoring", "/extensions/events", "/extensions/ui", "/extensions/examples"],
	"/packages": ["/packages/authoring"],
	"/models": ["/models/model-selection", "/models/pareto-efficiency", "/models/artificial-analysis-index"],
	"/custom-provider": [
		"/custom-provider/override",
		"/custom-provider/registration",
		"/custom-provider/oauth",
		"/custom-provider/streaming",
	],
	"/rpc": ["/rpc/extension-ui", "/rpc/examples"],
	"/compaction/reference": [
		"/skills/reference",
		"/subagents/reference",
		"/intercom/reference",
		"/packages/reference",
		"/themes/reference",
	],
	"/extensions/api-reference": ["/custom-provider/api-reference"],
};

/** A page's YAML frontmatter, limited to the scalar fields this suite reads. */
function frontmatterOf(slug: string): { title?: string; sidebarTitle?: string; description?: string } {
	const text = readFileSync(join(docsDir, pathForSlug(slug)), "utf8");
	if (!text.startsWith("---\n")) return {};
	const end = text.indexOf("\n---\n", 3);
	if (end === -1) return {};
	const fields: Record<string, string> = {};
	for (const line of text.slice(4, end).split("\n")) {
		const match = /^(\w+):\s*"?(.*?)"?\s*$/u.exec(line);
		if (match?.[1]) fields[match[1]] = match[2] ?? "";
	}
	return fields;
}

/**
 * Anchors that were already unresolvable at the launch baseline and stay that
 * way, split by the provenance that justifies each exemption. A live reader
 * citation is never exempt: the four that were here — `/index#alpine-and-musl-
 * linux-archives`, `/providers#llamacpp`, `/settings#model--thinking`, and
 * `/extensions#ctxmodelregistry--ctxmodel--ctxscopedmodels` — are corrected in
 * the tree and recorded in the ledger instead.
 */

/** github-slugger shapes the released CHANGELOG recorded that Mintlify never generated. */
const historicalChangelogAnchors = new Set([
	"/extensions#ctxsignal",
	"/extensions#message_start--message_update--message_end",
	"/extensions#pigetcommands",
	"/extensions#tool-call-events",
	"/settings#terminal--images",
	"/tui#working-indicator",
]);

/** Broken at the baseline on pages #2847 freezes; repairing one would restructure a frozen page. */
const frozenWorkflowAnchors = new Set([
	"/workflows/api-reference#fallbackmodels--fallbackthinkinglevels",
	"/workflows/api-reference#setupgitworktreeoptions",
	"/workflows/authoring#early-exit-with-ctxexit",
	"/workflows/operations#ctxtool--durable-cached-tool-execution",
	"/workflows/operations#workflow-resume--cross-session-resume-selector",
]);

const brokenBeforeMigration = new Set([...historicalChangelogAnchors, ...frozenWorkflowAnchors]);

/** Shipped prompts and prompt guidance that name repository docs paths. */
const promptSources = [
	"packages/coding-agent/src/core/system-prompt.ts",
	"packages/subagents/src/extension/prompt-guidance.ts",
	"packages/workflows/src/extension/workflow-prompts.ts",
] as const;

function anchorResolves(route: string, anchor: string): boolean {
	const slug = routeToSlug.get(route);
	if (slug === undefined) return false;
	const headings = headingsOfPage(slug);
	if (headings.some((heading) => heading.anchor === anchor)) return true;
	// Mintlify numbers repeated headings page-wide; treat an unmatched `-N`
	// leniently because its counter also sees text this checker cannot model.
	// Exact duplicate identity is enforced separately, against the ledger.
	const duplicate = /^(.*)-\d+$/u.exec(anchor);
	return duplicate !== null && headings.some((heading) => heading.anchor === duplicate[1]);
}

describe("docs information architecture (#2847)", () => {
	test("every navigation entry resolves to a page on disk", () => {
		assert.ok(navPages.length > 40, "docs.json navigation was discovered, not hardcoded");
		const slugs = new Set(diskSlugs);
		for (const page of navPages) {
			assert.ok(slugs.has(page), `docs.json lists "${page}", which has no .md or .mdx file on disk`);
		}
	});

	test("every page on disk appears in navigation exactly once", () => {
		// A page that is routable but absent from navigation silently drops out of
		// the sidebar, search, the sitemap, and llms.txt, and neither Mintlify
		// command reports it.
		const counts = new Map<string, number>();
		for (const page of navPages) counts.set(page, (counts.get(page) ?? 0) + 1);
		for (const slug of diskSlugs) {
			assert.equal(counts.get(slug) ?? 0, 1, `${slug} must appear in docs.json navigation exactly once`);
		}
	});

	test("navigation uses the three reader-centered tabs", () => {
		const navigation = docsJson.navigation as { tabs?: { tab?: string }[] } | undefined;
		assert.ok(Array.isArray(navigation?.tabs), "navigation must use the tabs shape");
		assert.deepEqual(
			navigation?.tabs?.map((tab) => tab.tab),
			["Learn", "Build", "Reference"],
		);
	});

	test("each reader tab keeps the route order specified by the issue", () => {
		const navigation = docsJson.navigation as { tabs?: { tab?: string; [key: string]: unknown }[] } | undefined;
		assert.ok(Array.isArray(navigation?.tabs), "navigation must use the tabs shape");
		for (const tab of navigation?.tabs ?? []) {
			const name = tab.tab ?? "";
			const expected = issueNavigationOrder[name];
			assert.ok(expected, `${name} has no issue-order contract`);
			const expectedSet = new Set(expected);
			const projection = collectNavPages(tab)
				.map((slug) => (slug === "index" ? "/" : `/${slug}`))
				.filter((route) => expectedSet.has(route));
			assert.deepEqual(projection, expected, `${name} routes must follow #2847's proposed order`);
		}
		assert.equal(Object.values(issueNavigationOrder).flat().length, 57, "all 57 issue routes have an order");
	});

	test("every generated page keeps its recorded insertion point", () => {
		const navigation = docsJson.navigation as { tabs?: { tab?: string; [key: string]: unknown }[] } | undefined;
		assert.ok(Array.isArray(navigation?.tabs), "navigation must use the tabs shape");
		const tabRoutes = (navigation?.tabs ?? []).map((tab) =>
			collectNavPages(tab).map((slug) => (slug === "index" ? "/" : `/${slug}`)),
		);
		const enumerated = new Set(Object.values(issueNavigationOrder).flat());
		const generated = tabRoutes
			.flat()
			.filter((route) => !enumerated.has(route))
			.sort();
		const expectedGenerated = Object.values(generatedNavigationInsertions).flat().sort();
		assert.equal(expectedGenerated.length, 24, "all 24 migration-created pages have an insertion point");
		assert.deepEqual(generated, expectedGenerated, "no generated page may fall outside the insertion contract");

		for (const [anchor, inserted] of Object.entries(generatedNavigationInsertions)) {
			const routes = tabRoutes.find((tab) => tab.includes(anchor));
			assert.ok(routes, `${anchor} is not present in a reader tab`);
			const at = routes.indexOf(anchor);
			assert.deepEqual(
				routes.slice(at + 1, at + 1 + inserted.length),
				inserted,
				`${inserted.join(", ")} must stay immediately after ${anchor}`,
			);
		}
	});

	test("every pre-migration route still resolves", () => {
		const routes = new Set(diskSlugs.map((slug) => `/${slug}`));
		for (const route of preMigrationRoutes) {
			assert.ok(routes.has(route), `${route} existed before #2847 and must keep working`);
		}
	});

	test("every route the issue proposes exists", () => {
		const routes = new Set(diskSlugs.map((slug) => `/${slug}`));
		routes.add("/"); // the canonical route, served by index.md
		for (const route of proposedRoutes) {
			assert.ok(routes.has(route), `#2847 proposes ${route}, which has no page`);
		}
	});

	test("every navigation entry is a bare page path", () => {
		// Mintlify's navigation reference requires each `pages` entry to reference a
		// page file. An object entry carrying a label is silently accepted by
		// `validate` but is not a documented shape, so reject it here.
		const walk = (value: unknown, path: string): void => {
			if (typeof value === "string") return;
			if (Array.isArray(value)) {
				for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`);
				return;
			}
			assert.ok(value && typeof value === "object", `${path} must be a page path or a group`);
			const record = value as Record<string, unknown>;
			assert.ok(
				"group" in record || "tab" in record || "tabs" in record || "groups" in record,
				`${path} is an object without a group or tab; a page entry must be a bare path string`,
			);
			for (const key of ["tabs", "anchors", "groups", "pages"]) {
				if (record[key] !== undefined) walk(record[key], `${path}.${key}`);
			}
		};
		walk(docsJson.navigation, "navigation");
	});

	test("every route the issue enumerates renders its specified label", () => {
		// Mintlify resolves a page's navigation label as sidebarTitle, then title,
		// then a path-derived fallback that title-cases the last segment. That
		// fallback is what rendered `Sdk`, `Rpc`, `Json`, and `Llama cpp`, none of
		// which is the label #2847 specifies.
		const wrong: string[] = [];
		for (const [route, expected] of Object.entries(issueNavigationLabels)) {
			const slug = route === "/" ? "index" : route.slice(1);
			assert.ok(routeToSlug.has(`/${slug}`), `${route} has no page`);
			const frontmatter = frontmatterOf(slug);
			const derived = (): string => {
				const last = (slug.split("/").pop() ?? "").replaceAll("-", " ").replaceAll("_", " ");
				return last.charAt(0).toUpperCase() + last.slice(1);
			};
			const effective = frontmatter.sidebarTitle ?? frontmatter.title ?? derived();
			if (effective !== expected) wrong.push(`${route}: renders "${effective}", #2847 specifies "${expected}"`);
		}
		assert.equal(Object.keys(issueNavigationLabels).length, 57, "all 57 enumerated routes are checked");
		assert.deepEqual(wrong, [], "navigation labels must match the issue's enumerated tree exactly");
	});
});

describe("docs public entry points (#2847)", () => {
	const publicRoutes = ledger.baseline.public_routes;

	test("the ledger separates public entry points from baseline page count", () => {
		assert.equal(ledger.baseline.pages, 44, "the baseline shipped 44 Markdown/MDX pages");
		assert.equal(publicRoutes.length, 47, "44 page routes plus the canonical route and both redirect sources");
		assert.notEqual(
			publicRoutes.length,
			ledger.baseline.pages,
			"a route count that equals the page count cannot represent aliases or redirects",
		);
		assert.deepEqual(
			publicRoutes
				.filter((route) => route.kind === "page")
				.map((route) => route.source)
				.sort(),
			[...preMigrationRoutes].sort(),
		);
	});

	test("the canonical route and /index are both backed by index.md", () => {
		const canonical = publicRoutes.find((route) => route.kind === "canonical");
		assert.ok(canonical, "the ledger must record the canonical route");
		assert.equal(canonical?.source, "/");
		assert.equal(canonical?.page, "index.md");
		assert.ok(existsSync(join(docsDir, "index.md")), "/ and /index are both served by index.md");
		assert.ok(routeToSlug.has("/index"));
	});

	test("every baseline page route still has a page on disk", () => {
		for (const route of publicRoutes) {
			if (route.kind !== "page") continue;
			assert.ok(route.page, `${route.source} must record its backing page`);
			assert.ok(
				existsSync(join(docsDir, route.page ?? "")),
				`${route.source} was a public entry point at baseline and its page is gone`,
			);
		}
	});

	test("both redirects survive in docs.json with exact, resolving destinations", () => {
		const configured = new Map((docsJson.redirects ?? []).map((entry) => [entry.source, entry.destination]));
		const recorded = publicRoutes.filter((route) => route.kind === "redirect");
		assert.equal(recorded.length, 2, "the baseline shipped /session and /tree");
		for (const route of recorded) {
			assert.ok(
				configured.has(route.source),
				`redirect source ${route.source} existed at baseline and must stay in docs.json`,
			);
			assert.equal(
				configured.get(route.source),
				route.destination,
				`redirect ${route.source} must keep its exact destination`,
			);
			assert.ok(
				routeToSlug.has(route.destination ?? ""),
				`redirect ${route.source} points at ${route.destination}, which has no page`,
			);
		}
		// Mintlify rejects a fragment in a redirect source, which is why moved
		// fragments are covered by compatibility headings instead.
		for (const entry of docsJson.redirects ?? []) {
			assert.ok(!entry.source.includes("#"), `${entry.source}: Mintlify redirect sources cannot carry a fragment`);
		}
	});
});

describe("docs compatibility headings (#2847)", () => {
	const movedRows = ledger.blocks.filter((row) => row.status === "moved" && row.source_heading !== null);

	test("every moved section keeps its heading, verbatim and in baseline order", () => {
		// Mintlify redirect sources cannot carry a fragment, so a compatibility
		// heading is the only way a moved section's anchor keeps resolving. The
		// assertion compares heading TEXT, not a re-slugged anchor, so it holds
		// under any slug rule. Order matters too: Mintlify numbers repeated
		// headings page-wide, so a stub out of order moves a `-N` onto the wrong
		// occurrence.
		const cursors = new Map<string, number>();
		let checked = 0;
		for (const row of movedRows) {
			const slug = row.source_path.replace(/\.mdx?$/u, "");
			const headings = headingsOfPage(slug);
			const from = cursors.get(slug) ?? 0;
			const found = headings.findIndex((heading, index) => index >= from && heading.text === row.source_heading);
			assert.notEqual(
				found,
				-1,
				`${row.source_path} moved "${row.source_heading}" away and must keep a compatibility heading for it, ` +
					"in the same position relative to the other moved headings",
			);
			// Matching text is not enough: a slug-equivalent heading inserted above
			// the stub pushes the real one to `-2` and silently hands the baseline
			// anchor to unrelated content.
			assert.equal(
				headings[found]?.anchor,
				row.source_anchor,
				`${row.source_path}: the compatibility heading for "${row.source_heading}" generates ` +
					`#${headings[found]?.anchor}, but the baseline anchor is #${row.source_anchor}`,
			);
			cursors.set(slug, found + 1);
			checked += 1;
		}
		assert.equal(checked, movedRows.length);
		assert.ok(checked > 300, `the ledger was read, not skipped (checked ${checked})`);
	});

	test("every compatibility pointer names its row's exact destination route and anchor", () => {
		// A pointer that drops a duplicate `-N` suffix still "resolves" — to the
		// wrong occurrence. Compare the whole target instead.
		const cursors = new Map<string, number>();
		const problems: string[] = [];
		for (const row of movedRows) {
			const slug = row.source_path.replace(/\.mdx?$/u, "");
			const lines = readFileSync(join(docsDir, pathForSlug(slug)), "utf8").split("\n");
			const headings = headingsOfPage(slug);
			const from = cursors.get(slug) ?? 0;
			const index = headings.findIndex((heading, at) => at >= from && heading.text === row.source_heading);
			assert.notEqual(index, -1, `${row.id}: no compatibility heading for "${row.source_heading}"`);
			cursors.set(slug, index + 1);
			const start = headings[index]?.line ?? 0;
			const end = headings[index + 1]?.line ?? lines.length;
			const fenced = fencedLineFlags(lines);
			const pointer = lines
				.slice(start, end)
				.map((line, offset) =>
					// A pointer inside a fenced block renders as sample text, not as a
					// link, so it is not a compatibility pointer at all.
					fenced[start + offset]
						? undefined
						: /^Moved to \[[^\]]*\]\((\/[A-Za-z0-9._/-]*#[^)]*)\)\.$/u.exec(line)?.[1],
				)
				.find((match) => match !== undefined);
			const expected = `/${row.dest_path.replace(/\.mdx?$/u, "")}#${row.dest_anchor}`;
			if (pointer === undefined) {
				problems.push(`${row.id}: compatibility block has no "Moved to" pointer (expected ${expected})`);
				continue;
			}
			if (pointer !== expected) problems.push(`${row.id}: pointer is ${pointer}, ledger says ${expected}`);
		}
		assert.deepEqual(problems, [], "compatibility pointers must match their ledger destination exactly");
	});

	test("no compatibility stub keeps a copy of the content it points at", () => {
		// A stub is a heading, optional connective text, and the pointer. A fenced
		// example left behind is a stripped duplicate of content the ledger placed
		// elsewhere: the reader sees an unlabelled copy under a heading whose own
		// text says the content moved, and the corpus gains a line the baseline
		// counted once.
		const cursors = new Map<string, number>();
		const problems: string[] = [];
		let checked = 0;
		// Every line the page gave away, by source page: a stub may repeat none of
		// them, whichever moved block they came from.
		const movedBody = new Map<string, string[]>();
		for (const row of movedRows) {
			const body = baselinePage(row.source_path)
				.slice(row.source_lines[0] - 1, row.source_lines[1])
				.map((line) => line.trim())
				.filter((line) => line.length > 11 && !/^(```|~~~|#{1,6}\s|[|:>-]+$)/u.test(line));
			movedBody.set(row.source_path, [...(movedBody.get(row.source_path) ?? []), ...body]);
		}
		for (const row of movedRows) {
			const slug = row.source_path.replace(/\.mdx?$/u, "");
			const lines = readFileSync(join(docsDir, pathForSlug(slug)), "utf8").split("\n");
			const headings = headingsOfPage(slug);
			const from = cursors.get(slug) ?? 0;
			const index = headings.findIndex((heading, at) => at >= from && heading.text === row.source_heading);
			if (index === -1) continue; // the compatibility-heading test owns this failure
			cursors.set(slug, index + 1);
			checked += 1;
			const start = headings[index]?.line ?? 0;
			const end = headings[index + 1]?.line ?? lines.length;
			const region = lines.slice(start, end);
			const fence = region.findIndex((line) => /^\s*(```|~~~)/u.test(line));
			if (fence !== -1) {
				problems.push(
					`${row.id}: the stub for "${row.source_heading}" on ${row.source_path} still carries a code fence at ` +
						`line ${start + fence + 1}; its content lives at ${row.dest_path}#${row.dest_anchor}`,
				);
			}
			// A fence is the obvious shape, not the only one: the same command
			// pasted as inline code, a blockquote, or an HTML block is the same
			// stripped duplicate.
			const body = movedBody.get(row.source_path) ?? [];
			for (const [offset, line] of region.entries()) {
				if (line.startsWith("Moved to [")) continue;
				const copied = body.find((baseline) => line.includes(baseline));
				if (copied === undefined) continue;
				problems.push(
					`${row.id}: ${row.source_path}:${start + offset + 1} repeats "${copied.slice(0, 60)}" from a block ` +
						"that moved off this page",
				);
			}
		}
		assert.ok(checked > 300, `the ledger was read, not skipped (checked ${checked})`);
		assert.deepEqual(problems, [], "a compatibility stub carries a pointer, not a copy of the moved example");
	});

	test("every docs anchor cited anywhere in the repository resolves", () => {
		const unresolved = new Set<string>();
		let checked = 0;
		const record = (route: string, anchor: string): void => {
			checked += 1;
			const citation = `${route}#${anchor}`;
			if (brokenBeforeMigration.has(citation)) return;
			if (!anchorResolves(route, anchor)) unresolved.add(citation);
		};

		for (const slug of diskSlugs) {
			const text = readFileSync(join(docsDir, pathForSlug(slug)), "utf8");
			for (const match of text.matchAll(/\]\((\/[A-Za-z0-9._/-]*)#([^)\s]+)\)/gu)) {
				record(match[1] ?? "", match[2] ?? "");
			}
			for (const match of text.matchAll(/\]\(#([^)\s]+)\)/gu)) {
				record(`/${slug}`, match[1] ?? "");
			}
		}
		for (const source of new Set(ledger.repository_references.map((reference) => reference.source_path))) {
			if (!existsSync(join(repoRoot, source))) continue;
			const text = readFileSync(join(repoRoot, source), "utf8");
			for (const match of text.matchAll(/docs\/([\w./-]+)\.mdx?#([\w./&+_\u2013\u2014-]+)/gu)) {
				const relative = match[1] ?? "";
				if (!routeToSlug.has(`/${relative}`)) continue;
				record(`/${relative}`, match[2] ?? "");
			}
			for (const match of text.matchAll(/https:\/\/docs\.bastani\.ai(\/[\w./-]*)#([\w./&+_-]+)/gu)) {
				record(match[1] ?? "", match[2] ?? "");
			}
		}

		assert.ok(checked > 200, `citations were discovered, not hardcoded (checked ${checked})`);
		assert.deepEqual(
			[...unresolved].sort(),
			[],
			"these docs anchors are cited somewhere in the repository but no longer resolve",
		);
	});

	test("the pre-existing broken-anchor list stays honest", () => {
		// Every entry must still be genuinely unresolvable. When one starts
		// resolving, delete it here rather than letting the exclusion mask a
		// future regression at the same anchor.
		for (const citation of brokenBeforeMigration) {
			const [route = "", anchor = ""] = citation.split("#");
			assert.ok(!anchorResolves(route, anchor), `${citation} now resolves; remove it from brokenBeforeMigration`);
		}
	});

	test("every exempt anchor is cited only by the provenance that exempts it", () => {
		// The exemption has to be earned, not declared. An anchor stays exempt only
		// while its citers are the immutable released changelog or a page #2847
		// freezes; a live reader citation must be corrected instead.
		const exempt = [...brokenBeforeMigration];
		const anchors = exempt.map((citation) => citation.split("#")[1] ?? "");
		const pattern = new RegExp(`\\]\\(([^)\\s]*)#(${anchors.join("|")})\\)`, "gu");
		const routeOf = (written: string, ownRoute: string | undefined): string | undefined => {
			if (written === "") return ownRoute;
			// The published site is the same page under a different spelling; a
			// docs.bastani.ai citation is a live reader citation like any other.
			if (written.startsWith("https://docs.bastani.ai")) {
				const route = written.slice("https://docs.bastani.ai".length).replace(/\/$/u, "");
				return route === "" ? "/" : route;
			}
			if (written.startsWith("/")) return written;
			const [, tail] = written.split("docs/");
			return tail === undefined ? undefined : `/${tail.replace(/\.mdx?$/u, "")}`;
		};
		const citers = new Map<string, Set<string>>();
		const collect = (file: string, ownRoute: string | undefined, text: string): void => {
			for (const match of text.matchAll(pattern)) {
				const route = routeOf(match[1] ?? "", ownRoute);
				if (route === undefined) continue;
				const citation = `${route}#${match[2]}`;
				if (!brokenBeforeMigration.has(citation)) continue;
				const seen = citers.get(citation) ?? new Set<string>();
				seen.add(file);
				citers.set(citation, seen);
			}
		};
		// The docs tree includes pages the migration created, which git does not
		// track yet, so it is scanned directly rather than through git grep.
		for (const slug of diskSlugs) {
			const page = pathForSlug(slug);
			collect(`packages/coding-agent/docs/${page}`, `/${slug}`, readFileSync(join(docsDir, page), "utf8"));
		}
		let grepped = "";
		try {
			grepped = execFileSync(
				"git",
				[
					"-C",
					repoRoot,
					"grep",
					"-I",
					"-n",
					"-E",
					`\\]\\([^)]*#(${anchors.join("|")})\\)`,
					"--",
					":!research",
					":!specs",
					":!docs/migrations",
				],
				{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
			);
		} catch {
			grepped = ""; // git grep exits 1 when nothing matches
		}
		for (const line of grepped.split("\n")) {
			if (!line) continue;
			const [file = "", , ...rest] = line.split(":");
			const own = file.startsWith("packages/coding-agent/docs/")
				? `/${file.slice("packages/coding-agent/docs/".length).replace(/\.mdx?$/u, "")}`
				: undefined;
			collect(file, own, rest.join(":"));
		}

		const wrong: string[] = [];
		for (const citation of exempt) {
			const found = [...(citers.get(citation) ?? [])].sort();
			assert.ok(found.length > 0, `${citation} is exempt but nothing cites it; drop the exemption`);
			const historical = historicalChangelogAnchors.has(citation);
			for (const file of found) {
				const allowed = historical
					? file === "packages/coding-agent/CHANGELOG.md"
					: /^packages\/coding-agent\/docs\/workflows(\.md|\/)/u.test(file);
				if (!allowed) wrong.push(`${citation} is cited by ${file}, which is a live reader citation`);
			}
		}
		assert.deepEqual(wrong, [], "a live citation cannot be exempted; correct the anchor instead");
	});
});

describe("docs references and assets (#2847)", () => {
	test("every docs path a shipped prompt names exists", () => {
		const pattern = /(?:[\w./-]*)docs\/([\w./-]+\.mdx?)/gu;
		let checked = 0;
		for (const source of promptSources) {
			const text = readFileSync(join(repoRoot, source), "utf8");
			for (const match of text.matchAll(pattern)) {
				const relative = match[1] ?? "";
				if (relative.startsWith("foo.")) continue; // the template placeholder in system-prompt.ts
				assert.ok(
					existsSync(join(docsDir, relative)),
					`${source} names packages/coding-agent/docs/${relative}, which does not exist`,
				);
				checked += 1;
			}
		}
		assert.ok(checked > 10, "the prompt sources were scanned, not silently skipped");
	});

	test("every baseline repository reference carries exactly one disposition", () => {
		const references = ledger.repository_references;
		assert.ok(references.length > 500, `the reference inventory was built, not stubbed (${references.length})`);
		const allowed = new Set(["unchanged", "retargeted", "historical", "fixture", "placeholder", "other-doc-tree"]);
		const categories = new Set(["source", "prompt", "skill", "test", "readme", "changelog", "example", "script"]);
		const ids = new Set<string>();
		for (const reference of references) {
			assert.ok(allowed.has(reference.status), `${reference.id}: unknown disposition "${reference.status}"`);
			assert.ok(categories.has(reference.category), `${reference.id}: unknown category "${reference.category}"`);
			assert.ok(!ids.has(reference.id), `${reference.id}: duplicate reference id`);
			ids.add(reference.id);
			assert.ok(reference.source_line > 0, `${reference.id}: must record its baseline line`);
		}
		// Every role the issue names is represented, so a whole category cannot
		// silently drop out of the inventory.
		for (const category of ["source", "prompt", "skill", "test", "readme", "changelog", "example", "script"]) {
			assert.ok(
				references.some((reference) => reference.category === category),
				`the inventory records no ${category} reference`,
			);
		}
	});

	test("every live repository reference still points at a page that exists", () => {
		let checked = 0;
		for (const reference of ledger.repository_references) {
			if (reference.status !== "unchanged") continue;
			if (reference.kind === "public-url") {
				const route = reference.source_target.split("#")[0]?.replace(/\/$/u, "").replace(/\.$/u, "") ?? "";
				if (route === "" || route.endsWith(".txt")) continue;
				assert.ok(routeToSlug.has(route), `${reference.source_path}:${reference.source_line} cites ${route}`);
			} else {
				const relative = reference.source_target.split("#")[0]?.split("docs/")[1] ?? "";
				assert.ok(
					existsSync(join(docsDir, relative)),
					`${reference.source_path}:${reference.source_line} cites docs/${relative}, which is gone`,
				);
			}
			checked += 1;
		}
		assert.ok(checked > 100, `live references were checked, not skipped (${checked})`);
	});

	test("no live reference cites a fragment the ledger records as moved", () => {
		// A compatibility heading keeps an old anchor resolving, so a stale citation
		// passes every existence check while still landing the reader on a
		// "Moved to …" stub. Only a moved-map comparison catches it.
		const moved = new Map<string, string>();
		for (const row of ledger.blocks) {
			if (row.status !== "moved" || !row.source_anchor || !row.dest_anchor) continue;
			const from = `${row.source_path.replace(/\.mdx?$/u, "")}#${row.source_anchor}`;
			moved.set(from, `${row.dest_path.replace(/\.mdx?$/u, "")}#${row.dest_anchor}`);
		}
		assert.ok(moved.size > 100, `the moved map was built from the ledger (${moved.size})`);

		const stale: string[] = [];
		let checked = 0;
		for (const reference of ledger.repository_references) {
			// Historical, fixture, placeholder, and other-tree citations are exempt:
			// they are pinned to a release tag, synthetic, or outside this migration.
			if (reference.status !== "unchanged") continue;
			if (reference.kind === "public-url") continue;
			const [path = "", fragment] = reference.source_target.split("#");
			if (!fragment) continue;
			const relative = path.split("docs/")[1];
			if (!relative) continue;
			checked += 1;
			// "Unchanged" is a claim about the tree, not a label: the source must
			// still carry the baseline target, or the row is a retarget in disguise.
			if (existsSync(join(repoRoot, reference.source_path))) {
				const text = readFileSync(join(repoRoot, reference.source_path), "utf8");
				assert.ok(
					text.includes(reference.source_target),
					`${reference.source_path} is recorded unchanged but no longer contains ${reference.source_target}`,
				);
			}
			const key = `${relative.replace(/\.mdx?$/u, "")}#${fragment}`;
			const destination = moved.get(key);
			if (destination !== undefined) {
				stale.push(
					`${reference.source_path}:${reference.source_line} cites ${reference.source_target}, ` +
						`which moved to ${destination}`,
				);
			}
		}
		assert.ok(checked > 0, "anchored live references were scanned, not silently skipped");
		assert.deepEqual(stale, [], "a live citation must name the page that holds the content, not the stub");
	});

	test("every retargeted reference proves its new destination", () => {
		const retargeted = ledger.repository_references.filter((reference) => reference.status === "retargeted");
		assert.ok(retargeted.length > 0, "the retarget disposition is exercised, not vacuous");
		for (const reference of retargeted) {
			assert.ok(reference.destination_target, `${reference.id} must record where it now points`);
			const text = readFileSync(join(repoRoot, reference.source_path), "utf8");
			assert.ok(
				text.includes(reference.destination_target),
				`${reference.source_path} must contain its recorded destination ${reference.destination_target}`,
			);
			assert.ok(
				!text.includes(reference.source_target),
				`${reference.source_path} still contains the baseline target ${reference.source_target}`,
			);
			const [path = "", fragment] = reference.destination_target.split("#");
			const relative = path.split("docs/")[1] ?? "";
			assert.ok(existsSync(join(docsDir, relative)), `${reference.id} points at a missing docs/${relative}`);
			if (fragment) {
				assert.ok(
					anchorResolves(`/${relative.replace(/\.mdx?$/u, "")}`, fragment),
					`${reference.id}: ${reference.destination_target} does not resolve`,
				);
			}
		}
	});

	test("no docs-internal link points at a fragment the ledger records as moved", () => {
		const moved = new Map<string, string>();
		for (const row of ledger.blocks) {
			if (row.status !== "moved" || !row.source_anchor || !row.dest_anchor) continue;
			moved.set(
				`/${row.source_path.replace(/\.mdx?$/u, "")}#${row.source_anchor}`,
				`/${row.dest_path.replace(/\.mdx?$/u, "")}#${row.dest_anchor}`,
			);
		}
		const exceptions = new Set(
			ledger.link_retarget_exceptions.map((entry) => `${entry.source_path}:${entry.target}`),
		);
		const stale: string[] = [];
		let checked = 0;
		let checkedRelative = 0;
		for (const slug of diskSlugs) {
			// #2847 forbids restructuring the workflow pages, and they are
			// byte-identical to the launch baseline. Their links stay put and keep
			// resolving through the preserved compatibility headings; each one is
			// recorded in the ledger's link_retarget_exceptions with a reason.
			const frozen = slug === "workflows" || slug.startsWith("workflows/");
			const path = pathForSlug(slug);
			for (const line of readFileSync(join(docsDir, path), "utf8").split("\n")) {
				if (line.startsWith("Moved to [")) continue; // the compatibility pointers target destinations already
				for (const match of line.matchAll(/\]\((\/[A-Za-z0-9._/-]*)#([^)\s]+)\)/gu)) {
					const target = `${match[1]}#${match[2]}`;
					if (brokenBeforeMigration.has(target)) continue;
					checked += 1;
					const destination = moved.get(target);
					if (destination === undefined) continue;
					if (frozen && exceptions.has(`${path}:${target}`)) continue;
					stale.push(`${path} links ${target}, which moved to ${destination}`);
				}
				// A relative fragment resolves against its own page, so a hub page's
				// table of contents can silently keep pointing at a section that now
				// holds only a "Moved to …" stub. Same rule, resolved differently.
				for (const match of line.matchAll(/\]\(#([^)\s]+)\)/gu)) {
					const written = `#${match[1]}`;
					const target = `/${slug}${written}`;
					if (brokenBeforeMigration.has(target)) continue;
					checkedRelative += 1;
					const destination = moved.get(target);
					// An in-page link to a section that never moved is ordinary and correct.
					if (destination === undefined) continue;
					if (frozen && exceptions.has(`${path}:${written}`)) continue;
					stale.push(`${path} links ${written}, which moved to ${destination}`);
				}
			}
		}
		assert.ok(checked > 50, `docs-internal links were scanned, not skipped (${checked})`);
		assert.ok(checkedRelative > 50, `in-page fragment links were scanned, not skipped (${checkedRelative})`);
		assert.deepEqual(stale, [], "a docs link must reach the content directly, not through a compatibility stub");
	});

	test("every retargeted docs citation is recorded in the ledger", () => {
		// The stale-link test proves no citation still points at a stub. This one
		// proves the other half: each rewrite the migration performed is recorded,
		// so the retarget list cannot be emptied or trimmed without failing here.
		const linkTargets = (text: string): Set<string> =>
			new Set(
				text
					.split("\n")
					// A compatibility pointer names the destination by construction; it
					// is the stub itself, not a rewritten citation.
					.filter((line) => !line.startsWith("Moved to ["))
					.flatMap((line) => [...line.matchAll(/\]\((#[^)\s]+|\/[A-Za-z0-9._/-]*#[^)\s]+)\)/gu)])
					.map((match) => match[1] ?? ""),
			);
		const baselineSources = new Set(ledger.blocks.map((row) => row.source_path));
		const current = new Map<string, Set<string>>();
		const before = new Map<string, Set<string>>();
		for (const slug of diskSlugs) {
			const page = pathForSlug(slug);
			current.set(page, linkTargets(readFileSync(join(docsDir, page), "utf8")));
			if (baselineSources.has(page)) before.set(page, linkTargets(baselinePage(page).join("\n")));
		}
		const recorded = new Set(
			ledger.link_retargets.map(
				(entry) => `${entry.source_path}:${entry.baseline_target}:${entry.destination_target}`,
			),
		);
		const missing: string[] = [];
		let proven = 0;
		for (const row of ledger.blocks) {
			if (row.status !== "moved" || !row.source_anchor || !row.dest_anchor) continue;
			const from = `/${row.source_path.replace(/\.mdx?$/u, "")}#${row.source_anchor}`;
			const to = `/${row.dest_path.replace(/\.mdx?$/u, "")}#${row.dest_anchor}`;
			for (const [page, baselineLinks] of before) {
				if (!current.get(page)?.has(to)) continue;
				const written = baselineLinks.has(from)
					? from
					: page === row.source_path && baselineLinks.has(`#${row.source_anchor}`)
						? `#${row.source_anchor}`
						: undefined;
				// The citation is newly authored connective text, not a rewrite.
				if (written === undefined) continue;
				proven += 1;
				if (!recorded.has(`${page}:${written}:${to}`)) {
					missing.push(`${page}: ${written} -> ${to} is not recorded in link_retargets`);
				}
			}
		}
		assert.ok(proven > 60, `retargeted citations were derived from the tree, not assumed (${proven})`);
		assert.deepEqual(missing, [], "every citation the migration rewrote needs a link_retargets row");

		// The other direction: a recorded row must still describe the tree. Without
		// this, a citation rewritten again to a different valid route keeps its
		// stale row, and route folding hides the change from the block hashes.
		const stale: string[] = [];
		for (const entry of ledger.link_retargets) {
			const targets = current.get(entry.source_path);
			if (targets === undefined) {
				stale.push(`${entry.source_path} is recorded as retargeted but is not a docs page`);
				continue;
			}
			if (!targets.has(entry.destination_target)) {
				stale.push(`${entry.source_path} no longer cites its recorded destination ${entry.destination_target}`);
			}
			if (targets.has(entry.baseline_target)) {
				stale.push(`${entry.source_path} still cites the baseline target ${entry.baseline_target}`);
			}
			// The recorded line is part of the record, and it drifts silently when a
			// page gains frontmatter or connective text above the citation.
			const line = readFileSync(join(docsDir, entry.source_path), "utf8").split("\n")[entry.source_line - 1] ?? "";
			if (!line.includes(`](${entry.destination_target})`)) {
				stale.push(`${entry.source_path}:${entry.source_line} no longer holds ${entry.destination_target}`);
			}
		}
		assert.deepEqual(stale, [], "every link_retargets row must still describe the current tree");
	});

	test("Intercom operations maps observable states to recovery actions", () => {
		const text = readFileSync(join(docsDir, "intercom/operations.md"), "utf8");
		const h2s = headingsIn(text)
			.filter((heading) => heading.level === 2)
			.map((heading) => heading.text);
		assert.deepEqual(
			h2s,
			[
				"Connection states and recovery",
				"How Connection Works",
				"How It Works",
				"Workflow and Subagent Notifications",
				"Keyboard Shortcuts",
				"Limitations",
			],
			"the runbook must lead with state and recovery, then connection internals and delivery contracts",
		);

		const lines = text.split("\n");
		const start = lines.indexOf("## Connection states and recovery");
		const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
		assert.ok(start >= 0 && end > start, "the state table must be a bounded H2 section");
		const rows = lines
			.slice(start, end)
			.filter((line) => line.startsWith("| ") && !line.startsWith("| ---"))
			.map((line) =>
				line
					.split("|")
					.slice(1, -1)
					.map((cell) => cell.trim()),
			);
		assert.deepEqual(rows.shift(), ["State", "What you see", "What to do"]);
		assert.deepEqual(
			rows.map((row) => row[0]),
			[
				"Not connected or waiting for lazy admission",
				"Recoverable disconnect",
				"Reconnect backoff",
				"Exhausted workflow-stage warm-up",
				"Terminal stage delivery failure",
				"Destination-side admission failure",
				"Broker restart or concurrent startup",
				"Broker does not start",
				"Half-closed peer or undeliverable send",
			],
			"the runbook must cover every observable lifecycle state named by the Intercom contracts",
		);
		for (const [state, symptom, recovery] of rows) {
			assert.ok(symptom && symptom.length > 20, `${state} needs an observable symptom`);
			assert.ok(recovery && recovery.length > 20, `${state} needs a recovery action`);
			assert.match(recovery, /See \[[^\]]+\]\(#[^)]+\)\.$/u, `${state} must link to its detailed contract`);
		}
	});

	test("the first-success path is not interrupted by advanced material", () => {
		// #2847's Phase 3 gate and its onboarding page pattern both require the
		// runnable sequence and its expected result before anything advanced. On
		// getting-started/first-session.md the advanced blocks are exactly the
		// sections the ledger maps in from quickstart.md, so the boundary is
		// derived rather than guessed.
		const advanced = new Set(
			ledger.blocks
				.filter((row) => row.status === "moved" && row.dest_path === "getting-started/first-session.md")
				.map((row) => row.source_heading)
				.filter((heading): heading is string => heading !== null),
		);
		assert.ok(advanced.size > 3, `the advanced sections were derived from the ledger (${advanced.size})`);

		const headings = headingsOfPage("getting-started/first-session");
		const verify = headings.findIndex((heading) => /^Verify /u.test(heading.text));
		assert.notEqual(verify, -1, "first-session.md must carry a runnable verification section");
		const firstAdvanced = headings.findIndex(
			(heading, index) => index > 0 && heading.level > 2 && advanced.has(heading.text),
		);
		assert.notEqual(firstAdvanced, -1, "the advanced sections must still be on the page");
		assert.ok(
			verify < firstAdvanced,
			`"${headings[verify]?.text}" must precede "${headings[firstAdvanced]?.text}"; ` +
				"the first runnable session comes before advanced workflow material",
		);
	});

	test("the first-session expected result names only documented default tools", () => {
		// The expected result and the default-tool list are two halves of one page.
		// When the sentence named `find` or `bash` only, a session that answered
		// correctly with `read` on a directory failed a criterion the same page
		// contradicts three sections later.
		const lines = readFileSync(join(docsDir, "getting-started/first-session.md"), "utf8").split("\n");
		const sentence = lines.find((line) => line.startsWith("Expected result: Atomic streams a response"));
		assert.ok(sentence, "first-session.md must state the expected result of its runnable task");
		// Only the enumerated clause, not the recovery advice that follows it.
		const clause = /calls (.+?) at least once —/u.exec(sentence ?? "")?.[1];
		assert.ok(clause, "the expected result must enumerate the tools that satisfy it");
		const named = [...(clause ?? "").matchAll(/`([a-z_]+)`/gu)].map((match) => match[1] ?? "");
		const documented = new Set(
			lines.map((line) => /^- `([a-z_]+)` - /u.exec(line)?.[1]).filter((tool): tool is string => tool !== undefined),
		);
		assert.ok(documented.size > 5, `the default-tool list was read, not skipped (${documented.size})`);
		for (const tool of named) {
			assert.ok(documented.has(tool), `the expected result names \`${tool}\`, which the page never documents`);
		}
		// The exact set that can answer "list the top-level directories": `read`
		// accepts a directory and returns a tree (see
		// packages/coding-agent/src/core/tools/read.ts and its directory-read
		// parity test), `find` discovers paths, and `bash` runs a shell command.
		// Dropping one makes a correct session fail the documented criterion.
		assert.deepEqual(
			[...named].sort(),
			["bash", "find", "read"],
			"the expected result must accept exactly the default tools that can answer the task",
		);
		// A tool named outside a code span is invisible to that check, so the
		// clause may not smuggle one in as plain prose.
		const prose = (clause ?? "").replaceAll(/`[^`]*`/gu, " ");
		const shellNames = new Set([...documented, "ls", "grep", "cat", "tree", "dir", "rg", "fd"]);
		for (const word of prose.match(/[a-z_]{2,}/gu) ?? []) {
			assert.ok(!shellNames.has(word), `the expected result names ${word} outside a code span`);
		}
	});

	test("workflow pages differ from the baseline by navigation metadata only", () => {
		// #2847 freezes the workflow learning path. Supplying the label the issue
		// enumerates for /workflows/api-reference is metadata, not structure, so
		// this asserts the stronger property directly: outside a leading
		// frontmatter block, every workflow page is byte-identical to the baseline.
		const workflowPages = diskSlugs.filter((slug) => slug === "workflows" || slug.startsWith("workflows/"));
		assert.equal(workflowPages.length, 6, "the six workflow pages are all checked");
		const stripFrontmatter = (text: string): string => {
			if (!text.startsWith("---\n")) return text;
			const end = text.indexOf("\n---\n", 3);
			return end === -1 ? text : text.slice(end + "\n---\n".length).replace(/^\n/u, "");
		};
		for (const slug of workflowPages) {
			const current = stripFrontmatter(readFileSync(join(docsDir, pathForSlug(slug)), "utf8"));
			const baseline = stripFrontmatter(baselinePage(pathForSlug(slug)).join("\n"));
			assert.equal(current, baseline, `${slug} changed outside its frontmatter; the workflow pages are frozen`);
		}
	});

	test("every relative image reference resolves from its page", () => {
		let checked = 0;
		for (const slug of diskSlugs) {
			const path = pathForSlug(slug);
			const text = readFileSync(join(docsDir, path), "utf8");
			for (const match of text.matchAll(/<img\s+[^>]*src="([^"]+)"/gu)) {
				const src = match[1] ?? "";
				if (src.startsWith("http") || src.startsWith("/")) continue;
				assert.ok(
					existsSync(resolve(dirname(join(docsDir, path)), src)),
					`${path} references ${src}, which does not resolve from that page's directory`,
				);
				checked += 1;
			}
		}
		assert.equal(checked, 6, "all six relative image references must still be checked");
	});
});

describe("docs content ledger (#2847)", () => {
	test("the ledger declares its baseline and normalization", () => {
		assert.match(ledger.baseline_rev, /^[0-9a-f]{40}$/u, "the baseline commit is recorded in full");
		assert.equal(ledger.hash_normalization, "2847-v1", "the test and the ledger must share one normalization");
		assert.ok(ledger.blocks.length > 1000, "the ledger covers the whole baseline corpus");
	});

	test("every baseline block re-hashes from the recorded baseline commit", () => {
		// Recompute rather than trust: a ledger row could otherwise claim a hash
		// for a block that was edited or deleted.
		const problems: string[] = [];
		for (const row of ledger.blocks) {
			const lines = baselinePage(row.source_path);
			const [start, end] = row.source_lines;
			const block = lines.slice(start - 1, end);
			const digest = blockDigest(block);
			if (digest !== row.hash) problems.push(`${row.id}: recorded ${row.hash}, recomputed ${digest}`);
		}
		assert.deepEqual(problems, [], "every ledger hash must recompute from the baseline commit");
	});

	test("every block's destination still contains its baseline content", () => {
		const problems: string[] = [];
		for (const row of ledger.blocks) {
			assert.notEqual(row.status, "unmatched", `${row.id} has no destination`);
			assert.notEqual(row.status, "deleted", `${row.id} must not be deleted`);
			// `kept` and `moved` are derived facts, not free-form labels: relabelling
			// a moved row `kept` would exempt it from the compatibility-stub rules.
			assert.equal(
				row.status === "kept",
				row.source_path === row.dest_path,
				`${row.id} is recorded ${row.status} while it maps ${row.source_path} to ${row.dest_path}`,
			);
			assert.ok(row.dest_path, `${row.id} must record a destination path`);
			assert.ok(existsSync(join(docsDir, row.dest_path)), `${row.id} points at a missing ${row.dest_path}`);

			const baseline = baselinePage(row.source_path).slice(row.source_lines[0] - 1, row.source_lines[1]);
			// A block carrying recorded anchor corrections is compared against the
			// baseline with exactly those corrections applied, so the gate stays
			// strict: any unrecorded byte change still fails.
			const corrections = ledger.anchor_corrections.filter((entry) => entry.block_id === row.id);
			const expectedLines = corrections.length
				? baseline.map((line) =>
						corrections.reduce(
							(text, entry) => text.replaceAll(`](${entry.baseline_target})`, `](${entry.corrected_target})`),
							line,
						),
					)
				: baseline;
			const destination = destinationBlock(row);
			if (row.verification === "exact-hash") {
				const digest = blockDigest(destination);
				const expected = corrections.length ? blockDigest(expectedLines) : row.hash;
				if (digest !== expected) {
					problems.push(`${row.id}: ${row.dest_path}#${row.dest_anchor} hashes ${digest}, expected ${expected}`);
				}
				continue;
			}
			if (row.verification !== "ordered-body-containment") {
				problems.push(`${row.id}: unknown verification mode "${row.verification}"`);
				continue;
			}
			// A destination that gained connective text. The heading line is
			// excluded because `usage::011` moved `CLI Reference` to `CLI reference`.
			const wanted = normalizeBlock(baseline)
				.split("\n")
				.filter((line) => line && !line.startsWith("# "));
			const have = normalizeBlock(destination).split("\n");
			let cursor = 0;
			for (const line of wanted) {
				const at = have.indexOf(line, cursor);
				if (at === -1) {
					problems.push(
						`${row.id}: ${row.dest_path}#${row.dest_anchor} no longer contains "${line.slice(0, 70)}"`,
					);
					break;
				}
				cursor = at + 1;
			}
		}
		assert.deepEqual(problems, [], "every ledger destination must still carry its baseline content");
	});

	test("the connective-text exceptions are a closed, explicit set", () => {
		const extended = ledger.blocks.filter((row) => row.verification === "ordered-body-containment");
		assert.deepEqual(
			extended.map((row) => row.id).sort(),
			[
				"containerization::001",
				"prompt-templates::002",
				"quickstart::001",
				"quickstart::029",
				// sdk.md and tui.md open with a blockquote rather than a heading, so
				// their first block is a preamble. Frontmatter belongs to that block,
				// so supplying the navigation label #2847 specifies adds lines to it.
				"sdk::001",
				"skills::004",
				"tui::001",
				"usage::011",
			],
			"a new exception needs review; it cannot be added by relabelling a row",
		);
		// A preamble destination has no heading to name, so its anchor is null by
		// construction. Every other exception must name its anchor explicitly.
		const preambleExceptions = new Set(["sdk::001", "tui::001"]);
		for (const row of extended) {
			if (preambleExceptions.has(row.id)) {
				assert.equal(row.dest_anchor, null, `${row.id} maps a preamble block, which has no anchor`);
				assert.equal(row.kind, "preamble", `${row.id} must actually be a preamble block`);
			} else {
				assert.ok(row.dest_anchor, `${row.id} must name its destination anchor explicitly, not leave it null`);
			}
			assert.ok(row.note.trim().length > 20, `${row.id} needs a written explanation`);
		}
	});

	test("the live anchor corrections are a closed, verified set", () => {
		const corrections = ledger.anchor_corrections;
		assert.deepEqual(
			corrections.map((entry) => entry.block_id).sort(),
			["changelog::002", "models::001", "providers::002"],
			"a new anchor correction needs review; a baseline line cannot be edited without recording it",
		);
		// An exact anchor, not the lenient duplicate-suffix fallback: a correction
		// that invents `#anchor-999` would otherwise look resolved.
		const anchorExists = (page: string, target: string): boolean => {
			const own = `/${page.replace(/\.mdx?$/u, "")}`;
			const [route = "", anchor = ""] = target.startsWith("#") ? [own, target.slice(1)] : target.split("#");
			const slug = routeToSlug.get(route);
			if (slug === undefined) return false;
			return headingsOfPage(slug).some((heading) => heading.anchor === anchor);
		};
		const blocksById = new Map(ledger.blocks.map((row) => [row.id, row]));
		for (const entry of corrections) {
			assert.ok(entry.reason.trim().length > 20, `${entry.block_id} needs a written explanation`);
			const text = readFileSync(join(docsDir, entry.source_path), "utf8");
			assert.ok(
				text.includes(`](${entry.corrected_target})`),
				`${entry.source_path} must carry the corrected citation ${entry.corrected_target}`,
			);
			assert.ok(
				!text.includes(`](${entry.baseline_target})`),
				`${entry.source_path} still carries the broken citation ${entry.baseline_target}`,
			);
			// The recorded line is part of the record: it must name the baseline
			// citation and sit inside the block the correction claims.
			const row = blocksById.get(entry.block_id);
			assert.ok(row, `${entry.block_id} is not a ledger block`);
			assert.equal(row?.source_path, entry.source_path, `${entry.block_id} names a different source page`);
			const baselineLine = baselinePage(entry.source_path)[entry.source_line - 1] ?? "";
			assert.ok(
				baselineLine.includes(`](${entry.baseline_target})`),
				`${entry.source_path}:${entry.source_line} does not carry ${entry.baseline_target} at the baseline`,
			);
			assert.ok(
				row !== undefined && entry.source_line >= row.source_lines[0] && entry.source_line <= row.source_lines[1],
				`${entry.source_path}:${entry.source_line} lies outside ${entry.block_id}`,
			);
			assert.ok(
				anchorExists(entry.source_path, entry.corrected_target),
				`${entry.corrected_target} does not resolve; the correction would replace one dead anchor with another`,
			);
			assert.ok(
				!anchorExists(entry.source_path, entry.baseline_target),
				`${entry.baseline_target} resolves, so it needed no correction`,
			);
		}
	});

	test("the ledger summary matches the closed exception set", () => {
		const expectedIds = ledger.blocks
			.filter((row) => row.verification === "ordered-body-containment")
			.map((row) => row.id)
			.sort();
		const count = expectedIds.length;
		const summary = readFileSync(join(repoRoot, "docs/migrations/2847-content-ledger.md"), "utf8");

		const modeCount = /^\| `ordered-body-containment` \| (\d+) \|/mu.exec(summary);
		assert.ok(modeCount, "the verification table must state the containment count");
		assert.equal(Number(modeCount[1]), count, "the verification-table count must match the data");

		const tableStart = summary.indexOf("### The connective-text exceptions, in full");
		const tableEnd = summary.indexOf("This set is closed:", tableStart);
		assert.ok(tableStart >= 0 && tableEnd > tableStart, "the exception table must be bounded by its closed-set note");
		const statedIds = [...summary.slice(tableStart, tableEnd).matchAll(/^\| `([^`]+)` \|/gmu)]
			.map((match) => match[1] ?? "")
			.sort();
		assert.deepEqual(statedIds, expectedIds, "the summary must list every exception id exactly once");

		const statement = /asserts these (\w+) IDs exactly, so a (\w+)/u.exec(summary);
		assert.ok(statement, "the summary must state the closed exception count");
		const cardinal: Record<string, number> = { eight: 8 };
		const ordinal: Record<string, number> = { ninth: 9 };
		assert.equal(cardinal[statement[1] ?? ""], count, "the prose count must match the data");
		assert.equal(ordinal[statement[2] ?? ""], count + 1, "the prose must name the next forbidden exception");
	});

	test("duplicate baseline blocks map to distinct destination occurrences", () => {
		const byHash = new Map<string, LedgerRow[]>();
		for (const row of ledger.blocks) {
			const list = byHash.get(row.hash) ?? [];
			list.push(row);
			byHash.set(row.hash, list);
		}
		let duplicates = 0;
		for (const [hash, rows] of byHash) {
			if (rows.length < 2) continue;
			duplicates += 1;
			const targets = rows.map((row) => `${row.dest_path}#${row.dest_anchor}`);
			assert.equal(
				new Set(targets).size,
				targets.length,
				`hash ${hash} is shared by ${rows.map((row) => row.id).join(", ")}, which must claim distinct occurrences`,
			);
			for (const row of rows) {
				assert.ok(row.dest_occurrence, `${row.id} must record which destination occurrence it claims`);
			}
		}
		// Occurrence is a fact about the destination page, not a free-form number:
		// Mintlify numbers repeated headings page-wide, so a wrong occurrence
		// silently points a compatibility pointer at different content.
		for (const row of ledger.blocks) {
			if (!row.dest_anchor) continue;
			const slug = row.dest_path.replace(/\.mdx?$/u, "");
			const heading = headingsOfPage(slug).find((entry) => entry.anchor === row.dest_anchor);
			if (heading === undefined) continue; // the destination-content test owns a missing anchor
			const suffix = /-(\d+)$/u.exec(row.dest_anchor);
			assert.equal(
				row.dest_occurrence,
				suffix ? Number(suffix[1]) : 1,
				`${row.id} claims occurrence ${row.dest_occurrence} of ${row.dest_path}#${row.dest_anchor}`,
			);
		}
		assert.ok(duplicates > 0, "the duplicate-block case is exercised, not vacuous");
	});

	test("the ledger covers every page and route the baseline shipped", () => {
		assert.deepEqual([...ledger.baseline.routes].sort(), [...preMigrationRoutes].sort());
		const covered = new Set(ledger.blocks.map((row) => row.source_path));
		for (const route of preMigrationRoutes) {
			const slug = route.slice(1);
			assert.ok(
				covered.has(`${slug}.md`) || covered.has(`${slug}.mdx`),
				`${route} must be represented in the content ledger`,
			);
		}
	});
});

/**
 * #2847 Phase 1 asks for a no-content-loss ledger to exist as the migration's
 * guardrail. The inventory half is derived from the immutable launch baseline
 * and nothing else, which is a property a test can actually establish: rebuild
 * the whole file from that commit and compare. Nothing below opens the migrated
 * tree, so a working-tree dependency cannot hide in the artifact.
 */
describe("docs baseline inventory is reproducible from the baseline commit alone (#2847)", () => {
	const rev = baselineInventory.baseline_rev;

	function gitShow(path: string): string {
		try {
			return execFileSync("git", ["-C", repoRoot, "show", `${rev}:${path}`], {
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
			});
		} catch (error) {
			throw new Error(
				`cannot read ${path} at baseline ${rev}: ${(error as Error).message}. ` +
					"The baseline commit must be reachable; fetch it rather than skipping this check.",
			);
		}
	}

	function gitTree(pathspec?: string): string[] {
		const args = ["-C", repoRoot, "ls-tree", "-r", "--name-only", rev];
		if (pathspec) args.push(pathspec);
		return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
			.split("\n")
			.filter(Boolean);
	}

	interface BaselineBlockSpan {
		heading: string | null;
		level: number;
		anchor: string | null;
		lines: string[];
		start: number;
		end: number;
	}

	/** Heading-delimited spans, with block 0 as the pre-heading preamble. */
	function splitBlocks(text: string): BaselineBlockSpan[] {
		const lines = text.split("\n");
		const headings = headingsIn(text);
		const out: BaselineBlockSpan[] = [];
		const firstHeading = headings[0]?.line ?? lines.length;
		if (firstHeading > 0 && lines.slice(0, firstHeading).some((line) => line.trim())) {
			out.push({
				heading: null,
				level: 0,
				anchor: null,
				lines: lines.slice(0, firstHeading),
				start: 1,
				end: firstHeading,
			});
		}
		for (let index = 0; index < headings.length; index += 1) {
			const heading = headings[index];
			if (!heading) continue;
			const end = headings[index + 1]?.line ?? lines.length;
			out.push({
				heading: heading.text,
				level: heading.level,
				anchor: heading.anchor,
				lines: lines.slice(heading.line, end),
				start: heading.line + 1,
				end,
			});
		}
		return out;
	}

	function countElements(lines: readonly string[]): { fences: number; tables: number; callouts: number } {
		let fences = 0;
		let tables = 0;
		let callouts = 0;
		let fence: string | undefined;
		for (const line of lines) {
			const marker = /^\s*(```|~~~)/u.exec(line);
			if (marker) {
				if (fence) fence = undefined;
				else {
					fence = marker[1];
					fences += 1;
				}
				continue;
			}
			if (fence) continue;
			if (/^\s*\|[-: |]+\|\s*$/u.test(line)) tables += 1;
			if (line.startsWith(">") || /^\s*<(Note|Warning|Info|Tip|Card|Accordion)/u.test(line)) callouts += 1;
		}
		return { fences, tables, callouts };
	}

	function classOf(block: BaselineBlockSpan): string {
		if ((block.heading ?? "").trim().toLowerCase() === "table of contents") return "navigation";
		if (block.heading === null) return "substantive";
		return block.lines.slice(1).join("\n").trim() ? "substantive" : "navigation";
	}

	/** Ordered: the first pattern that matches wins, so narrow roles come first. */
	const referenceCategories: [RegExp, string][] = [
		[/prompt-guidance\.ts$|workflow-prompts\.ts$|system-prompt\.ts$/u, "prompt"],
		[/\/skills\/.*SKILL\.md$/u, "skill"],
		[/^packages\/coding-agent\/examples\//u, "example"],
		[/(^|\/)(test|tests)\//u, "test"],
		[/CHANGELOG\.md$/u, "changelog"],
		[/^scripts\//u, "script"],
		[/README\.md$/u, "readme"],
		[/^packages\/(coding-agent|workflows|subagents|intercom|mcp|web-access)\/src\//u, "source"],
	];

	function categoryOf(path: string): string {
		for (const [pattern, name] of referenceCategories) {
			if (pattern.test(path)) return name;
		}
		return "source";
	}

	test("the inventory regenerates byte for byte from the baseline commit", () => {
		const docsPrefix = "packages/coding-agent/docs/";
		const pages = gitTree(docsPrefix)
			.filter((path) => path.endsWith(".md") || path.endsWith(".mdx"))
			.map((path) => path.slice(docsPrefix.length))
			.sort();

		const routes: string[] = [];
		const anchors: { page: string; anchor: string; heading: string | null }[] = [];
		const links: { page: string; line: number; target: string }[] = [];
		const images: { page: string; line: number; src: string }[] = [];
		const blocks: BaselineBlock[] = [];

		for (const page of pages) {
			const text = gitShow(docsPrefix + page);
			const slug = page.replace(/\.mdx?$/u, "");
			routes.push(`/${slug}`);
			const lines = text.split("\n");
			for (let index = 0; index < lines.length; index += 1) {
				const line = lines[index] ?? "";
				for (const match of line.matchAll(/\[([^\]]*)\]\(([^)]+)\)/gu)) {
					const target = match[2] ?? "";
					if (!/^(https?:\/\/|mailto:)/u.test(target)) links.push({ page, line: index + 1, target });
				}
				for (const match of line.matchAll(/<img\s+[^>]*src="([^"]+)"/gu)) {
					images.push({ page, line: index + 1, src: match[1] ?? "" });
				}
			}
			let ordinal = 0;
			for (const block of splitBlocks(text)) {
				ordinal += 1;
				if (block.anchor) anchors.push({ page, anchor: block.anchor, heading: block.heading });
				const counts = countElements(block.lines);
				blocks.push({
					id: `${slug}::${String(ordinal).padStart(3, "0")}`,
					source_path: page,
					source_anchor: block.anchor,
					source_heading: block.heading,
					source_lines: [block.start, block.end],
					hash: blockDigest(block.lines),
					kind: block.heading === null ? "preamble" : `h${block.level}`,
					fences: counts.fences,
					tables: counts.tables,
					callouts: counts.callouts,
					class: classOf(block),
				});
			}
		}

		const baselineDocsJson = JSON.parse(gitShow(`${docsPrefix}docs.json`)) as DocsConfig;
		const publicRoutes: PublicRoute[] = pages.map((page) => ({
			id: `page:${page.replace(/\.mdx?$/u, "")}`,
			source: `/${page.replace(/\.mdx?$/u, "")}`,
			kind: "page",
			page,
		}));
		publicRoutes.push({ id: "canonical:/", source: "/", kind: "canonical", page: "index.md" });
		for (const redirect of baselineDocsJson.redirects ?? []) {
			publicRoutes.push({
				id: `redirect:${redirect.source}`,
				source: redirect.source,
				kind: "redirect",
				destination: redirect.destination,
			});
		}

		// One `git grep` instead of one `git show` per tracked file. Both reference
		// patterns require the literal `docs`, so a line without it cannot produce a
		// row; restricting to matching lines is equivalent and turns minutes of
		// child processes into a single call.
		const grepped = execFileSync(
			"git",
			[
				"-C",
				repoRoot,
				"grep",
				"-n",
				"--fixed-strings",
				"-e",
				"docs",
				rev,
				"--",
				"*.md",
				"*.mdx",
				"*.ts",
				"*.tsx",
				"*.mjs",
				"*.js",
				"*.json",
				"*.txt",
			],
			{ encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
		);
		const candidateLines = new Map<string, [number, string][]>();
		const grepLine = new RegExp(`^${rev}:(.*?):(\\d+):(.*)$`, "u");
		for (const row of grepped.split("\n")) {
			const parsed = grepLine.exec(row);
			if (!parsed) continue;
			const path = parsed[1] ?? "";
			const list = candidateLines.get(path) ?? [];
			list.push([Number(parsed[2]), parsed[3] ?? ""]);
			candidateLines.set(path, list);
		}
		assert.ok(candidateLines.size > 100, `the baseline grep returned candidates (${candidateLines.size} files)`);

		const references: BaselineReference[] = [];
		for (const path of gitTree()) {
			if (!/\.(md|mdx|ts|tsx|mjs|js|json|txt)$/u.test(path)) continue;
			if (/^(research|specs|node_modules)\//u.test(path)) continue;
			const candidates = candidateLines.get(path);
			if (!candidates) continue;
			const category = categoryOf(path);
			for (const [lineNumber, line] of [...candidates].sort((a, b) => a[0] - b[0])) {
				for (const match of line.matchAll(/(?<![\w/])((?:[\w./-]*\/)?docs\/[\w./-]+\.mdx?)(#[\w./&+_-]+)?/gu)) {
					const target = match[1] ?? "";
					if (!target.includes("coding-agent/docs/") && !/^(\.{0,2}\/)?docs\//u.test(target)) continue;
					references.push({
						id: `ref:${String(references.length).padStart(4, "0")}`,
						category,
						source_path: path,
						source_line: lineNumber,
						kind: target.includes("coding-agent/docs/") ? "package-doc-path" : "repository-path",
						source_target: target + (match[2] ?? ""),
					});
				}
				for (const match of line.matchAll(/https:\/\/docs\.bastani\.ai(\/[\w./-]*)(#[\w./&+_-]+)?/gu)) {
					references.push({
						id: `ref:${String(references.length).padStart(4, "0")}`,
						category,
						source_path: path,
						source_line: lineNumber,
						kind: "public-url",
						source_target: (match[1] ?? "") + (match[2] ?? ""),
					});
				}
			}
		}

		assert.equal(pages.length, 44, "the baseline shipped 44 Markdown/MDX pages");
		assert.ok(blocks.length > 1000, `blocks were regenerated, not skipped (${blocks.length})`);
		assert.ok(references.length > 500, `references were regenerated, not skipped (${references.length})`);
		assert.deepEqual(
			blocks,
			baselineInventory.blocks,
			"the committed blocks must regenerate from the baseline commit",
		);
		assert.deepEqual(
			references,
			baselineInventory.repository_references,
			"the committed reference inventory must regenerate from the baseline commit",
		);
		assert.deepEqual(
			{
				pages: pages.length,
				blocks: blocks.length,
				routes: [...routes].sort(),
				public_routes: publicRoutes,
				anchors,
				links,
				images,
			},
			baselineInventory.baseline,
			"the committed baseline inventory must regenerate from the baseline commit",
		);
	});

	test("the guardrail carries no field that the migrated tree could influence", () => {
		const baselineBlockFields = [
			"id",
			"source_path",
			"source_anchor",
			"source_heading",
			"source_lines",
			"hash",
			"kind",
			"fences",
			"tables",
			"callouts",
			"class",
		];
		for (const block of baselineInventory.blocks) {
			assert.deepEqual(
				Object.keys(block).sort(),
				[...baselineBlockFields].sort(),
				`${block.id} carries an unexpected field`,
			);
		}
		for (const reference of baselineInventory.repository_references) {
			assert.deepEqual(
				Object.keys(reference).sort(),
				["category", "id", "kind", "source_line", "source_path", "source_target"],
				`${reference.id} carries an unexpected field`,
			);
		}
		// The destination map holds the other half, keyed by the same ids, so the
		// two files stay joinable without the guardrail depending on the mapping.
		assert.deepEqual(
			Object.keys(destinationMap.blocks).sort(),
			baselineInventory.blocks.map((block) => block.id).sort(),
		);
		assert.deepEqual(
			Object.keys(destinationMap.repository_references).sort(),
			baselineInventory.repository_references.map((reference) => reference.id).sort(),
		);
		assert.equal(destinationMap.baseline_rev, baselineInventory.baseline_rev);
		assert.equal(destinationMap.hash_normalization, baselineInventory.hash_normalization);
	});

	test("the inventory discloses that it was reconstructed after the move", () => {
		// The disclosure is part of the artifact, not only the report. Softening it
		// would misrepresent how the guardrail came to exist.
		assert.match(baselineInventory.provenance, /reconstructed after the content moved/u);
		assert.match(baselineInventory.provenance, /not the same as having been authored before the move/u);
		const summary = readFileSync(join(repoRoot, "docs/migrations/2847-content-ledger.md"), "utf8");
		assert.match(summary, /reconstructed after the content moved/u);
		assert.doesNotMatch(
			summary,
			/generated from the immutable launch baseline recorded below and the migrated working tree/u,
			"the summary must no longer claim the guardrail was generated from the migrated tree",
		);
	});
});
