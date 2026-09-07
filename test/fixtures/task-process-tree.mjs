import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// RFC #2884: real identities, not mock PIDs, with cooperative descendant reaping.
function identity(pid) {
 let birth;
 if (process.platform === "linux") {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  birth = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
 }
 return { pid, ...(birth === undefined ? {} : { birth }) };
}
if (process.argv.includes("--grandchild")) {
 console.log(`GRANDCHILD ${process.pid}`);
 setInterval(() => console.log(`grandchild output ${Date.now()}`), 25);
} else {
 const child = spawn(process.execPath, [import.meta.filename, "--grandchild"], { stdio: "inherit" });
 child.once("spawn", () => {
  const identities = { parent: identity(process.pid), grandchild: identity(child.pid) };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(identities));
  console.log(`IDENTITIES ${JSON.stringify(identities)}`);
  if (process.argv.includes("--shell-first")) process.exit(0);
 });
 const timer = setInterval(() => console.log(`parent output ${Date.now()}`), 25);
 let closing = false;
 process.on("SIGTERM", () => {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  child.kill("SIGTERM");
  if (child.exitCode !== null || child.signalCode !== null) process.exit(0);
  child.once("exit", () => process.exit(0));
 });
}
