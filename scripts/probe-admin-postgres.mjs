import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const binding = require(join(import.meta.dirname, "..", "packages", "natives", "native", "index.js"));
const pg = require("pg");

const binDir = process.env.ATOMIC_EMBEDDED_POSTGRES_BIN_DIR ?? join(rootPackageDir(), "native", "bin");

function rootPackageDir() {
	const entry = require.resolve("@embedded-postgres/windows-x64");
	let current = dirname(entry);
	for (let depth = 0; depth < 5 && current.length > 3; depth += 1) {
		if (existsSync(join(current, "native", "bin", "postgres.exe"))) return current;
		current = dirname(current);
	}
	throw new Error(`could not locate embedded Postgres bin from ${entry}`);
}
const root = mkdtempSync(join(tmpdir(), `atomic-pg-admin-c46d291e-`));
const dataDir = join(root, "data");
const logFile = join(root, "postgres.log");
writeFileSync(join(root, "pw"), "atomic\n");
console.log("binDir", binDir);
console.log("cluster", root);
try {
	const initdb = spawn(join(binDir, "initdb.exe"), [
		"-D",
		dataDir,
		"-U",
		"postgres",
		"-A",
		"password",
		`--pwfile=${join(root, "pw")}`,
		"-E",
		"UTF8",
		"--no-locale",
	]);
	const initStatus = await new Promise((resolve) => {
		initdb.stdout.resume();
		initdb.stderr.on("data", (d) => process.stderr.write(d));
		initdb.on("error", () => resolve(-1));
		initdb.on("close", resolve);
	});
	if (initStatus !== 0) throw new Error(`initdb failed ${initStatus}`);

	const start = async (port) => {
		const lease = binding.spawnRetainedPostgres({
			executable: join(binDir, "postgres.exe"),
			args: ["-D", dataDir, "-p", String(port), "-c", "listen_addresses=127.0.0.1"],
			cwd: dataDir,
			logFile,
			env: { PG_RESTRICT_EXEC: "1" },
		});
		console.log("lease pid", lease.pid);
		const deadline = Date.now() + 60_000;
		let lastLog = "";
		while (Date.now() < deadline) {
			lastLog = readFileSync(logFile, "utf8");
			const reachable = await new Promise((resolve) => {
				const socket = require("node:net").connect(port, "127.0.0.1");
				socket.once("connect", () => {
					socket.destroy();
					resolve(true);
				});
				socket.once("error", () => {
					socket.destroy();
					resolve(false);
				});
			});
			if (reachable) return lease;
			// The native wait(0) rejects with its timeout while the exact child
			// is still live; a resolution means the retained process exited.
			const observed = await lease.wait(0).then(
				(result) => result,
				() => undefined,
			);
			if (observed?.exited) throw new Error(`retained postmaster exited early:\n${lastLog}`);
			if (lastLog.includes("FATAL")) throw new Error(`postmaster startup failure:\n${lastLog}`);
			await new Promise((r) => setTimeout(r, 250));
		}
		throw new Error(`never ready:\n${lastLog}`);
	};

	const lease = await start(6439);
	const client = new pg.Client({
		host: "127.0.0.1",
		port: 6439,
		user: "postgres",
		password: "atomic",
		database: "postgres",
	});
	await client.connect();
	await client.query("CREATE TABLE atomic_admin_probe(marker text)");
	await client.query("INSERT INTO atomic_admin_probe VALUES ('persisted-c46d291e')");
	await client.end();

	const shutdown = await lease.interruptAndWait(60_000);
	console.log("shutdown", JSON.stringify(shutdown));
	lease.release();
	if (!shutdown.exited) throw new Error("retained postmaster did not exit");

	const restarted = await start(6439);
	const client2 = new pg.Client({
		host: "127.0.0.1",
		port: 6439,
		user: "postgres",
		password: "atomic",
		database: "postgres",
	});
	await client2.connect();
	const selected = await client2.query("SELECT marker FROM atomic_admin_probe");
	console.log("rows after restart", JSON.stringify(selected.rows));
	if (selected.rows[0]?.marker !== "persisted-c46d291e") throw new Error("persistence lost");
	await client2.end();
	const shutdown2 = await restarted.interruptAndWait(60_000);
	restarted.release();
	console.log("shutdown2", JSON.stringify(shutdown2));
	if (!shutdown2.exited) throw new Error("second retained postmaster did not exit");
	console.log("PASS");
} catch (error) {
	console.error(error);
	try {
		console.error("--- postgres.log ---");
		console.error(readFileSync(logFile, "utf8"));
	} catch {}
	process.exitCode = 1;
} finally {
	rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
