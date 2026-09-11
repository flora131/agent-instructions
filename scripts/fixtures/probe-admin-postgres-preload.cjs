// External process, socket and SQL substitutes. The CLI itself runs unchanged.
const fs = require("node:fs");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const cp = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const scenario = process.env.ATOMIC_PROBE_SCENARIO;
const events = [];
let root;
let current;
let marker;
let sequence = 0;
const readFile = fs.readFileSync;
const remove = fs.rmSync;
let readinessFailed = false;
fs.readFileSync = function (file, ...args) {
	if (scenario === "readiness-failure" && String(file).endsWith("postgres.log") && !readinessFailed) {
		readinessFailed = true;
		throw Error("INJECTED_READINESS_FAILURE");
	}
	return readFile.call(this, file, ...args);
};
fs.rmSync = function (file, ...args) {
	if (file === root) events.push("remove-cluster");
	return remove.call(this, file, ...args);
};
const binding = {
	spawnRetainedPostgres(options) {
		root = path.dirname(options.cwd);
		current = options;
		const pid = 9000 + ++sequence;
		events.push(`spawn:${pid}`);
		fs.mkdirSync(options.cwd, { recursive: true });
		fs.writeFileSync(options.logFile, "postmaster diagnostic\n");
		fs.writeFileSync(path.join(options.cwd, "postmaster.pid"), `${pid}\n${options.cwd}\n1700000000\n`);
		return {
			pid,
			async wait() {
				events.push(`wait:${pid}`);
				if (scenario === "bind-failure") return { exited: true, signaled: false };
				throw Error("Timed out waiting for the retained Postgres process to exit");
			},
			async interruptAndWait() {
				events.push(`interrupt:${pid}`);
				if (scenario === "failed-shutdown") throw Error("INJECTED_SHUTDOWN_FAILURE");
				return { exited: true, signaled: scenario !== "bind-failure" && scenario !== "unsignaled" };
			},
			release() { events.push(`release:${pid}`); },
		};
	},
};
class Client {
	async connect() {
		events.push("connect");
		if (scenario === "sql-failure" || scenario === "failed-shutdown") throw Error("INJECTED_SQL_FAILURE");
	}
	async query(sql, values) {
		events.push(`query:${sql}`);
		if (sql.includes("data_directory")) {
			return { rows: [{ data_directory: scenario === "competing-identity" ? path.dirname(current.cwd) : current.cwd, start_time: "1700000000" }] };
		}
		if (sql.startsWith("INSERT")) marker = values?.[0] ?? "persisted-c46d291e";
		return { rows: [{ marker }] };
	}
	async end() { events.push("client-end"); }
}
const load = Module._load;
Module._load = function (id, ...args) {
	if (String(id).replaceAll("\\", "/").endsWith("/packages/natives/native/index.js")) return binding;
	if (id === "pg") return { Client };
	return load.call(this, id, ...args);
};
cp.spawn = () => {
	const child = new EventEmitter();
	child.stdout = { resume() {} };
	child.stderr = new EventEmitter();
	queueMicrotask(() => child.emit("close", 0));
	return child;
};
net.connect = () => {
	const socket = new EventEmitter();
	socket.destroy = () => {};
	socket.setTimeout = () => {};
	queueMicrotask(() => socket.emit("connect"));
	return socket;
};
Module.syncBuiltinESMExports();
process.on("exit", () => fs.writeFileSync(process.env.ATOMIC_PROBE_OBSERVATION,
	JSON.stringify({ events, root, exists: root && fs.existsSync(root), exitCode: process.exitCode ?? 0 })));
