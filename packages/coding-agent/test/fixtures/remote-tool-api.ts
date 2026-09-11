// PR #2482: compile the real adapters and their public write seam, not transport shims.
import type { WriteFileOptions, WriteOperations } from "@bastani/atomic";
// @ts-expect-error grep was removed from the public tool API; do not restore it for adapters.
import type { createGrepTool } from "@bastani/atomic";
// @ts-expect-error grep details are not a public compatibility API.
import type { GrepToolDetails } from "@bastani/atomic";
// @ts-expect-error grep input is not a public compatibility API.
import type { GrepToolInput } from "@bastani/atomic";

// Existing two-argument writers remain assignable; readFile is mandatory.
export const legacyWriter: WriteOperations = {
	readFile: async (_path: string) => undefined,
	mkdir: async (_path: string) => {},
	writeFile: async (_path: string, _content: string) => {},
};
export const exclusive: WriteFileOptions = { exclusive: true };
export const ordinary: WriteFileOptions = {};
// @ts-expect-error absence must be undefined, not null.
export const nullReader: WriteOperations["readFile"] = async () => null;
// @ts-expect-error a backend must implement reads in its own filesystem namespace.
export const missingReader: WriteOperations = { mkdir: async () => {}, writeFile: async () => {} };
// @ts-expect-error exclusive remains an optional boolean.
export const invalidExclusive: WriteFileOptions = { exclusive: "true" };
