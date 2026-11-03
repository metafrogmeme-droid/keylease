/** Settings from env, with the testnet-only guards. Keys stay in env; nothing here prints them. */
export interface Settings {
  readonly rpc: string;
  readonly outlayer: string;
  readonly api: string;
  readonly account: string | undefined;
  readonly privateKey: string | undefined;
  readonly contract: string | undefined;
}

type Env = Readonly<Record<string, string | undefined>>;

const testnetId = (id: string): boolean => /^[a-z0-9._-]+\.testnet$/u.test(id);

export function settings(env: Env): Settings {
  const account = env["NEAR_ACCOUNT_ID"] || undefined;
  const outlayer = env["OUTLAYER_CONTRACT_ID"] || "outlayer.testnet";
  const contract = env["KEYLEASE_CONTRACT_ID"] || (account ? `keylease.${account}` : undefined);
  for (const [name, id] of [
    ["NEAR_ACCOUNT_ID", account],
    ["OUTLAYER_CONTRACT_ID", outlayer],
    ["KEYLEASE_CONTRACT_ID", contract],
  ] as const) {
    if (id !== undefined && !testnetId(id))
      throw new Error(`${name} must be a .testnet account (testnet only)`);
  }
  return {
    rpc: env["NEAR_RPC_URL"] || "https://rpc.testnet.near.org",
    outlayer,
    api: env["OUTLAYER_API_BASE"] || "https://testnet-api.outlayer.ai",
    account,
    privateKey: env["NEAR_PRIVATE_KEY"] || undefined,
    contract,
  };
}

/** `30m`, `1h`, `7d` → nanoseconds. */
export function durationNs(text: string): bigint {
  const m = /^(\d+)([mhd])$/u.exec(text);
  if (!m) throw new Error(`duration must look like 30m, 1h or 7d, got "${text}"`);
  const minutes = { m: 1n, h: 60n, d: 1440n }[m[2] as "m" | "h" | "d"];
  return BigInt(m[1] ?? "0") * minutes * 60_000_000_000n;
}
