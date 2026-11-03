/**
 * A fake KeyLease + proxy + mock API, faithful to the rules the attacks probe: exact endpoint match,
 * quota, revoke, the tripwire on an answer that carries the key, and bearer redaction.
 */
import { TxFailed, type Sent, type Transport } from "@keylease/sdk";
import { REFUSALS } from "@keylease/sdk";

export interface FakeOptions {
  /** Break the proxy: answer /debug/headers instead of withholding it. */
  readonly leakHeaders?: boolean;
}

const panic = (code: string) =>
  JSON.stringify({ ExecutionError: `Smart contract panicked: ${code}: ${REFUSALS[code] ?? ""}` });

export function fakeChain(o: FakeOptions = {}) {
  const lease = { endpoints: [] as string[], total: 0, used: 0, revoked: false };
  let n = 0;
  const sent: string[] = [];
  const answer = (value: unknown, logs: string[] = []): Sent => ({
    hash: `FakeTx${String(++n)}`,
    value,
    logs,
  });
  const ok = (body: string, redacted = false) => ({
    v: 1,
    ok: true,
    status: 200,
    body,
    body_encoding: "utf8",
    body_sha256: "",
    redacted,
  });
  const transport: Transport = {
    account: "demo.testnet",
    view: () => Promise.reject(new Error("no views")),
    call: (_c, method, raw) => {
      const args = raw as Record<string, unknown>;
      sent.push(method);
      if (method === "create_lease") {
        lease.endpoints = args["endpoints"] as string[];
        lease.total = args["calls"] as number;
        return Promise.resolve(answer("5"));
      }
      if (method === "revoke") {
        lease.revoked = true;
        return Promise.resolve(answer(null));
      }
      // use_lease: the contract's check order (contracts/keylease/src/check.rs)
      const fail = (code: string) => Promise.reject(new TxFailed(`FakeTx${String(++n)}`, panic(code)));
      if (lease.revoked) return fail("lease_revoked");
      const endpoint = args["endpoint"] as string;
      if (!lease.endpoints.includes(endpoint)) return fail("endpoint_not_in_lease");
      if (lease.used >= lease.total) return fail("quota_used");
      lease.used += 1;
      if (endpoint === "/debug/headers")
        return Promise.resolve(
          answer(
            o.leakHeaders
              ? ok('{"authorization":"Bearer demo"}')
              : { v: 1, ok: false, error: "tripwire", hint: "" },
          ),
        );
      const body = typeof args["body"] === "string" ? args["body"] : "";
      return Promise.resolve(answer(ok(body.replace(/Bearer x+/gu, "[redacted]"), /Bearer x+/u.test(body))));
    },
  };
  return { transport, sent, lease };
}
