/** Reading OutLayer run outcomes from transaction logs. */
export interface Completed {
  success: boolean;
  error_message?: string | null;
}

/** The OutLayer `execution_completed` event (NEP-297 log), if the run got that far. */
export function completion(logs: readonly string[]): Completed | undefined {
  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    const ev = JSON.parse(log.slice("EVENT_JSON:".length)) as { event?: string; data?: unknown };
    if (ev.event !== "execution_completed") continue;
    const data = (Array.isArray(ev.data) ? ev.data[0] : ev.data) as Completed | undefined;
    if (data && typeof data.success === "boolean") return data;
  }
  return undefined;
}

/**
 * OutLayer's request id for a run, from its NEP-297 events (`standard: "near-offshore"`,
 * `execution_requested` or `execution_completed`), or null when no such event names one. Field names
 * tried in order: `request_id`, `requestId`, `id`.
 */
export function outlayerRequestId(logs: readonly string[]): string | null {
  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    let ev: { standard?: unknown; event?: unknown; data?: unknown };
    try {
      ev = JSON.parse(log.slice("EVENT_JSON:".length)) as typeof ev;
    } catch {
      continue;
    }
    if (ev.standard !== "near-offshore") continue;
    if (ev.event !== "execution_requested" && ev.event !== "execution_completed") continue;
    const d = (Array.isArray(ev.data) ? ev.data[0] : ev.data) as Record<string, unknown> | undefined;
    const id = d?.["request_id"] ?? d?.["requestId"] ?? d?.["id"];
    if (typeof id === "number" || (typeof id === "string" && id !== "")) return String(id);
  }
  return null;
}
