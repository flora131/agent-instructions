export interface HerdrEnvironment {
	bin: string;
	paneId: string;
	socketPath: string;
}

export function captureHerdrEnvironment(env: NodeJS.ProcessEnv): HerdrEnvironment | undefined {
	if (env.HERDR_ENV !== "1" || !env.HERDR_BIN_PATH || !env.HERDR_PANE_ID || !env.HERDR_SOCKET_PATH) return undefined;
	return { bin: env.HERDR_BIN_PATH, paneId: env.HERDR_PANE_ID, socketPath: env.HERDR_SOCKET_PATH };
}
