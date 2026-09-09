/** RPC bash uses PowerShell on native Windows and a POSIX shell elsewhere (PR #2938). */
function quote(value: string): string {
	return process.platform === "win32" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
}

export function outputCommand(text: string, channel: "stdout" | "stderr" = "stdout"): string {
	if (process.platform === "win32") {
		return `[Console]::${channel === "stdout" ? "Out" : "Error"}.Write(${quote(text)})`;
	}
	return `printf %s ${quote(text)}${channel === "stderr" ? " >&2" : ""}`;
}

export function delayedOutputCommand(before: string, seconds: number, after: string): string {
	const sleep = process.platform === "win32" ? `Start-Sleep -Milliseconds ${seconds * 1000}` : `sleep ${seconds}`;
	return `${outputCommand(before)}; ${sleep}; ${outputCommand(after)}`;
}

export function gatedOutputCommand(marker: string, before: string, after: string): string {
	if (process.platform === "win32") {
		return `New-Item -ItemType File -Path ${quote(`${marker}.waiting`)} | Out-Null; ${outputCommand(before)}; while (-not (Test-Path -LiteralPath ${quote(marker)})) { Start-Sleep -Milliseconds 10 }; ${outputCommand(after)}`;
	}
	return `: > ${quote(`${marker}.waiting`)}; ${outputCommand(before)}; while [ ! -f ${quote(marker)} ]; do sleep 0.01; done; ${outputCommand(after)}`;
}
