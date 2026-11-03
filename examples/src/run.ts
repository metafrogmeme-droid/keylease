/**
 * Runs the attacks against a fresh lease and returns one row per attack. Only codes, HTTP status and
 * transaction links are kept: never a response body (if the key ever leaked, it would be in a body).
 */
import { KeyLeaseError, lease, type Transport } from "@keylease/sdk";
import { ATTACKS, LEASE_CALLS, LEASE_ENDPOINTS, expectText, type Attack } from "./cases.ts";

const TGAS = 50;
const LEASE_DEPOSIT = 50_000_000_000_000_000_000_000n;

export interface Row {
  readonly id: string;
  readonly injected: string;
  readonly tried: string;
  readonly expected: string;
  readonly actual: string;
  readonly tx: string | null;
  readonly pass: boolean;
}

export interface RunConfig {
  readonly contract: string;
  readonly keyId: string;
  /** Owner and lease holder are the same demo account (a lease to yourself, as in docs/VERIFY.md). */
  readonly transport: Transport;
  readonly now?: () => number;
}

async function one(
  a: Attack,
  l: ReturnType<typeof lease>,
): Promise<Omit<Row, "id" | "injected" | "tried" | "expected">> {
  try {
    const r = await l.call(a.endpoint, a.body?.(), { method: a.method });
    const actual = `answered HTTP ${String(r.status)}${r.redacted ? ", token redacted" : ""}`;
    const pass =
      "answered" in a.expect &&
      r.status >= 200 &&
      r.status < 300 &&
      (a.expect.redacted ?? false) === r.redacted;
    return { actual, tx: r.receipt.tx, pass };
  } catch (e) {
    if (!(e instanceof KeyLeaseError))
      return {
        actual: `error: ${e instanceof Error ? e.message.slice(0, 120) : "?"}`,
        tx: null,
        pass: false,
      };
    const pass = "refused" in a.expect && a.expect.refused === e.code;
    return { actual: `refused \`${e.code}\``, tx: e.receipt?.tx ?? null, pass };
  }
}

export async function runAttacks(cfg: RunConfig): Promise<{ leaseId: string; rows: Row[] }> {
  const now = cfg.now ?? Date.now;
  const expiresAt = (BigInt(now()) + 3_600_000n) * 1_000_000n;
  const created = await cfg.transport.call(
    cfg.contract,
    "create_lease",
    {
      key_id: cfg.keyId,
      grantee: cfg.transport.account,
      calls: LEASE_CALLS,
      expires_at: expiresAt.toString(),
      endpoints: [...LEASE_ENDPOINTS],
    },
    LEASE_DEPOSIT,
    TGAS,
  );
  const leaseId = String(created.value);
  const l = lease({ contract: cfg.contract, leaseId, transport: cfg.transport });
  const rows: Row[] = [];
  let revoked = false;
  for (const a of ATTACKS) {
    if (a.afterRevoke && !revoked) {
      await cfg.transport.call(cfg.contract, "revoke", { lease_id: leaseId }, 0n, 30);
      revoked = true;
    }
    rows.push({
      id: a.id,
      injected: a.injected,
      tried: `${a.method} ${a.endpoint}`,
      expected: expectText(a.expect),
      ...(await one(a, l)),
    });
  }
  return { leaseId, rows };
}
