import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertFileWithMarkit } from "../src/utils/markit.ts";

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
	it("keeps mupdf's zlib chatter off every console sink and in the error instead", async () => {
		const dir = await tempDir();
		const path = join(dir, "broken.pdf");
		await writeFile(path, makeBrokenFlatePdf());

		const written: string[] = [];
		const collect = (...args: unknown[]) => {
			written.push(args.map((arg) => String(arg)).join(" "));
		};
		for (const sink of ["log", "info", "debug", "warn", "error"] as const) {
			vi.spyOn(console, sink).mockImplementation(collect);
		}

		const result = await convertFileWithMarkit(path);

		expect(written.filter((line) => /zlib/i.test(line))).toEqual([]);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/mupdf:/);
	}, 60_000);
});
