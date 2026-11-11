/** The contract's `get_lease` view, and how the web app words it. */

export interface LeaseView {
  readonly lease_id: string;
  readonly key_id: string;
  readonly owner: string;
  readonly grantee: string;
  readonly calls_total: number;
  readonly calls_used: number;
  readonly calls_left: number;
  readonly expires_at: string;
  readonly endpoints: string[];
  readonly status: "active" | "revoked" | "expired" | "used_up";
  /** Sub-leases (PR 10b); absent on contracts from before it. */
  readonly parent?: string | null;
  readonly depth?: number;
  readonly issuer?: string;
  /** Highest nonce a signed call used (PR 11a); absent on contracts from before it. */
  readonly last_nonce?: string;
}

/** "in 3 h", "in 2 days", "5 min ago": plain time to or since a nanosecond timestamp. */
export function relative(ns: string, nowMs: number): string {
  const diff = Number(BigInt(ns) / 1_000_000n) - nowMs;
  const a = Math.abs(diff);
  const text =
    a < 3_600_000
      ? `${String(Math.max(1, Math.round(a / 60_000)))} min`
      : a < 172_800_000
        ? `${String(Math.round(a / 3_600_000))} h`
        : `${String(Math.round(a / 86_400_000))} days`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export const STATUS: Record<LeaseView["status"], string> = {
  active: "active",
  revoked: "revoked by the key owner",
  expired: "expired",
  used_up: "all calls used",
};
