import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [identities, mode = "cancel"] = process.argv.slice(2);
// Even a failed test cannot leave these fixtures alive indefinitely.
setTimeout(() => process.exit(92), 12000).unref();
if (mode === "descendant") {
	writeFileSync(`${identities}.ready`, String(process.pid));
	setInterval(() => process.stdout.write("descendant-alive\r\n"), 20);
} else {
	const child = spawn(process.execPath, [fileURLToPath(import.meta.url), identities, "descendant"], { stdio: "inherit" });
	const ready = setInterval(() => {
		if (!existsSync(`${identities}.ready`)) return;
		clearInterval(ready);
		writeFileSync(identities, JSON.stringify({ leader: process.pid, descendant: child.pid }));
		process.stdout.write("TREE_READY\r\n", () => {
			if (mode === "natural") process.exit(0);
		});
	}, 5);
	setInterval(() => process.stdout.write("leader-alive\r\n"), 20);
}
