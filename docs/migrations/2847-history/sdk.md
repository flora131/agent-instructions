# Historical sdk documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: sdk::009 -->

Source: `packages/coding-agent/docs/sdk.md` lines 123–179 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/sdk.md#agentsession`.

### AgentSession

The session manages agent lifecycle, message history, model state, compaction, and event streaming.

```typescript
interface AgentSession {
  // Send a prompt and wait for completion
  prompt(text: string, options?: PromptOptions): Promise<void>;

  // Queue messages during streaming
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;

  // Controlled queue-pause gate
  readonly queuedMessagesPaused: boolean;
  pauseQueuedMessages(): void;
  resumeQueuedMessages(): Promise<boolean>;

  // Subscribe to events (returns unsubscribe function)
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;

  // Session info
  sessionFile: string | undefined;
  sessionId: string;

  // Model and thinking control
  setModel(model: Model): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  cycleModel(): Promise<ModelCycleResult | undefined>;
  cycleThinkingLevel(): ThinkingLevel | undefined;

  // State access
  agent: Agent;
  model: Model | undefined;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];
  isStreaming: boolean;

  // In-place tree navigation within the current session file
  navigateTree(targetId: string, options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string }): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }>;

  // Verbatim line compaction
  compact(options?: Partial<VerbatimCompactionParameters>): Promise<VerbatimCompactionResult>;
  abortCompaction(): void;

  // Abort current operation
  abort(): Promise<void>;

  // Cleanup
  dispose(): void;
}
```

`compact()` serializes older context to numbered lines, asks the session model for JSON deleted ranges, validates them, and mechanically reconstructs a durable verbatim transcript string. It appends a `compaction` entry with `details.strategy: "verbatim-lines"`; the recent tail remains ordinary messages. The model never authors replacement context text.

Session replacement APIs such as new-session, resume, fork, and import live on `AgentSessionRuntime`, not on `AgentSession`.

<!-- baseline-block: sdk::022 -->

Source: `packages/coding-agent/docs/sdk.md` lines 612–621 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/sdk/reference.md#powershell-tool-behavior`.

#### PowerShell tool behavior

`createPowerShellTool()` and `createPowerShellToolDefinition()` provide the same tool used by interactive sessions. When their default local operations execute on native Windows, they prefer `pwsh.exe`, fall back to `powershell.exe`, and throw a clear error when neither executable is available. `createLocalPowerShellOperations()` and `getPowerShellConfig()` are also exported for custom integrations. The PowerShell factories expose the current `ATOMIC_*` and legacy `PI_*` session snapshot by default; set `exposeSessionEnvironment: false` to opt out.

```typescript
import { createPowerShellTool } from "@bastani/atomic";

const powershell = createPowerShellTool("C:\\path\\to\\project");
```

<!-- baseline-block: sdk::005 -->

Source: `packages/coding-agent/docs/sdk.md` lines 81–90 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/sdk.md`.

## Experimental remote sessions

`@bastani/atomic/client` is an experimental entrypoint for upstream remote protocol sessions. It exports `RemoteSession` plus transcript projection helpers. Pass it a connected `PiClient` from `@earendil-works/pi-client`, then use `RemoteSession.open()` or `RemoteSession.create()` to own one remote session.

`RemoteSession` and Atomic's isolated interactive engine deliberately **coexist**; neither adapts the other. `RemoteSession` owns the `pi-client`/`pi-protocol` transport, its `SessionLease`, the leased `SessionSnapshot`, and the transcript projection used by an external protocol client. The isolated engine owns Atomic's in-process host facade, child-process JSONL RPC engine, interactive rendering, custom UI, and engine recovery. The client entrypoint has no `atomic client` CLI command and does not start or control the local interactive engine.

`RemoteSession.sessions` is a durable catalog of `SessionMetadata`. That is enough for listing and selecting stored sessions, but not for Atomic consumers that need runtime phase, model, thinking level, attachment, or lock state. Those consumers need the `SessionSnapshot` from an acquired lease; `RemoteSession.snapshot` exposes the current leased snapshot.

This boundary is intentional. A bridge would join two different protocols and would risk routing isolated-engine teardown through the host facade's unbounded cooperative abort. Keep the surfaces separate until a future upstream `RemoteSession` change supplies an engine-aware/server contract with teardown semantics that can preserve Atomic's recovery guarantee. The API may change without notice while it remains experimental.

<!-- baseline-block: sdk::006 -->

Source: `packages/coding-agent/docs/sdk.md` lines 91–98 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/sdk.md`.

## Experimental Harness factory

The package root also exports `createCodingAgentHarness()` for applications that provide a pi-agent-core `ExecutionEnv`. It creates a Harness with Atomic's six coding tools: `read`, `bash`, `edit`, `write`, `find`, and `search`.

The factory routes the primary operations for the first five tools through the supplied execution environment, including directory-tree reads. URL reads use the session id for cache scope, fetch through the process network, and do not persist host-local artifacts because the factory has no local session directory. `search` is fully local; read and edit still use local path-variant probes and notebook projection, read also uses local archive, SQLite, and internal-resource selectors, write retains local generated-file, shebang, conflict, and resource helpers, and bash validates its cwd locally and uses Atomic's local temp storage for overflow output.

The factory requires `ExecutionEnv.renameFile()` and does not add a fallback filesystem implementation.
