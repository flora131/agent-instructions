import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertFileWithMarkit, setMarkitDiagnosticSink } from "../src/utils/markit.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "atomic-mupdf-console-"));
	tempDirs.push(dir);
	return dir;
}

const CONTENT = Buffer.from("BT /F1 12 Tf 20 100 Td (result) Tj ET\n", "latin1");

/**
 * A one-page PDF whose content stream declares `/FlateDecode` while storing raw,
 * undeflated bytes — the exact corruption MuPDF reports as `zlib error: …`.
 */
function makeBrokenFlatePdf(): Buffer {
	return Buffer.concat([
		Buffer.from(
			`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
				`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
				`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n` +
				`4 0 obj\n<< /Length ${CONTENT.length} /Filter /FlateDecode >>\nstream\n`,
			"latin1",
		),
		CONTENT,
		Buffer.from(`\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n`, "latin1"),
	]);
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("markit mupdf diagnostics", () => {
	// Regression #2964: retain malformed-PDF diagnostics through the selected output route.
	it("logs bounded mupdf diagnostics through console.log and retains the conversion error", async () => {
		const dir = await tempDir();
		const path = join(dir, "broken.pdf");
		await writeFile(path, makeBrokenFlatePdf());

		const written: string[] = [];
		const collect = (...args: unknown[]) => {
			written.push(args.map((arg) => String(arg)).join(" "));
		};
		const log = vi.spyOn(console, "log").mockImplementation(collect);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await convertFileWithMarkit(path);

		expect(written.some((line) => /zlib/i.test(line))).toBe(true);
		expect(log).toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/mupdf:/);
	});
	it("delivers malformed-PDF diagnostics to the interactive sink and restores console routing", async () => {
		const path = join(await tempDir(), "broken.pdf");
		await writeFile(path, makeBrokenFlatePdf());
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const messages: string[] = [];
		const dispose = setMarkitDiagnosticSink((message) => messages.push(message));
		try {
			const result = await convertFileWithMarkit(path);
			expect(result.ok).toBe(false);
			expect(messages.join("\n")).toMatch(/zlib/);
			expect(log).not.toHaveBeenCalled();
		} finally {
			dispose();
		}
		await convertFileWithMarkit(path);
		expect(log).toHaveBeenCalled();
	});
});
