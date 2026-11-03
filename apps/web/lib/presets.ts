/** Lease presets (brief §4) and the custom form's checks; the contract enforces the same limits. */

const HOUR_NS = 3_600n * 1_000_000_000n;

export interface Preset {
  readonly id: "agent" | "teammate" | "demo";
  readonly label: string;
  readonly calls: number;
  readonly hours: number;
}

export const PRESETS: readonly Preset[] = [
  { id: "agent", label: "My agent, 1 day, 100 calls", calls: 100, hours: 24 },
  { id: "teammate", label: "Teammate, 7 days, 500 calls", calls: 500, hours: 24 * 7 },
  { id: "demo", label: "Demo, 1 hour, 10 calls", calls: 10, hours: 1 },
];

/** Endpoints a preset lease gets, by provider; Custom keys need them typed in. */
export function defaultEndpoints(provider: string): string[] {
  if (provider === "AnthropicCompatible") return ["/messages"];
  if (provider === "Custom") return [];
  return ["/chat/completions"];
}

export const MAX_CALLS = 1_000_000;
export const MAX_HOURS = 365 * 24;
export const MAX_ENDPOINTS = 16;

const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/u;
const ENDPOINT = /^(\/[A-Za-z0-9._~-]+)+$/u;

export interface LeaseForm {
  readonly grantee: string;
  readonly calls: number;
  readonly hours: number;
  readonly endpoints: readonly string[];
}

/** What is wrong with the form, or null. Mirrors crates/keylease-rules (calls, expiry, endpoints). */
export function leaseProblem(f: LeaseForm): string | null {
  if (!ACCOUNT.test(f.grantee) || !f.grantee.endsWith(".testnet"))
    return "Grantee must be a .testnet account (EVM and Solana grantees come later)";
  if (!Number.isInteger(f.calls) || f.calls < 1 || f.calls > MAX_CALLS) return "Calls must be 1 to 1,000,000";
  if (!(f.hours > 0) || f.hours > MAX_HOURS) return "Expiry must be within 365 days";
  if (f.endpoints.length < 1) return "Give at least one endpoint, like /chat/completions";
  if (f.endpoints.length > MAX_ENDPOINTS) return "At most 16 endpoints";
  if (new Set(f.endpoints).size !== f.endpoints.length) return "Endpoints must be distinct";
  for (const e of f.endpoints)
    if (!ENDPOINT.test(e) || e.split("/").some((s) => s === "." || s === ".."))
      return `Endpoint ${e} is not a plain path`;
  return null;
}

/** Split a typed endpoint list ("/a, /b" or one per line). */
export function parseEndpoints(text: string): string[] {
  return text
    .split(/[\s,]+/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function expiresAtNs(nowMs: number, hours: number): bigint {
  return BigInt(nowMs) * 1_000_000n + BigInt(Math.round(hours * 3600)) * (HOUR_NS / 3600n);
}
