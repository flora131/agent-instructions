/** Existing maximum wait for an `ask` reply. */
export const ASK_REPLY_TIMEOUT_MS = 10 * 60 * 1000;
/** Bounded reconnect opportunity after the ask wait. */
export const RETRY_IDENTITY_RETRY_OPPORTUNITY_MS = 60 * 1000;
/** An operation identity covers the full ask wait plus reconnect recovery. */
export const RETRY_IDENTITY_TTL_MS = ASK_REPLY_TIMEOUT_MS + RETRY_IDENTITY_RETRY_OPPORTUNITY_MS;
/** Broker authority outlives client-held identities so a boundary retry cannot lose acceptance proof in transit. */
export const DELIVERED_MESSAGE_TTL_MS = RETRY_IDENTITY_TTL_MS + RETRY_IDENTITY_RETRY_OPPORTUNITY_MS;
/** Three reconnect attempts, used independently before initialization and during delivery. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000] as const;
