import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
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
const root = mkdtempSync(join(tmpdir(), "atomic-pg-admin-"));
const dataDir = join(root, "data");
const logFile = join(root, "postgres.log");
writeFileSync(join(root, "pw"), "atomic\n");
console.log("binDir", binDir);
console.log("cluster", root);
const owned = new Set();
const clients = new Set();
async function stop(lease) {
	const result = await lease.interruptAndWait(60_000);
	if (!result.exited) throw new Error(`retained postmaster ${lease.pid} did not exit`);
	lease.release();
	owned.delete(lease);
	return result;
}
async function assertRunning(lease) {
	try {
		await lease.wait(0);
	} catch (error) {
		if (error.message === "Timed out waiting for the retained Postgres process to exit") return;
		throw error;
	}
	throw new Error(`retained postmaster exited early:\n${readFileSync(logFile, "utf8")}`);
}

async function verifyIdentity(client, lease) {
	await assertRunning(lease);
	const identity = await client.query(
		"SELECT current_setting('data_directory') AS data_directory, floor(extract(epoch FROM pg_postmaster_start_time()))::text AS start_time",
	);
	const postmaster = readFileSync(join(dataDir, "postmaster.pid"), "utf8").split(/\r?\n/);
	const server = identity.rows[0];
	// The pidfile is evidence only, never a source of ownership or a kill target.
	if (
		Number(postmaster[0]) !== lease.pid ||
		!server ||
		realpathSync(server.data_directory) !== realpathSync(dataDir) ||
		server.start_time !== postmaster[2]
	) {
		throw new Error("listener is not the retained postmaster for this cluster");
	}
	await assertRunning(lease);
	console.log("verified owned postmaster", JSON.stringify({ pid: lease.pid, ...server }));
}

async function freshPort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = server.address().port;
	await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	return port;
}

try {
	const port = await freshPort();
	const marker = `persisted-${randomUUID()} quote' slash\\ trailing `;
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
		owned.add(lease);
		console.log("lease pid", lease.pid);
		const deadline = Date.now() + 60_000;
		let lastLog = "";
		while (Date.now() < deadline) {
			lastLog = readFileSync(logFile, "utf8");
			await assertRunning(lease);
			const reachable = await new Promise((resolve) => {
				const socket = connect(port, "127.0.0.1");
				socket.once("connect", () => {
					socket.destroy();
					resolve(true);
				});
				socket.once("error", () => {
					socket.destroy();
					resolve(false);
				});
			});
			if (reachable) {
				await assertRunning(lease);
				return lease;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error(`never ready:\n${lastLog}`);
	};

	const lease = await start(port);
	const client = new pg.Client({
		host: "127.0.0.1",
		port,
		user: "postgres",
		password: "atomic",
		database: "postgres",
		connectionTimeoutMillis: 3000,
	});
	clients.add(client);
	await client.connect();
	await verifyIdentity(client, lease);
	await client.query("CREATE TABLE atomic_admin_probe(marker text)");
	await client.query("INSERT INTO atomic_admin_probe VALUES ($1)", [marker]);
	await client.end();
	clients.delete(client);

	const shutdown = await stop(lease);
	console.log("shutdown", JSON.stringify(shutdown));
	if (!shutdown.signaled) throw new Error("postmaster exited before owned shutdown");

	const restarted = await start(port);
	const client2 = new pg.Client({
		host: "127.0.0.1",
		port,
		user: "postgres",
		password: "atomic",
		database: "postgres",
	});
	clients.add(client2);
	await client2.connect();
	await verifyIdentity(client2, restarted);
	const selected = await client2.query("SELECT marker FROM atomic_admin_probe");
	console.log("rows after restart", JSON.stringify(selected.rows));
	if (selected.rows[0]?.marker !== marker) throw new Error("persistence lost");
	await client2.end();
	clients.delete(client2);
	const shutdown2 = await stop(restarted);
	console.log("shutdown2", JSON.stringify(shutdown2));
	if (!shutdown2.signaled) throw new Error("postmaster exited before second owned shutdown");
	console.log("PASS");
} catch (error) {
	console.error(error);
	try {
		console.error("--- postgres.log ---");
		console.error(readFileSync(logFile, "utf8"));
	} catch {}
	process.exitCode = 1;
} finally {
	for (const client of clients) {
		try {
			await client.end();
		} catch (error) {
			console.error(error);
			process.exitCode = 1;
		}
	}
	for (const lease of owned) {
		try {
			await stop(lease);
		} catch (error) {
			console.error(error);
			process.exitCode = 1;
		}
	}
	if (owned.size === 0) {
		rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	} else {
		console.error(
			`Preserving cluster ${root}: shutdown unconfirmed for retained PIDs ${[...owned].map((lease) => lease.pid).join(", ")}`,
		);
	}
}
