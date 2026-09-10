# Historical tools documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: tools::003 -->

Source: `packages/coding-agent/docs/tools.md` lines 27–38 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/tools.md#bash-and-bashinterceptor`.

## `bash` and `bashInterceptor`

The `bash` tool executes shell commands in the session workspace, with optional PTY handling. When `pty: true` is requested, local execution uses the bundled Rust-backed PTY session; if the native PTY package is unavailable, Atomic degrades to normal pipe execution. Set `PI_NO_PTY=1` or `ATOMIC_NO_PTY=1` to force normal pipe execution. Foreground results include oh-my-pi-style `timeoutSeconds`, `requestedTimeoutSeconds`, `wallTimeMs`, and non-zero `exitCode` metadata, and preserve overflow output in a temporary `fullOutputPath` when output is truncated.

When explicitly enabled in settings, built-in bash interceptor rules block common shell substitutes for first-class tools (`cat`/`grep`/`find`/in-place `sed`/redirection, etc.) only when the corresponding tool is available. Enabled bash tool calls are also offered to `user_bash` extension handlers before local execution. Atomic checks the original command, the internal-URL-expanded command, configured-prefix forms, `spawnHook`-rewritten commands, and a leading `cd path && command` or `cd path; command`-stripped form only when structured `cwd` was omitted, so interceptors can route commands by effective working directory without overriding explicit `cwd`. The bash schema accepts `cwd`, `env`, `timeout`, and `pty`; `cwd` and `env` are honored by the local executor. Omitting `timeout` uses the 300-second default. An explicit timeout must be finite, greater than zero, and no more than Atomic's deliberate 3600-second ceiling; invalid values fail before execution instead of being defaulted or clamped. Valid fractional values are rounded down with a one-second floor. `bashInterceptor.enabled` defaults to `false`; interception is not auto-enabled.

```json
{
  "bashInterceptor": { "enabled": true }
}
```
