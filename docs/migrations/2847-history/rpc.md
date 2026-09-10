# Historical rpc documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: rpc::017 -->

Source: `packages/coding-agent/docs/rpc.md` lines 244–266 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/rpc/protocol.md#set_model`.

#### set_model

Switch to a specific model. Omit `persist` (or set it false) to change only the current session. Set `"persist": true` to also write `defaultProvider`/`defaultModel` in settings, matching Ctrl+S in the interactive `/model` picker.

```json
{"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}
```

Persist as the startup default:
```json
{"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514", "persist": true}
```

Response contains the full [Model](#model) object:
```json
{
  "type": "response",
  "command": "set_model",
  "success": true,
  "data": {...}
}
```

<!-- baseline-block: rpc::022 -->

Source: `packages/coding-agent/docs/rpc.md` lines 350–378 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/rpc/protocol.md#set_thinking_level`.

#### set_thinking_level

Set the reasoning/thinking level for models that support it. Omit `persist` (or set it false) to change only the current session. Set `"persist": true` to also save the startup thinking default, matching Ctrl+S in the interactive `/thinking` picker. When a model is active, that writes the per-model override; otherwise it writes `defaultThinkingLevel`.

```json
{"type": "set_thinking_level", "level": "high"}
```

Persist as the startup default:
```json
{"type": "set_thinking_level", "level": "high", "persist": true}
```

Levels: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`.

`xhigh` and `max` are available only when the active model's capability mapping supports them; unsupported levels are clamped by the session model controls.

Response may omit `data` for compatibility with older clients:
```json
{"type": "response", "command": "set_thinking_level", "success": true}
```

Current engines include the effective level after capability clamping and, when a model is active, the provider/model the engine persisted against:
```json
{"type": "response", "command": "set_thinking_level", "success": true, "data": {"level": "high", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}}
```

Isolated interactive hosts must apply a persisted thinking default using that ACK target, not the host session model at callback time. A later `model_changed` event must not re-key the saved override. A later `thinking_level_changed` event must keep the host session's effective level even if an older ACK settles afterward. `RpcClient.setThinkingLevel(level)` stays one-argument `Promise<void>`; isolated persist reads the ACK through an internal client path.
