# Durable workflow resume performance probe

`scripts/benchmark-workflow-resume.ts` measures the headless `/workflow resume <exact-run-id>` command path with live DBOS/PostgreSQL on Windows. It is a maintainer probe, not a timing-gated test or a user workflow. There are no command or configuration changes for users.

## Reproduce safely

Use an **owned disposable loopback PostgreSQL instance**, never a user database. The probe requires an explicit per-process `DBOS_SYSTEM_DATABASE_URL`, an `atomic_resume_probe_*` database name, and an empty database for seeding. Its manifest binds the fixture directory to that database; it refuses to overwrite reports or resume a measured target twice. These guards do not establish ownership of an arbitrary server: the operator must provision the disposable instance.

Install dependencies/build as described in `AGENTS.md`. Example PowerShell setup, using the PostgreSQL binaries from an installed Atomic release (adjust `$bin` and choose an unused port):

```powershell
$bin = "C:/atomic/releases/versions/0.9.19-alpha.3/node_modules/@bastani/atomic-natives/postgres-runtime/bin"
$root = Join-Path $env:TEMP ("atomic-resume-probe-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory $root | Out-Null
$port = 56439
& "$bin/initdb.exe" -D "$root/pgdata" -U postgres -A trust --encoding=UTF8
& "$bin/pg_ctl.exe" -D "$root/pgdata" -l "$root/postgres.log" -o "-h 127.0.0.1 -p $port" -w start

# Run from the repository; pg is already a dependency. No psql is needed.
$env:DBOS_SYSTEM_DATABASE_URL = "postgresql://postgres@127.0.0.1:$port/postgres"
node --input-type=module -e 'import pg from "pg"; const c = new pg.Client({connectionString:process.env.DBOS_SYSTEM_DATABASE_URL}); await c.connect(); try { await c.query("CREATE DATABASE atomic_resume_probe_after_1"); } finally { await c.end(); }'
$env:DBOS_SYSTEM_DATABASE_URL = "postgresql://postgres@127.0.0.1:$port/atomic_resume_probe_after_1"
bun scripts/benchmark-workflow-resume.ts seed "$root/after-1" 500 3
bun scripts/benchmark-workflow-resume.ts resume "$root/after-1"

# After all measurements, stop only this owned instance.
& "$bin/pg_ctl.exe" -D "$root/pgdata" -m fast -w stop
Remove-Item Env:DBOS_SYSTEM_DATABASE_URL
```

Check every command's exit status. Retain artifacts until reviewed. For repeated samples, create a new empty database and fixture directory per batch, then run one seed process and one fresh resume process per batch. The seed arguments are side-effect count per target and target count. A before/after comparison needs separate fixtures with the same counts; never re-resume a completed before target as an after sample. To reproduce the old adapter, use baseline `7b2bf523216448ad4efb4b2e1c1e52fbcf0c2e12` with this probe, or temporarily restore its serial `retrieveWorkflow(wid).getResult()` read in a disposable checkout.

## Boundaries and assertions

Each target completes 500 checkpointed tool effects and a nested workflow effect, then pauses inside a final tool. Resume must preserve the exact run ID, replay stored values verbatim (including whitespace, duplicate array elements, empty strings, `false`, `0`, and `null`), and finish the interrupted tool. Assertions require:

- persisted and in-memory `paused` state during seed, then `completed` state after resume;
- every seeded checkpoint still present;
- only one continuation checkpoint, plus explicitly identified `run-timing:` and `stage-replay-meta:` metadata, added by replay;
- each original side effect exactly once and in order, and exactly one `continued` line, checked from separate files rather than checkpoint counts alone.

Timing starts immediately before the real command handler call. `acknowledgementMs` ends when that call returns after reporting dispatch, **not** at first visible terminal paint. `usefulWorkMs` ends when the interrupted tool writes its continuation effect. `completedMs` ends after the background job and backend flush settle. All three are cumulative from command start.

`acknowledgementQueries`, `usefulWorkQueries`, and `queries` count cumulative `pg.Client.query` calls at those boundaries, including DBOS background traffic in the interval. They are SQL-driver request counts, not server execution-plan statistics or a count of statements inside a multi-statement request.

`readyMs`/`readyQueries` separately measure backend configuration and launch. They are **excluded** from command timing. "Cold" means the first resume in a fresh process after backend launch; "warm" means later distinct targets in that same process, with an already populated backend. Neither means cold OS/PostgreSQL disk caches. Module loading, embedded-server provisioning, interactive picker rendering, and host/engine IPC are not measured. Warm samples also see fewer remaining paused targets, so compare like positions/workloads rather than treating the labels as pure cache effects.

## Windows measurements — 2026-09-10

Same machine, Windows x64 (after report OS `10.0.20348`), Bun 1.4.2, PostgreSQL 18.4. The reports' `runtime: v26.3.0` is Bun's `process.version`, not the Node executable; validation used Node v24.21.0. The installed DBOS SDK is 4.25.14. Per phase: three separate databases, each containing three 500-effect targets; three fresh resume processes yield **3 cold and 6 warm samples**.

Root cause: DBOS `listWorkflows({ loadOutput: true })` already deserializes successful outputs. The old adapter nevertheless fetched each checkpoint result again serially on every hydration/status-claim read. Reusing present listing outputs removes those redundant requests without removing hydration, classification, claim, or replay checks. Only an omitted (`undefined`) output retains the result-read fallback.

Medians (ranges in parentheses), milliseconds except SQL calls:

| Phase/state | n | Acknowledgement | Useful work | Completed | SQL calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before cold | 3 | 3060 (2776–3304) | 3200 (2933–3453) | 3221 (2957–3475) | 14274 (14271–14274) |
| After cold | 3 | 625 (595–659) | 754 (751–810) | 778 (773–834) | 96 (96–96) |
| Before warm | 6 | 1995 (1655–2324) | 2125 (1784–2464) | 2143 (1804–2484) | 9710 (8192–11231) |
| After warm | 6 | 432 (365–481) | 561 (486–619) | 583 (504–640) | 95 (87–97) |

After configuration/launch took 123, 362, and 205 ms, with 11 requests per process. After acknowledgement/useful-work request counts were 47/47 for each cold sample, 48/48 for each second target, and 38/38 for each third target. The earlier before probe recorded only total command SQL calls, so no before phase-specific query counts are available.

Artifacts (local verification paths, not shipped assets):

- Before: `C:/Users/coder/AppData/Local/Temp/atomic-resume-689e3462/before-{1,2,3}/` (`manifest.json`, `seed.json`, `resume.json`, and per-run `.effects`/`.useful` files). These inherited baseline reports predate source fingerprints and the strengthened manifest/checkpoint assertions; identities and effect files were re-audited, but their source revision is recorded by the original investigation rather than embedded in each JSON report.
- Fresh after: `C:/Users/coder/AppData/Local/Temp/atomic-resume-64313a0d/after-{1,2,3}/` (same files, plus source/manifest SHA-256, platform, database identity, checkpoint additions, and phase query counts in reports). Database names `atomic_resume_probe_64313a0d_after_{1,2,3}`, isolated port 62774. Cluster ownership was verified by `SHOW data_directory`, and the cluster was stopped after measuring.
- The after root also holds `run-after.mjs`, `run-after.log`, per-process seed/resume logs, `cluster.json`, `postgres.log`, `stop.log`, and `audit-artifacts.mjs`/`audit.json`/`audit.log`. The audit checked all 18 identities/effect files and after source fingerprints against the final adapter/probe/lockfile. Reports record pre-commit HEAD plus hashes because the fix was uncommitted during measurement.

Exact samples (`cold` is first in each batch; warm rows retain invocation order):

| Fixture/sample | Exact run ID | Ack / useful / completed (ms) | SQL calls |
| --- | --- | --- | --- |
| before-1/cold | `28fa5573-6f5f-458d-8e33-f335b72d035c` | 3303.9 / 3452.6 / 3474.8 | 14274 |
| before-1/warm | `38247072-2084-4a10-8430-f6e57f50aae1` | 2323.9 / 2464.1 / 2484.3 | 11228 |
| before-1/warm | `9d54a2c4-1b93-48b5-be09-a2adf12def06` | 1795.8 / 1921.6 / 1941.9 | 8192 |
| before-2/cold | `f78a8c35-d519-4bea-bf20-58f72bbc4e9a` | 3060.0 / 3200.3 / 3221.3 | 14274 |
| before-2/warm | `d27c415e-803e-4442-a575-3cc0f9de08a9` | 2193.3 / 2327.5 / 2344.2 | 11228 |
| before-2/warm | `da1af6c2-21ea-4a1e-8f9d-2e299d1963e1` | 1686.7 / 1802.5 / 1819.5 | 8192 |
| before-3/cold | `e6a9c45a-7297-4788-9210-e505abce3be9` | 2776.2 / 2933.1 / 2957.0 | 14271 |
| before-3/warm | `9cfb406d-2729-499c-af24-3cba858a2321` | 2213.0 / 2346.2 / 2379.2 | 11231 |
| before-3/warm | `7dc22f8f-acc3-4755-ba76-4562da697be5` | 1654.9 / 1784.2 / 1804.0 | 8192 |
| after-1/cold | `bbc71b13-69f8-46c3-9217-fa1b90ef465c` | 658.7 / 810.3 / 834.4 | 96 |
| after-1/warm | `b6005a29-4ffb-47f1-88cb-e6b3b1f1a247` | 481.2 / 619.1 / 640.5 | 97 |
| after-1/warm | `94d797f9-883b-4e97-86d9-7291865fa105` | 405.9 / 526.4 / 546.7 | 93 |
| after-2/cold | `6a844713-bf38-410e-9f89-b0e145e796ca` | 595.3 / 750.9 / 777.6 | 96 |
| after-2/warm | `c90daa10-919d-428f-bd73-8146b6e6f104` | 466.9 / 600.9 / 621.1 | 97 |
| after-2/warm | `4bed5b14-89e3-4e95-958d-bafee1e3f1c2` | 384.9 / 506.5 / 524.6 | 87 |
| after-3/cold | `38dd54d4-ff20-46d4-9121-35a11cec015b` | 624.6 / 754.4 / 773.3 | 96 |
| after-3/warm | `a171871a-f39d-420a-927b-7e7b091beb62` | 458.1 / 594.6 / 619.7 | 97 |
| after-3/warm | `fdb963fc-22da-41f3-91a8-fade3810928b` | 365.0 / 486.1 / 503.9 | 87 |

These are local diagnostic measurements, not a latency guarantee. Before/after runs were not interleaved and did not use OS-cache resets. Deterministic unit regressions guard the eliminated result reads and value preservation rather than wall-clock thresholds. Existing durable tests cover hydration, lifecycle, cancellation, concurrent resume claims, DAG edge validation, and cycle rejection; this live probe establishes pause/resume and nested side-effect replay but is not a live multi-process contention or adversarial-DAG test.
