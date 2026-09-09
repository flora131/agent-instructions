import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

interface NavigationGroup {
	group: string;
	pages: (string | NavigationGroup)[];
}

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), "../docs");

test("Mintlify navigation reaches every documentation page without duplicate or missing routes (#9380)", () => {
	const config = JSON.parse(readFileSync(join(docsRoot, "docs.json"), "utf8")) as {
		navigation: { groups: NavigationGroup[] };
	};
	const roots: string[] = [];
	const visit = (group: NavigationGroup): void => {
		assert.equal(typeof group.group, "string");
		assert.ok(group.group.trim());
		assert.ok(Array.isArray(group.pages) && group.pages.length > 0);
		for (const page of group.pages) {
			if (typeof page !== "string") visit(page);
			else {
				assert.equal(page, posix.normalize(page));
				assert.ok(!/^(?:\/|\.\.)|[\\?#:]|\.mdx?$/.test(page), page);
				roots.push(page);
			}
		}
	};
	for (const group of config.navigation.groups) visit(group);
	assert.equal(new Set(roots).size, roots.length, "duplicate navigation routes");
	const pages = readdirSync(docsRoot, { recursive: true })
		.filter((file) => /\.mdx?$/.test(file))
		.map((file) => file.replaceAll("\\", "/").replace(/\.mdx?$/, ""));
	assert.equal(new Set(pages).size, pages.length, "duplicate public slugs");
	// Atomic intentionally lists every page directly, rather than relying on linked-only reachability.
	assert.deepEqual(roots.sort(), pages.sort());
	assert.ok(roots.includes("environment-variables"));
});
