import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHashlineSnapshotStore } from "../src/core/tools/hashline.ts";
import { createWriteTool, createWriteToolDefinition } from "../src/core/tools/write.ts";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "write-local-selector-observation-"));
	tempDirs.push(dir);
	return dir;
}

for (const factory of [createWriteToolDefinition, createWriteTool]) {
	describe(factory.name, () => {
		for (const explicitStore of [false, true]) {
			for (const path of ["a.txt", "local://a.txt"]) {
				it(`retains its own writes through ${path} with an ${explicitStore ? "explicit" : "implicit"} store`, async () => {
					const cwd = await tempDir();
					const tool = explicitStore
						? factory(cwd, { hashlineStore: createHashlineSnapshotStore() })
						: factory(cwd);

					await tool.execute("create", { path, content: "first\n" }, undefined, undefined, {} as never);
					await tool.execute("overwrite", { path, content: "second\n" }, undefined, undefined, {} as never);

					expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("second\n");
				});
			}
		}

		it("does not share implicit observations with another standalone tool or learn from a refusal", async () => {
			const cwd = await tempDir();
			const owner = factory(cwd);
			const stranger = factory(cwd);
			const path = "local://a.txt";
			await owner.execute("create", { path, content: "owner\n" }, undefined, undefined, {} as never);

			for (const id of ["unseen", "retry"]) {
				await expect(
					stranger.execute(id, { path, content: "stranger\n" }, undefined, undefined, {} as never),
				).rejects.toMatchObject({
					message: expect.stringContaining("FILE_MUTATION_CONFLICT:no_prior_observation"),
					reason: "no_prior_observation",
				});
				expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("owner\n");
			}
		});

		it("rejects external changes after its own local-selector write without learning from a refusal", async () => {
			const cwd = await tempDir();
			const tool = factory(cwd);
			const path = "local://a.txt";
			await tool.execute("create", { path, content: "first\n" }, undefined, undefined, {} as never);
			await writeFile(join(cwd, "a.txt"), "external\n");

			for (const id of ["stale", "retry"]) {
				await expect(
					tool.execute(id, { path, content: "overwrite\n" }, undefined, undefined, {} as never),
				).rejects.toMatchObject({
					message: expect.stringContaining("FILE_MUTATION_CONFLICT:changed_since_observation"),
					reason: "changed_since_observation",
					evidence: { line: 1, assumed: "first", found: "external" },
				});
				expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("external\n");
			}
		});
	});
}
