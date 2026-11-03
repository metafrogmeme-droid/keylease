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
