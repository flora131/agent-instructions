/** Raw command output limits from RFC #2884; session history has separate retention. */
export const COMMAND_LIVE_PREVIEW_BYTES = 1048576;
export const COMMAND_FOREGROUND_SPILL_BYTES = 8388608;
export const COMMAND_DISK_OUTPUT_CAP_BYTES = 5368709120;
export const COMMAND_DETAIL_TAIL_BYTES = 8192;
/** Observation expiry releases the caller, never the command process. */
export const COMMAND_FOREGROUND_BUDGET_MS = 10000;

/** File-spool watchdog uses actual file bytes and strict overflow, not a 32-bit cast. */
export function commandSpoolExceedsCap(fileBytes: bigint, capBytes = BigInt(COMMAND_DISK_OUTPUT_CAP_BYTES)): boolean {
	return fileBytes > capBytes;
}
