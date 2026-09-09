import type { Markit, StreamInfo } from "markit-ai";

export interface MarkitConversionResult {
	content: string;
	ok: boolean;
	error?: string;
}

/**
 * MuPDF ships as an Emscripten module whose fd 1 and fd 2 sinks default to
 * `console.log` / `console.error` (`mupdf/dist/mupdf-wasm.js`:
 * `t.print&&(T=t.print),t.printErr&&(j=t.printErr)`), and
 * `mupdf/dist/mupdf.js` builds that module at import time from
 * `globalThis["$libmupdf_wasm_Module"]`. A PDF with a damaged `/FlateDecode`
 * stream therefore writes lines such as `zlib error: inflateInit2 failed`
 * straight to the terminal, and in a fullscreen session that lands in the
 * alternate screen and corrupts the frame. Capture them instead: the text is
 * real diagnostic value, it just must never reach a file descriptor.
 */
const MUPDF_MODULE_GLOBAL = "$libmupdf_wasm_Module";
const MAX_MUPDF_DIAGNOSTIC_LINES = 32;

// Process-global because the MuPDF module is: concurrent conversions may
// cross-attribute a line. The text is advisory suffix on an error message,
// never a decision input, so that imprecision is acceptable.
let mupdfDiagnostics: string[] = [];

function recordMupdfDiagnostic(line: string): void {
	const trimmed = line.trim();
	if (trimmed.length === 0) return;
	if (mupdfDiagnostics.length >= MAX_MUPDF_DIAGNOSTIC_LINES) mupdfDiagnostics.shift();
	mupdfDiagnostics.push(trimmed);
}

/** Must run before the first `import("markit-ai")`; mupdf reads the global at module evaluation. */
function captureMupdfDiagnostics(): void {
	const globals = globalThis as Record<string, unknown>;
	const existing = (globals[MUPDF_MODULE_GLOBAL] ?? {}) as Record<string, unknown>;
	globals[MUPDF_MODULE_GLOBAL] = { ...existing, print: recordMupdfDiagnostic, printErr: recordMupdfDiagnostic };
}

function withMupdfDiagnostics(message: string): string {
	if (mupdfDiagnostics.length === 0) return message;
	const detail = mupdfDiagnostics.join("; ");
	mupdfDiagnostics = [];
	return `${message} (mupdf: ${detail})`;
}

let markit: () => Markit | Promise<Markit> = async () => {
	captureMupdfDiagnostics();
	const promise = import("markit-ai").then(({ Markit }) => {
		const instance = new Markit();
		markit = () => instance;
		return instance;
	});
	markit = () => promise;
	return promise;
};

function normalizeExtension(extension: string): string {
	const trimmed = extension.trim().toLowerCase();
	return trimmed ? (trimmed.startsWith(".") ? trimmed : `.${trimmed}`) : ".bin";
}

function normalizeError(error: unknown): string {
	return error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : "Conversion failed";
}

function abortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}

async function runMarkitConversion<T>(task: (markit: Markit) => Promise<T>, signal?: AbortSignal): Promise<T> {
	if (signal?.aborted) throw abortError();
	const instance = await markit();
	mupdfDiagnostics = [];
	if (!signal) return task(instance);
	return await new Promise<T>((resolve, reject) => {
		const abort = () => reject(abortError());
		signal.addEventListener("abort", abort, { once: true });
		void task(instance)
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
	});
}

function finalizeConversion(markdown?: string): MarkitConversionResult {
	if (typeof markdown === "string" && markdown.length > 0) {
		mupdfDiagnostics = [];
		return { content: markdown, ok: true };
	}
	return { content: "", ok: false, error: withMupdfDiagnostics("Conversion produced no output") };
}

export async function convertFileWithMarkit(filePath: string, signal?: AbortSignal): Promise<MarkitConversionResult> {
	try {
		return finalizeConversion(
			(await runMarkitConversion((instance) => instance.convertFile(filePath), signal)).markdown,
		);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw error;
		return { content: "", ok: false, error: withMupdfDiagnostics(normalizeError(error)) };
	}
}

export async function convertBufferWithMarkit(
	buffer: Uint8Array,
	extension: string,
	signal?: AbortSignal,
): Promise<MarkitConversionResult> {
	const normalizedExtension = normalizeExtension(extension);
	const streamInfo: StreamInfo = { extension: normalizedExtension, filename: `input${normalizedExtension}` };
	try {
		return finalizeConversion(
			(await runMarkitConversion((instance) => instance.convert(Buffer.from(buffer), streamInfo), signal)).markdown,
		);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw error;
		return { content: "", ok: false, error: withMupdfDiagnostics(normalizeError(error)) };
	}
}
