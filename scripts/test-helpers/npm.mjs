import { dirname, join } from "node:path";

// Same shell-less npm invocation as test/helpers/runtime.ts; script tests run plain Node.
export function npmSpawnPrefix() {
	return process.platform === "win32"
		? [process.execPath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
		: ["npm"];
}
