/**
 * Musebook Agent Kit: analytics are disabled.
 *
 * Upstream coinbase/agentkit posted usage events to a Coinbase endpoint. This fork sends
 * nothing anywhere: the function keeps its signature so call sites stay unchanged, and it
 * resolves immediately without any network I/O.
 */

/**
 * The shape of an analytics event (kept for API compatibility).
 */
type RequiredEventData = {
  action: string;
  component: string;
  name: string;
  timestamp?: number;
} & Record<string, string | undefined>;

/**
 * No-op analytics hook. Never performs network I/O.
 *
 * @param _event - Ignored event data
 * @returns A resolved promise
 */
export async function sendAnalyticsEvent(_event: RequiredEventData): Promise<void> {
  return;
}
