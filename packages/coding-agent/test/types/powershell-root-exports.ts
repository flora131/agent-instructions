import {
	BASH_SHELL_PRESENTATION,
	type BashToolInput,
	createLocalPowerShellOperations,
	createPowerShellTool,
	createPowerShellToolDefinition,
	getPowerShellConfig,
	isPowerShellToolResult,
	type PowerShellOperations,
	type PowerShellSpawnContext,
	type PowerShellSpawnHook,
	type PowerShellToolCallEvent,
	type PowerShellToolDetails,
	type PowerShellToolInput,
	type PowerShellToolOptions,
	type ShellToolPresentation,
} from "../../src/index.ts";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Condition extends true> = Condition;

export type PowerShellToolCallEventRootExport = Assert<Equal<PowerShellToolCallEvent["toolName"], "powershell">>;
export type PowerShellToolInputRootExport = Assert<Equal<PowerShellToolInput, BashToolInput>>;
export type ShellCommandInputRootExport = Assert<
	Equal<Extract<PowerShellToolInput, { command: string }>["command"], string>
>;
export const shellWaitInput: BashToolInput = { action: "wait", id: "task", budgetMs: 0 };
export const powershellWaitInput: PowerShellToolInput = { action: "wait", id: "task" };
// @ts-expect-error Existing-task waits cannot execute another command.
export const mixedShellInput: BashToolInput = { action: "wait", id: "task", command: "echo duplicate" };
// @ts-expect-error Existing-task waits require an ID.
export const missingWaitId: PowerShellToolInput = { action: "wait" };
export type PowerShellSpawnContextRootExport = Assert<Equal<PowerShellSpawnContext["command"], string>>;
export type ShellToolPresentationRootExport = Assert<Equal<ShellToolPresentation["prompt"], string>>;

export const powerShellRootFactories = {
	BASH_SHELL_PRESENTATION,
	createLocalPowerShellOperations,
	createPowerShellTool,
	createPowerShellToolDefinition,
	getPowerShellConfig,
	isPowerShellToolResult,
};

export type PowerShellRootTypes = {
	operations: PowerShellOperations;
	spawnHook: PowerShellSpawnHook;
	details: PowerShellToolDetails;
	options: PowerShellToolOptions;
};
