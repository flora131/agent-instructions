import { stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { findToolByName } from "./tool-metadata.js";
import { getServerPrefix, type McpConfig, type ToolMetadata } from "./types.js";

interface RenderTheme {
  fg: (name: string, text: string) => string;
}

export interface McpCallRenderSource {
  config?: McpConfig;
  toolMetadata?: ReadonlyMap<string, ToolMetadata[]>;
}

function textArg(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function inferServer(tool: string, source: McpCallRenderSource): string | undefined {
  const matches = [...(source.toolMetadata ?? [])]
    .filter(([, metadata]) => findToolByName(metadata, tool))
    .map(([server]) => server);
  if (matches.length > 0) return matches.length === 1 ? matches[0] : undefined;
  const prefixMode = source.config?.settings?.toolPrefix ?? "server";
  const candidates = Object.keys(source.config?.mcpServers ?? {}).filter((server) => {
    const prefix = getServerPrefix(server, prefixMode);
    return prefix.length > 0 && tool.startsWith(`${prefix}_`);
  });
  // Prefixes can collide or overlap. Leave the label unresolved rather than
  // predicting which lazy connection will succeed; rendering never connects.
  return candidates.length === 1 ? candidates[0] : undefined;
}

function header(theme: RenderTheme, server: string | undefined, operation: string): Text {
  const clean = (value: string) => stripTerminalSequences(value).replace(/[\r\n\t]/g, " ");
  return new Text(
    theme.fg("toolTitle", `MCP${server ? ` ${clean(server)}` : ""}`) + theme.fg("muted", ` · ${clean(operation)}`),
    0, 0,
  );
}

export function renderMcpDirectToolCall(server: string, tool: string, theme: RenderTheme): Text {
  return header(theme, server, tool);
}

export function renderMcpToolCall(
  args: Record<string, unknown>,
  theme: RenderTheme,
  source: McpCallRenderSource = {},
): Text {
  const action = textArg(args?.action);
  const tool = textArg(args?.tool);
  const connect = textArg(args?.connect);
  const describe = textArg(args?.describe);
  const server = textArg(args?.server);
  // Match gateway dispatch precedence without changing or performing routing.
  if (action === "ui-messages") return header(theme, undefined, action);
  if (tool) return header(theme, server ?? inferServer(tool, source), tool);
  if (connect) return header(theme, connect, "connect");
  if (describe) return header(theme, server ?? inferServer(describe, source), `describe ${describe}`);
  if (textArg(args?.search)) return header(theme, server, "search");
  return header(theme, server, server ? "tools" : "status");
}
