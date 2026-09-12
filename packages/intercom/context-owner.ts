import type { ExtensionContext } from "@bastani/atomic";

// Private bridge populated by the host's runner-context.ts. A builtin-local
// reader works in the installed layout and across separately evaluated bundles.
const CONTEXT_OWNERS_KEY = Symbol.for("atomic-coding-agent/extension-context-owners@1");

export function getExtensionContextOwner(context: ExtensionContext): object {
	const owners = (globalThis as typeof globalThis & { [CONTEXT_OWNERS_KEY]?: WeakMap<ExtensionContext, object> })[
		CONTEXT_OWNERS_KEY
	];
	// Unknown/older hosts retain context identity; never touch guarded getters.
	return owners?.get(context) ?? context;
}
