import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";
import { repositoryRoot } from "../../vitest.base.js";
import {
	bunExecutable,
	makeDirectorySync,
	makeTempDirectory,
	removeTempDirectory,
	spawnSyncCollect,
	writeTextSync,
} from "../helpers/runtime.js";

// Structural: each scenario starts a real configured Vitest suite and Node/Bun descendants.
const REAL_VITEST_ISOLATION_TIMEOUT_MS = 120_000;
const REAL_VITEST_PROCESS_TIMEOUT_MS = 90_000;
const DESCENDANT_PROCESS_TIMEOUT_MS = 10_000;

for (const [label, root] of [
	["repository projects", repositoryRoot],
	["coding-agent projects", join(repositoryRoot, "packages/coding-agent")],
]) {
	test(
		`${label} isolate inherited Herdr pane credentials before collection and subprocess creation`,
		() => {
			const directory = makeTempDirectory("atomic-herdr-test-isolation-");
			const configPath = join(directory, "vitest.config.mjs");
			const fixturePath = join(directory, "isolation.test.ts");
			const configUrl = pathToFileURL(join(root, "vitest.config.ts")).href;
			const vitestUrl = pathToFileURL(join(repositoryRoot, "node_modules/vitest/dist/index.js")).href;
			const environmentUrl = pathToFileURL(
				join(repositoryRoot, "packages/coding-agent/src/extensions/herdr/environment.ts"),
			).href;
			const snapshot = `({ keys: Object.keys(process.env).filter(key => key.startsWith("HERDR_")).sort(), eligible: captureHerdrEnvironment(process.env) !== undefined })`;
			const childSource = `import { captureHerdrEnvironment } from ${JSON.stringify(environmentUrl)}; console.log(JSON.stringify(${snapshot}));`;
			try {
				// Retain the real projects' setup and runner settings; only substitute the collected file.
				writeTextSync(
					configPath,
					`import config from ${JSON.stringify(configUrl)};
export default {
  ...config,
  test: {
    ...config.test,
    projects: config.test.projects.map(project => ({
      ...project,
      test: {...project.test, root: ${JSON.stringify(root)}, include: [${JSON.stringify(fixturePath)}]},
    })),
  },
};\n`,
				);
				writeTextSync(
					fixturePath,
					`import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from ${JSON.stringify(vitestUrl)};
import { captureHerdrEnvironment } from ${JSON.stringify(environmentUrl)};
const atCollection = ${snapshot};
test("worker cannot activate inherited pane reporting at collection", () => {
  assert.deepEqual(atCollection, {keys: [], eligible: false});
});
for (const runtime of ${JSON.stringify([process.execPath, bunExecutable()])}) {
  test(runtime + " descendant cannot activate inherited pane reporting", () => {
    const child = spawnSync(runtime, ["--input-type=module", "-e", ${JSON.stringify(childSource)}], {encoding: "utf8", timeout: ${DESCENDANT_PROCESS_TIMEOUT_MS}});
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {keys: [], eligible: false});
  });
}\n`,
				);
				const artifacts = join(directory, "artifacts");
				makeDirectorySync(artifacts);
				const result = spawnSyncCollect(
					[
						process.execPath,
						join(repositoryRoot, "node_modules/vitest/vitest.mjs"),
						"--run",
						"--config",
						configPath,
					],
					{
						cwd: root,
						timeout: REAL_VITEST_PROCESS_TIMEOUT_MS,
						env: {
							...process.env,
							ATOMIC_WORKFLOW_ARTIFACT_DIR: artifacts,
							HERDR_ENV: "1",
							// Never point a regression, including its RED run, at a real binary or pane.
							HERDR_BIN_PATH: join(directory, "nonexistent-herdr"),
							HERDR_PANE_ID: "test-pane",
							HERDR_SOCKET_PATH: join(directory, "nonexistent.sock"),
							HERDR_TAB_ID: "test-tab",
							HERDR_WORKSPACE_ID: "test-workspace",
						},
					},
				);
				assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr.toString());
			} finally {
				removeTempDirectory(directory);
			}
		},
		REAL_VITEST_ISOLATION_TIMEOUT_MS,
	);
}
