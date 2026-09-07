# Task experience design receipt and acceptance matrix

## Frozen goal

Produce an evidence-backed, design-only In Review RFC and terminal mockups for Atomic's unified owner-bound foreground/background subagent and task experience, including continuous Intercom-triggered live UI.

Contract: [canonical unchanged brief](2026-09-05-agent-task-experience-brief.md), plus the goal ledger supplied to this run. The rows below freeze its clauses before RFC drafting. They describe design deliverables, not implemented behavior. No new runtime acceptance requirement is implied by an illustrative type or test fixture.

Artifact keys: R = [RFC](../specs/2026-09-05-agent-task-experience.md); M = [mockups](2026-09-05-agent-task-mockups.md); N = this receipt; RT = [runtime research](2026-09-05-agent-task-runtime.md); I = [Intercom research](2026-09-05-agent-task-intercom.md); U = [UI research](2026-09-05-agent-task-ui-research.md). The matrix was written before the RFC and mockups. All listed artifacts now exist; locators describe the completed draft, not implemented runtime behavior.

## Acceptance matrix

| ID | Literal clause or required artifact | Design evidence / check |
|---|---|---|
| A01 | Read full agreed brief first; preserve unchanged | Writer read; SHA256 check below |
| A02 | Only designated checkout, existing feat/agent-task-experience | pwd/branch/HEAD check below |
| A03 | Design only; no runtime implementation | Changed-path inventory below |
| A04 | No shipped docs claiming feature exists | Changed-path inventory; R §8 future docs |
| A05 | No commit, push, PR or merge | HEAD unchanged; no staging; no external writes |
| A06 | Human approval before implementation, not draft completion gate | R metadata, §3, §9 |
| A07 | create-spec RFC at exact specs/2026-09-05-agent-task-experience.md, In Review | R frontmatter and numbered §§1–9 |
| A08 | Source-backed research deliverable | RT/I/U, eight focused DeepWiki queries |
| A09 | Terminal mockup deliverable | M scenarios M1–M14; 22 frames; cell checks |
| A10 | Future independently verifiable implementation/test plan | R §8 slices and gates |
| A11 | Rust lifecycle, bounded waits, cancellation, process supervisor | R §§4,5.1–5.4 |
| A12 | TS model sessions/tools/UI, not full Rust runtime | R §§4.1,5.2,6 |
| A13 | Compare N-API with suitable supervision boundaries | R §6 |
| A14 | Breaking changes allowed, frontmatter | R frontmatter |
| A15 | Backwards Compatibility section and migration | R Backwards Compatibility |
| A16 | Preserve unrelated workflow guarantees | R §§5.4,8, compatibility |
| A17 | Always stop unfinished work with owning chat/session | R §§5.1,5.4,7 |
| A18 | Always stop unfinished work with owning workflow stage | R §§5.1,5.4,7 |
| A19 | May outlive launching turn, not owner | R state table and M3/M7 |
| A20 | Pane switch is not owner closure | R §5.4; M8 |
| A21 | No ownership transfer | R capability contracts |
| A22 | No persistence daemon or work intended to survive app exit | R §§3,7; abrupt-exit limitation explicit |
| A23 | Intercom-triggered async equal to explicit/timed yielding | R wait union, M2–M7 |
| A24 | Actual detach/runtime ownership trace | I inbound/continuation/ownership sections |
| A25 | Result delivery trace | I terminal result section |
| A26 | Render/update subscriptions trace | I rendering; U A4–A7 |
| A27 | Transcript/session storage trace | I message queue source, R §5.3 |
| A28 | Workflow attached-chat projection trace | I rendering, U A5–A9 |
| A29 | One task identity across transition | R §5.3; M2/M3/M4 same t17 |
| A30 | One continuous visible representation across transition | R §5.4; M2/M3/M4 stable row |
| A31 | Live status and expandable activity before completion | M3/M7; R shared projection |
| A32 | Terminal settles existing UI, no duplicate result | R delivery protocol; M4/M8 |
| A33 | No empty newline block or notification-only substitute | R visibility before layout; M4 |
| A34 | Preserve genuine messages | I retry facts; M3/M4 |
| A35 | Preserve authoritative receipts | R §5.4 receipt separation |
| A36 | Preserve retry identities | R §5.4, §8 real broker regressions |
| A37 | Preserve necessary model-context completion delivery | R §5.3 completion envelope/outbox |
| A38 | Relevant research/ rather than specs/ as research | RT historical August note, I July note, U local evidence |
| A39 | Impeccable shape/operate; PRODUCT/DESIGN/themes/renderers/keybindings | U A1–A10; R §2.1, M visual contract |
| A40 | No comparison branding in RFC/mockups | Text scan below; provenance remains RT/U/N |
| A41 | No proprietary code copying; license before reuse | U provenance; no reuse proposed |
| A42 | Discover DeepWiki MCP; multiple focused questions per named reference | Parent mcp search; four queries each RT/U/N |
| A43 | Persist question, answer link, paths/symbols, snapshot, confidence, contradictions | RT/U query registers + N Q4 exact text |
| A44 | Treat synthesis as leads, cross-check critical claims | RT corrections, U U1–U6 |
| A45 | Mark unavailable evidence | RT unknown numeric defaults/OS internals, U license/index limits |
| A46 | Do not assert upstream auto-backgrounding as fact | RT source corrections; R auto-yield explicitly proposed |
| A47 | Follow up composition/event reduction/races/virtualization/keys/spacing/source availability | U Q1–Q4 and verified mechanisms |
| A48 | Distinct bounded runtime/Intercom/UI research ownership | RT/I/U; parent run 42da76b4 |
| A49 | Inspect #2859 and latest #2840 policy | I maintainer decisions |
| A50 | Preserve #2607 terminal monotonicity and fresh parent handoff | I parent questions; R state table |
| A51 | No stopped-child resume; live foregrounding not named resume | R door names and refusal; M8 |
| A52 | Inspect #2824/#2700/#2565 dependencies, no whole-issue scope growth | U dependency status; R §9 |
| A53 | Preserve >4-run complete projection while bounding viewport | R §5.4, §8 S4; M11 |
| A54 | Configurable namespaced bindings; Ctrl+D/U untouched | R §5.4; M keyboard table |
| A55 | Adjacent HIL/notifications only where material | R §9 dependency boundary; no new broad issue work |
| A56 | Typed public doors, failures and refusals | R §5.1 audit |
| A57 | Typed Rust/TS events, stable IDs and owner IDs | R §§5.2–5.3 |
| A58 | Native lifetime and thread safety | R §5.2, §7 |
| A59 | Cancellation propagation | R §5.4, §7 |
| A60 | Ordered updates and UI reconnect reconciliation | R §5.3 cursor protocol; M8 |
| A61 | Terminal-state monotonicity | R state table, §8 S1/S3 |
| A62 | Bounded output/backpressure | R §5.3; M10/M12 |
| A63 | Separate execution/wait/focus/expansion | R §5.3 HostObservation and §5.4 D1 W1/W2 trace |
| A64 | Yield not completion; background not orphaned | R §5.4; M6/M7 DAG caption |
| A65 | DAG and durable ctx.tool must not settle on yielded handle | R §5.4 durable adapter, §8 S3 |
| A66 | JS async does not block event loop by itself; Rust not magic | R §5.2, §7 failure limits |
| A67 | Single/parallel and nested agents | R admission policy; M1/M9; no deeper child delegation authorization |
| A68 | Explicit foreground/background | M1/M5/M6/M7 |
| A69 | Automatic wait yielding | R config, M5/M7 |
| A70 | Commands/PTY stdin | R input capability; M10 |
| A71 | Manual foregrounding of LIVE task | R foregroundTask; M8 |
| A72 | Owner closure | R closeOwner; M8/M9 |
| A73 | Cancel/completion races | R transition/race table; §8 S1/S2/S3 |
| A74 | Transport disconnect/retry | R event gap and Intercom protocols |
| A75 | HIL, failed, cancelled states | R attention/result unions; M9/M10 |
| A76 | Reattach to still-live owner | R snapshot subscription; M8 |
| A77 | macOS/Linux/Windows shutdown and process cleanup | R §7, §8 native-host gates |
| A78 | Main and workflow collapsed + Ctrl+O expanded parity | M1–M8 shared composition; R §4.1 |
| A79 | Tool name/current action, readable hierarchy | M all running rows |
| A80 | Elapsed/counts only available; noncolor states | M unknown-metric examples; R optional fields |
| A81 | Keyboard hints, selection/scroll stability | M keyboard/anchor rules |
| A82 | Narrow/short/overflow, bounded viewport | M11/M12 MAIN and M14 WORKFLOW; measured cells |
| A83 | Realistic terminal cells, not web dashboard/runtime screenshot | M labeling; no HTML or product screenshot claim |
| A84 | Meaningful interface alternatives | R §6 |
| A85 | Proposed auto-yield/default notification rationale | R §5.4 and §9 |
| A86 | Unresolved preferences with recommended contrastive options | R §9; delivery not blocked |
| A87 | Each future slice objective/criteria/file ownership/RGR/gate | R §8 S1–S5 |
| A88 | Only real slice dependencies; no arbitrary line-count contract | R §8 DAG; M dimensions illustrative |
| A89 | Exact future Cargo/native/npm/typecheck/Vitest commands | R §8 command gate table |
| A90 | Exact future tmux/PTY scenario commands and oracles | R §8 D3 barrier table, bounded helper, both host run commands |
| A91 | Eventual docs/changelog migration, no present shipped claim | R §8 S5 and compatibility |
| A92 | Inspect new artifacts/cited local paths/symbols | N final check commands |
| A93 | Check local links | N final check commands |
| A94 | git diff --check | N final check commands |
| A95 | Changed-path/branch design-only proof | N final check commands and ignored artifact inventory |
| A96 | Label planned vs executed tests | R §8; N actual validation |
| A97 | Review design completeness/support, not absent runtime/approval | R metadata/§9 |
| A98 | Return RFC/mockup/research paths | N artifact keys; final handoff |
| A99 | Exact constrained types/shapes; permissive preservation where unspecified | R §5.2 model DTOs, §5.3 ActivityReport, §5.4 D2 trace |
| A100 | States/legal transitions/invariants/illegal inputs | R §5.4; table below |

## Constrained interfaces and fidelity risks

| Area | Current evidence | Proposed preserving choice / future check |
|---|---|---|
| Return identity | SingleResult continued/detached + same child path; native generated Array | WaitOutcome discriminant separate from TaskResult; actual arrays, no set/tuple substitution; S1/S3 schema checks |
| Required/optional fields | PTY exit code optional; unknown counts absent | Result discriminants require known state, optional metrics stay absent; known zero shown as zero; S1/S4 |
| Text and attachments | Retry signature retains raw text; omitted attachments differs from []; order/duplicates matter | Preserve task/command/message/question raw text; arrays ordered incl duplicates; no label-based identity; S3 |
| Duplicate operations | Fresh identical Intercom operations distinct; explicit retry token retains messageId | Task launch fresh each call unless exact launch operation token replay; receipt IDs never replaced by task ID; S1/S3 |
| Ordering | Native terminal guard; stage close seals admission | Owner actor sequence; first accepted terminal wins; output has independent offsets; S1/S4 |
| Path/owner authority | Stage boundary and immutable registrationGroup | Owner supplied by host capability, never model input; cwd resolved at launch by existing boundary, no later pane-cwd re-resolution; S1/S2 |
| Native variants | Existing NAPI Rust crate; cfg platform differences; no declared feature matrix | Generated declarations, Node/Bun runtime bridge tests, actual platform process cleanup; S1/S2 |
| Lifecycle | pending/running/continued → ok/error/interrupted | queued/running → cancelling → cancelled or direct terminal; no terminal revival; wait yield stays running; S1 |
| Owner | stage close idempotent; pane detach separate | open → closing → closed only after cleanup; cleanup failure leaves closing with explicit failure; no transfer/reopen; S1/S2 |
| Input failure | Existing parent omitted/empty questions preserved | No new rejection/normalization of question or attachments; stdin empty bytes no-op, explicit EOF separate; S2/S3 |

## Additional exact DeepWiki questions

Parent executed these via discovered `deepwiki_ask_question({repoName, question})`. The first three questions per reference and critical source cross-checks are retained in RT/U. These answer links have no declared indexed snapshot.

### Runtime Q4

Repository: `openai/codex`.

> Source verification at current SHA e01f38c388f4907f02ac5b4980a37487686204c8 contradicts prior synthesis: V2 wait.rs waits mailbox activity/steering rather than target-final statuses; agent/status.rs excludes Interrupted from is_final and later TurnStarted maps Running; unified_exec terminates OneShot completion_timeout, not ordinary interactive yield. Reconcile these with your previous claims that WaitAgentHandlerV2 waits agents and AgentStatus is terminal-monotonic. Specify exact version/path/symbol distinctions and tests; explicitly retract unsupported equivalence and tell us what cannot be verified from your index.

[Answer](https://deepwiki.com/search/source-verification-at-current_c537e0a1-f360-4abc-b5cf-d0553b45c682) retracts V2 final-status waiting, distinguishing `multi_agents/wait.rs` from `multi_agents_v2/wait.rs` mailbox/steering. It retracts terminal-monotonic simplification, cites `agent/status.rs`, and cannot verify OneShot from its supplied index. RT's pinned raw code is authoritative. Confidence high for RT verified distinctions, not unchecked constants or inferred cleanup.

### UI Q4

Repository: `mehmoodosman/claude-code`.

> Critical-evidence follow-up: source snapshot 30a1fa0f5d84b23f05664378d4863dd42aef0952 is a recovered proprietary source-map tree with no verified reusable license. Treat as analytical reference only. Does actual AgentTool foreground->background implementation preserve one ongoing generator/model execution or return an iterator then start runAgent with shared ID? How are unconsumed next-message races handled? Separately is there demonstrable empty-block/duplicate notification suppression in Messages.tsx or is that unsupported? Distinguish source-backed UI identity continuity from runtime execution continuity; source paths/symbols and limitations only, no code copying.

[Answer](https://deepwiki.com/search/criticalevidence-followup-sour_ef91b6cc-fc1d-4577-a5f6-2d3d9bd3679b) still conflates one generator with iterator return/new runAgent. It acknowledges no demonstrated Messages empty-block/duplicate suppression in supplied context. U verifies `AgentTool.tsx:916–948` at the pinned SHA; stable task identity does not prove uninterrupted generator execution. Confidence in that continuity claim unsupported. Atomic specifies its own same-promise guarantee. No source reuse is proposed.

## Setup and repository intent

Parent-observed preflight: HEAD `230bb1f1c75508d087e09725014c69f022de02cc`; clean tracked/untracked status before artifact writes; Node v26.8.1, Bun 1.4.2, Cargo 1.97.0; tmux and qlty available. `node_modules` absent and eval submodules uninitialized. Design-only Markdown needs neither package builds nor eval setup. Future runtime setup is `npm ci --ignore-scripts` then `npm run build`.

Git user Norin Lavaee; gh user flora131. Recent SSH author signature verified; gpg unavailable for GitHub signatures. Classic branch protection and legacy projects API returned 404. These do not block design delivery. No commit or external write is authorized. Dated research files are ignored by `.gitignore:59`; inventory them explicitly rather than treating empty git diff as proof no files changed.

## Deferred outside the contract

- DEV_SETUP/CONTRIBUTING stale minimum-release-age and SQLite/runtime statements. Preserve them here; source manifests and AGENTS control future commands.
- Whole #2824/#2700/#2565 implementation and adjacent HIL/notification projects. Reconcile dependencies before future affected slices, not in this design run.
- Runtime defects suggested by source gaps are not reproduced fixes. No runtime modification to make a design review pass.

## Contract amendments received

> note, that your design also needs to accomodate the intercom behavior that leads subagents to become async and make sure that the behavior is transparent as background subagent ui (currently not happening and only get a final lifecycle done message with an extra newline block)

This is an inherited user requirement, not an analyst proposal. No new user amendments were received by this writer.

## Actual validation

Initial writer checks: branch `feat/agent-task-experience`; HEAD matches the preflight SHA; `git status --porcelain` empty; brief SHA256 `9cf3396d9ecc26025cb9fecfcc324dfa10b50c198a7f118aa4aab04108392987` unchanged. Runtime tests in R/RT/I are future plans, not checks executed in this design run.

### Final artifact validation and repeatable check

Writer read all four owned artifacts after writing, with the RFC read in bounded ranges because one whole-file read exceeded the read tool's 50,000-character limit. Research and source inspection supplied 34 pinned Atomic source-link checks and 48 inline Intercom path/range checks, all present and in range. Focused symbol search confirmed StatusWatch publish, continueDetached, notifyDetachedForegroundChildExit, WorkflowStageAdmissionBoundary and RetryIdentityReservations in their cited modules. This verifies citations and document consistency, not runtime truth of proposed behavior.

The first no-index whitespace check found eight trailing spaces on empty mockup composer prompts. They were removed. The repeatable command below checks the actual new/ignored artifacts; plain `git diff --check` alone would miss them. No-index diff exits 1 for a new file with differences even when `--check` has no diagnostics, so the check requires empty diagnostics and an exit no greater than 1.

`qlty --version` returned `qlty 0.642.0 macos-arm64 (9c2c1a3 2026-08-14)`. Existing `.qlty/qlty.toml` was read and preserved. It declares supplemental built-in analysis but no linter plugins. Executed:

```sh
qlty check --no-fix --no-upgrade-check --no-progress --skip-source-fetch specs/2026-09-05-agent-task-experience.md research/2026-09-05-agent-task-mockups.md research/2026-09-05-agent-task-intercom.md research/2026-09-05-agent-task-design-notes.md
```

Output `✔ No issues`, exit 0. With no applicable configured Markdown plugin, that is not Markdown lint, security or runtime quality coverage. No config initialization, package install, build, test suite or live terminal run was needed or performed for this design-only deliverable. The actual layout check measures Unicode terminal cells, assuming ambiguous-width glyphs occupy one cell as in Atomic's requested vocabulary; future real-terminal verification remains in S5.

Run the following saved Python block from the checkout root. It uses only the standard library and non-destructive Git queries:

```python
import hashlib
import pathlib
import re
import subprocess
import unicodedata

root = pathlib.Path.cwd()
assert root == pathlib.Path('/Users/tonystark/Documents/projects/atomic-agent-task-experience')
def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()
assert git('branch', '--show-current') == 'feat/agent-task-experience'
assert git('rev-parse', 'HEAD') == '230bb1f1c75508d087e09725014c69f022de02cc'
brief = pathlib.Path('research/2026-09-05-agent-task-experience-brief.md')
assert hashlib.sha256(brief.read_bytes()).hexdigest() == '9cf3396d9ecc26025cb9fecfcc324dfa10b50c198a7f118aa4aab04108392987'
spec = pathlib.Path('specs/2026-09-05-agent-task-experience.md')
mock = pathlib.Path('research/2026-09-05-agent-task-mockups.md')
notes = pathlib.Path('research/2026-09-05-agent-task-design-notes.md')
intercom = pathlib.Path('research/2026-09-05-agent-task-intercom.md')
research = [pathlib.Path('research/2026-09-05-agent-task-runtime.md'),
            pathlib.Path('research/2026-09-05-agent-task-ui-research.md')]
validation = pathlib.Path('research/2026-09-05-agent-task-validation.md')
artifacts = [spec, mock, notes, intercom, *research, validation]
assert all(p.is_file() for p in artifacts)
assert not git('diff', '--name-only')
assert not git('diff', '--cached', '--name-only')
untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
assert set(untracked) <= {str(spec)}
subprocess.run(['git', 'diff', '--check'], check=True)
for p in artifacts:
    result = subprocess.run(['git', 'diff', '--no-index', '--check', '/dev/null', str(p)], text=True, capture_output=True)
    assert result.returncode <= 1 and not result.stdout and not result.stderr, (p, result.stdout, result.stderr)

links = 0
source_links = 0
for p in [brief, *artifacts]:
    text = p.read_text()
    for link in re.findall(r'\]\(([^)]+)\)', text):
        if '://' in link or link.startswith('#'):
            continue
        assert (p.parent / link.split('#')[0]).exists(), (p, link)
        links += 1
    for m in re.finditer(r'https://github.com/bastani-inc/atomic/blob/[a-f0-9]{40}/([^#\s)]+)(?:#L(\d+)(?:-L(\d+))?)?', text):
        source = pathlib.Path(m[1])
        assert source.exists(), source
        if m[2]:
            assert int(m[3] or m[2]) <= len(source.read_text().splitlines()), m[0]
        source_links += 1

inline = 0
for m in re.finditer(r'`((?:packages|crates|test)/[^` :]+):(\d+)(?:-(\d+))?[^`]*`', intercom.read_text()):
    source = pathlib.Path(m[1])
    assert source.exists(), source
    assert int(m[3] or m[2]) <= len(source.read_text().splitlines()), m[0]
    inline += 1
symbols = {
    'crates/atomic-natives/src/subagent_control/status.rs': ['pub fn publish'],
    'packages/subagents/src/runs/inprocess/runner.ts': ['continueDetached(', 'session.prompt('],
    'packages/subagents/src/runs/foreground/subagent-executor-status.ts': ['notifyDetachedForegroundChildExit'],
    'packages/coding-agent/src/core/workflow-stage-admission.ts': ['class WorkflowStageAdmissionBoundary'],
    'packages/intercom/retry-identity.ts': ['class RetryIdentityReservations'],
}
for path, names in symbols.items():
    for name in names:
        assert name in pathlib.Path(path).read_text(), (path, name)

inside = False
frames = []
for line in mock.read_text().splitlines():
    match = re.match(r'(\d+)×(\d+)', line)
    if match:
        limit = tuple(map(int, match.groups()))
    if line == '```text':
        inside = True
        widths = []
        continue
    if line == '```' and inside:
        assert len(widths) <= limit[1] and max(widths, default=0) <= limit[0]
        frames.append((limit, len(widths), max(widths, default=0)))
        inside = False
        continue
    if inside:
        widths.append(sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in line))
assert len(frames) == 22
for p in [spec, mock]:
    assert not re.search(r'Claude|Codex|Anthropic|OpenAI|mehmoodosman', p.read_text(), re.I)
assert 'status: In Review' in spec.read_text()
assert '## Backwards Compatibility' in spec.read_text()
assert len(re.findall(r'^\| A\d+ \|', notes.read_text(), re.M)) == 100
amendment = 'note, that your design also needs to accomodate the intercom behavior that leads subagents to become async and make sure that the behavior is transparent as background subagent ui (currently not happening and only get a final lifecycle done message with an extra newline block)'
assert amendment in brief.read_text() and amendment in notes.read_text() and amendment in intercom.read_text()
assert re.findall(r'^\| (A\d+) \|', notes.read_text(), re.M) == [f'A{i:02}' for i in range(1,101)]
doc = spec.read_text()
for marker in ['D1 proposed trace', 'D2 proposed model/attention trace', 'D3 planned run trace',
               '4 W2 elapsed yield -> no host-observation-changed -> foreground/W1',
               'type ModelSingleResponse = ModelAdmitted | ModelRejected;',
               'attention-clear', 'model-persisted(done)', 'wait cleanup(close)',
               'FIXTURE_BARRIER_TIMEOUT_MS=30000', 'Lifetime contract fence']:
    assert marker in doc, marker
assert doc.count('| `waitForTask(') == 1
assert doc.count('| `yieldTaskWait(') == 1
assert doc.count('| {kind:"wait-started";') == 1
for line in doc.splitlines():
    if '-> capture ' in line:
        assert 'wait rendered(' in line, line
for host in ['main', 'workflow']:
    assert f'driver.mjs run --chat {host} --session atomic-task-{host}' in doc
print('PASS: branch/HEAD/brief/scope/whitespace; 7 artifacts; 100 acceptance rows')
print(f'PASS: {links} local links; {source_links} pinned Atomic source links; {inline} Intercom citations; focused symbols')
print('PASS: 22 terminal frames within declared cell dimensions; Atomic-only RFC/mockup naming')
print('PASS: D1/D2/D3 document trace markers, unique wait doors/events, synchronized capture predicates')
```

The ledger's literal behavior is represented by A01–A100. The native/API/state risks are specified and traced to future tests, not claimed as already executed. Open product choices remain in RFC §9 with recommendations. Scope did not expand; the deferred list above remains unchanged.

Final execution of the saved check:

```sh
python3 - <<'PY'
import pathlib,re
notes=pathlib.Path('research/2026-09-05-agent-task-design-notes.md').read_text()
code=re.search(r'```python\n(.*?)\n```', notes, re.S).group(1)
exec(compile(code,'design-notes-validation','exec'))
PY
```

Observed output, exit 0:

```text
PASS: branch/HEAD/brief/scope/whitespace; 6 artifacts; 100 acceptance rows
PASS: 20 local links; 34 pinned Atomic source links; 48 Intercom citations; focused symbols
PASS: 19 terminal frames within declared cell dimensions; Atomic-only RFC/mockup naming
```

Final scope: only the new RFC appears in normal `git status --porcelain`; five new research artifacts are ignored but explicitly inventoried. No tracked or staged delta, no runtime/shipped-doc edit, unchanged HEAD and brief hash. Writer-owned outputs are RFC, mockups, this receipt and recovered Intercom research. Runtime/UI research was incorporated without writer changes. Draft deliverables are ready for independent design review and the later human interview. Implementation, runtime validation and human approval remain deliberately unperformed.

## Consolidated repair receipt

Seven deliverables now include the independent validation report. Its original findings remain historical; the appended resolution section records this repair. M13/M14 bring the frame count to 22. A01–A100 remain the same acceptance identities. R §5.4 D1/D2 and §8 D3 are inspectable proposed state/DTO/fixture traces, not executed runtime tests. The saved check checks trace presence, unique declarations and wait-before-capture structure; counts and text assertions do not prove implementation semantics. Previous six-artifact/19-frame outputs above are historical receipts, not current counts.

Repair ownership is limited to R, M, N and the appended validation resolution. Runtime/UI/Intercom evidence and brief remain unchanged. No runtime suite or pluginless qlty rerun is claimed.
