# Historical providers documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: providers::006 -->

Source: `packages/coding-agent/docs/providers.md` lines 45–51 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/providers.md#openai-codex`.

### OpenAI Codex

- Requires ChatGPT Plus or Pro subscription
- Officially endorsed by OpenAI: [Codex for OSS](https://developers.openai.com/community/codex-for-oss)

If the Codex backend reports that an OAuth/auth token was invalidated or revoked, retry the request once in case the rejection is transient. If it persists, run `/logout` and select **OpenAI ChatGPT Plus/Pro**, then run `/login`, authenticate that subscription again, and retry the request. Atomic displays these recovery steps with the provider error; it does not automatically delete the stored credential or repeatedly retry a definitive authentication rejection.

<!-- baseline-block: providers::007 -->

Source: `packages/coding-agent/docs/providers.md` lines 52–72 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/providers.md#fast-models`.

### Fast models

Fast inference is a model choice, not a mode. Where a provider supports it, Atomic adds a second selectable model whose canonical ID is the base model ID plus `-fast` — for example `openai-codex/gpt-5.6-sol-fast`. It appears in `/model`, in `atomic --list-models`, and in workflow model catalogs alongside its normal sibling, and it is persisted and restored by that exact ID. Select it anywhere you name a model, including with a thinking suffix: `openai-codex/gpt-5.6-sol-fast:medium`.

Two provider paths produce these variants:

- Only first-party OpenAI `openai/*` and OpenAI Codex `openai-codex/*` models send the **base** upstream model ID plus the fixed `service_tier: priority`. A renamed provider, proxy, Azure OpenAI, OpenRouter, or generic OpenAI-compatible provider does not receive a synthetic fast variant.
- GitHub Copilot exposes only the real fast sibling IDs the OAuth model catalog advertises for the signed-in account, and only when the corresponding base model exists in Atomic's Copilot catalog. It sends those suffixed IDs verbatim with no OpenAI service-tier field. Copilot fast models require the account catalog metadata obtained through `/login`; a raw `COPILOT_GITHUB_TOKEN` does not provide that metadata.

The selection Atomic records stays the canonical `-fast` identity even when the outbound request carries the base upstream model ID, so sessions, usage rows, fallback attempts, workflow metadata, and subagent labels all keep normal and fast apart. There is no separate `fast` badge anywhere in the UI: the model ID already says it.

A fast variant's route owns two request fields: the upstream model ID and the service tier. A `before_provider_request` hook may rewrite anything else, but replacing the payload with a non-object or changing either route-owned field is refused with an error naming the model and the remedy, because a model recorded, persisted, and billed as `-fast` must not go out as a different model or at an ordinary tier. Select the normal sibling instead when a request needs different routing. A model without a fast variant keeps unrestricted hook freedom, and an explicit per-request service tier still applies to it without granting fast-model identity.

Atomic does not publish a fast variant for a model whose API is served by an extension's own stream function, including a natively registered provider: it cannot enforce the route through a transport it does not serialize. Such a provider keeps its normal models and its own transport untouched.

Fast behavior comes from explicit route metadata attached when the variant is derived — never from the `-fast` suffix. If a provider, a `models.json` custom model, or an extension already defines that exact `-fast` ID, that model wins: it routes exactly as it is declared, Atomic suppresses the derived duplicate, and interactive startup and `--list-models` print a warning naming the model to rename or remove. Fast variants are not derived for Azure OpenAI, OpenRouter, or generic OpenAI-compatible providers.

For first-party OpenAI Codex models on the shared ChatGPT Codex transport, explicit fast-route metadata — not the final payload tier, a caller flag, or the `-fast` suffix — selects the routing contract: `originator: codex_cli_rs` plus `x-codex-routing-hint: model=<base-upstream-model>;tier=priority` on both HTTP/SSE and WebSocket transports. Credential resolution preserves that identity when it resolves to the first-party ChatGPT endpoint; merely using `api: "openai-codex-responses"` under a renamed provider or proxy does not grant it. WebSocket fallback, reconnect, and HTTP retry attempts reuse the model route's identity, and switching between normal and fast model routes drops a cached socket before reuse. Requests to the standard OpenAI API send only the tier. On a normal model Atomic keeps the normal `originator: pi` identity and sends no routing hint, even if a standalone caller explicitly requests `serviceTier: priority`. The same contract covers standalone `modelRuntime.stream()`/`complete()`/`streamSimple()`/`completeSimple()` requests.

Pick fast variants deliberately in workflows: parallel fan-out multiplies provider usage, and priority-tier requests are billed at a higher rate.

<!-- baseline-block: providers::009 -->

Source: `packages/coding-agent/docs/providers.md` lines 83–89 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/providers.md#github-copilot`.

### GitHub Copilot

- Press Enter for github.com, or enter your GitHub Enterprise Server domain
- `COPILOT_GITHUB_TOKEN` is read as an API key when you prefer an environment variable over `/login`
- Models come from the bundled `pi-ai` GitHub Copilot catalog; an OAuth credential narrows the list to the ids your account can actually use
- If you get "model not supported", enable it in VS Code: Copilot Chat → model selector → select model → "Enable"

<!-- baseline-block: providers::011 -->

Source: `packages/coding-agent/docs/providers.md` lines 105–110 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/providers.md#xai-grok/x-subscription`.

### xAI (Grok/X subscription)

Run `/login xai`, then select **Use a subscription**. `XAI_API_KEY` remains available through **Use an API key**.

Atomic defaults xAI sessions to `grok-4.6`. Built-in workflow and subagent fallback chains use `xai/grok-4.6:xhigh`, `github-copilot/grok-4.6:xhigh`, and `openrouter/x-ai/grok-4.6`; GitHub Copilot also exposes Grok 4.6 when the account's model policy enables it. Network-backed catalogs refresh and cache these newer entries independently of the bundled catalog snapshot.

<!-- baseline-block: providers::014 -->

Source: `packages/coding-agent/docs/providers.md` lines 118–178 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/providers.md#environment-variables-or-auth-file`.

### Environment Variables or Auth File

Use `/login` in interactive mode and select a provider to store an API key in `auth.json`, or set credentials via environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
atomic
```

After a successful API-key or OAuth login, Atomic persists the credential and immediately marks that provider available against the model snapshot already loaded in the active session. It does not make login wait for cache restoration, ambient-availability checks, or another model-catalog request. Open `/model` to use that authenticated snapshot immediately; the selector restores and refreshes dynamic catalogs in the background with a 15-second deadline and keeps selection responsive if a provider is slow or unavailable.

`/logout` follows the same transaction boundary in reverse: once the stored credential is deleted, Atomic immediately removes that stored-auth projection and returns to the editor without refreshing model catalogs. A short, bounded local probe preserves models when authentication still exists through an environment variable or runtime key. Refresh work that began before either login or logout cannot later overwrite the newer credential snapshot.

On a remote or headless machine, paste the authorization code or final redirect URL into the login prompt when the provider offers manual entry. A completed exchange must either return to the editor or show an error; it does not require deleting `~/.atomic`. Existing OAuth credentials use the same `auth.json` schema after the pi-ai model-runtime migration and are loaded in place.

Remote pi.dev catalogs persist their ETag and are revalidated with `If-None-Match`; an empty `304` keeps the cached models and counts as a successful check. Atomic renders the cached snapshot immediately, preserves each provider's last usable catalog on refresh failure, and prefers newer bundled data over stale remote overlays. See [Custom Models](/models#catalog-freshness-and-precedence).

| Provider | Environment Variable | `auth.json` key |
|----------|----------------------|------------------|
| Anthropic | `ANTHROPIC_API_KEY` or bearer-only `ANTHROPIC_AUTH_TOKEN` | `anthropic` |
| Ant Ling | `ANT_LING_API_KEY` | `ant-ling` |
| Azure OpenAI Responses | `AZURE_OPENAI_API_KEY` | `azure-openai-responses` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
| NVIDIA NIM | `NVIDIA_API_KEY` | `nvidia` |
| Google Gemini | `GEMINI_API_KEY` | `google` |
| Google Vertex AI | `GOOGLE_CLOUD_API_KEY` | `google-vertex` |
| Mistral | `MISTRAL_API_KEY` | `mistral` |
| Groq | `GROQ_API_KEY` | `groq` |
| Cerebras | `CEREBRAS_API_KEY` | `cerebras` |
| Cloudflare AI Gateway | `CLOUDFLARE_API_KEY` (+ `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`) | `cloudflare-ai-gateway` |
| Cloudflare Workers AI | `CLOUDFLARE_API_KEY` (+ `CLOUDFLARE_ACCOUNT_ID`) | `cloudflare-workers-ai` |
| xAI | `XAI_API_KEY` | `xai` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `vercel-ai-gateway` |
| ZAI | `ZAI_API_KEY` | `zai` |
| ZAI Coding Plan (China) | `ZAI_CODING_CN_API_KEY` | `zai-coding-cn` |
| OpenCode Zen | `OPENCODE_API_KEY` | `opencode` |
| OpenCode Go | `OPENCODE_API_KEY` | `opencode-go` |
| Radius | `RADIUS_API_KEY` | `radius` |
| Hugging Face | `HF_TOKEN` | `huggingface` |
| Fireworks | `FIREWORKS_API_KEY` | `fireworks` |
| Together AI | `TOGETHER_API_KEY` | `together` |
| Baseten | `BASETEN_API_KEY` | `baseten` |
| Kimi For Coding | `KIMI_API_KEY` | `kimi-coding` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` | `minimax-cn` |
| Moonshot AI | `MOONSHOT_API_KEY` | `moonshotai` |
| Moonshot AI (China) | `MOONSHOT_API_KEY` | `moonshotai-cn` |
| Qwen Token Plan (existing catalog) | `QWEN_TOKEN_PLAN_API_KEY` | `qwen-token-plan` |
| Qwen Token Plan (Individual) | `QWEN_TOKEN_PLAN_API_KEY` | `qwen-token-plan-individual` |
| Qwen Token Plan (China) | `QWEN_TOKEN_PLAN_CN_API_KEY` | `qwen-token-plan-cn` |
| Xiaomi MiMo | `XIAOMI_API_KEY` | `xiaomi` |
| Xiaomi MiMo Token Plan (China) | `XIAOMI_TOKEN_PLAN_CN_API_KEY` | `xiaomi-token-plan-cn` |
| Xiaomi MiMo Token Plan (Amsterdam) | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` | `xiaomi-token-plan-ams` |
| Xiaomi MiMo Token Plan (Singapore) | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` | `xiaomi-token-plan-sgp` |

Z.AI and Z.AI Coding Plan (China) default to `glm-5.3` (`zai/glm-5.3` and `zai-coding-cn/glm-5.3`), and both direct providers also expose the multimodal `glm-5.3-flash`. Baseten defaults to its directly selectable `zai-org/GLM-5.3`; OpenRouter exposes `z-ai/glm-5.3`, and both mirrors expose the multimodal Flash variant (`zai-org/GLM-5.3-Flash` on Baseten and `z-ai/glm-5.3-flash` on OpenRouter). Every full and Flash entry supports `low`, `high`, and `max` reasoning, and built-in workflow and subagent chains include all four provider routes at `:high`. Use Baseten's `zai-org/GLM-5.2` when fully disabled reasoning is required. Qwen Token Plan Individual defaults to `qwen3.8-max` and uses the international `QWEN_TOKEN_PLAN_API_KEY` shared with the existing Qwen Token Plan provider.

Reference for environment variables and `auth.json` keys: `findEnvKeys()` / `getEnvApiKey()` in the installed `@bastani/pi-ai` dependency (`node_modules/@bastani/pi-ai/dist/env-api-keys.d.ts`). The private provider map those functions use is in `node_modules/@bastani/pi-ai/dist/env-api-keys.js`; Atomic does not include a separate `packages/ai` source directory in this monorepo.

<!-- baseline-block: providers::019 -->

Source: `packages/coding-agent/docs/providers.md` lines 276–318 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/providers.md#amazon-bedrock`.

### Amazon Bedrock

```bash
# Option 1: AWS Profile
export AWS_PROFILE=your-profile

# Option 2: IAM Keys
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...

# Option 3: Bearer Token
export AWS_BEARER_TOKEN_BEDROCK=...

# Optional region (defaults to us-east-1)
export AWS_REGION=us-west-2
```

Also supports ECS task roles (`AWS_CONTAINER_CREDENTIALS_*`) and IRSA (`AWS_WEB_IDENTITY_TOKEN_FILE`).

```bash
atomic --provider amazon-bedrock --model us.anthropic.claude-sonnet-4-20250514-v1:0
```

Prompt caching is enabled automatically for Claude models whose ID contains a recognizable model name (base models and system-defined inference profiles). For application inference profiles (whose ARNs don't contain the model name), set `AWS_BEDROCK_FORCE_CACHE=1` to enable cache points:

```bash
export AWS_BEDROCK_FORCE_CACHE=1
atomic --provider amazon-bedrock --model arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123
```

If you are connecting to a Bedrock API proxy, the following environment variables can be used:

```bash
# Set the URL for the Bedrock proxy (standard AWS SDK env var)
export AWS_ENDPOINT_URL_BEDROCK_RUNTIME=https://my.corp.proxy/bedrock

# Set if your proxy does not require authentication
export AWS_BEDROCK_SKIP_AUTH=1

# Set if your proxy only supports HTTP/1.1
export AWS_BEDROCK_FORCE_HTTP1=1
```

<!-- baseline-block: providers::020 -->

Source: `packages/coding-agent/docs/providers.md` lines 319–342 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/providers.md#cloudflare-ai-gateway`.

### Cloudflare AI Gateway

`CLOUDFLARE_API_KEY` can be set via `/login`. The account ID and gateway slug must be set as environment variables.

```bash
export CLOUDFLARE_API_KEY=...           # or use /login
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_GATEWAY_ID=...        # create at dash.cloudflare.com → AI → AI Gateway
atomic --provider cloudflare-ai-gateway --model "claude-sonnet-4-5"
```

Routes to OpenAI, Anthropic, and Workers AI through Cloudflare AI Gateway. Workers AI uses the Unified API (`/compat`) and prefixed model IDs (`workers-ai/@cf/...`). OpenAI uses the OpenAI passthrough route (`/openai`) with native OpenAI model IDs such as `gpt-5.1`. Anthropic uses the Anthropic passthrough route (`/anthropic`) with native Anthropic model IDs such as `claude-sonnet-4-5`.

AI Gateway authentication uses `CLOUDFLARE_API_KEY` as `cf-aig-authorization`. Upstream authentication can be one of:

| Mode | Request auth | Upstream auth |
|------|--------------|---------------|
| Workers AI | Cloudflare token only | Cloudflare-native |
| Unified billing | Cloudflare token only | Cloudflare handles upstream auth and deducts credits |
| Stored BYOK | Cloudflare token only | Cloudflare injects provider keys stored in the AI Gateway dashboard |
| Inline BYOK | Cloudflare token plus upstream `Authorization` header | The request supplies the upstream provider key |

For normal Atomic usage, prefer unified billing or stored BYOK. Inline BYOK requires configuring an additional upstream `Authorization` header for the Cloudflare AI Gateway provider, for example via a `models.json` provider/model override.
