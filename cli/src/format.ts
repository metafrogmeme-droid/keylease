/** Output: one fixed `label  value` line per fact, so docs/VERIFY.md can state what to expect. */
export function line(label: string, value: string): string {
  return `${label.padEnd(10)} ${value}`;
}

export const txLink = (hash: string): string => `https://testnet.nearblocks.io/txns/${hash}`;

/** A KeyLease refusal (`<code>: <hint>`) inside a failed transaction's error text, if there is one. */
export function refusal(failure: string): { code: string; hint: string } | undefined {
  const m = /panicked: ([a-z_]+): ([^"\\]+)/u.exec(failure);
  return m ? { code: m[1] ?? "", hint: (m[2] ?? "").trim() } : undefined;
}

/** The `call` number from KeyLease's `call_authorized` event. */
export function callNumber(logs: readonly string[]): number | undefined {
  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    const ev = JSON.parse(log.slice("EVENT_JSON:".length)) as {
      standard?: string;
      event?: string;
      data?: { call?: number }[];
    };
    if (ev.standard === "keylease" && ev.event === "call_authorized") return ev.data?.[0]?.call;
  }
  return undefined;
}

/** First `max` characters of a text, on one line. */
export function short(text: string, max = 300): string {
  const one = text.replace(/\s+/gu, " ");
  return one.length > max ? `${one.slice(0, max)}…` : one;
}
