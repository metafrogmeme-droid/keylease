/**
 * Form checks that mirror crates/keylease-rules, so the page can say what is wrong before a wallet opens.
 * The contract stays the authority; it refuses the same inputs.
 */
export const PROVIDERS = [
  { id: "NearAiCloud", name: "NEAR AI Cloud", baseUrl: "https://cloud-api.near.ai/v1" },
  { id: "OpenAiCompatible", name: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1" },
  { id: "AnthropicCompatible", name: "Anthropic-compatible", baseUrl: "https://api.anthropic.com/v1" },
  { id: "Custom", name: "Custom base URL", baseUrl: "" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

const SEGMENT = /^[A-Za-z0-9._~-]+$/u;

export function baseUrlProblem(url: string): string | null {
  if (!url.startsWith("https://")) return "Base URL must start with https://";
  if (url.length > 200) return "Base URL is too long";
  if (url.endsWith("/")) return "Base URL must not end with /";
  const rest = url.slice("https://".length);
  const host = rest.split("/")[0] ?? "";
  if (host === "") return "Base URL has no host";
  if (!/^[a-z0-9.:-]+$/u.test(host)) return "Host must be lowercase letters, digits, '-', '.', ':'";
  const path = rest.slice(host.length);
  for (const seg of path.split("/").slice(1))
    if (seg === "" || seg === "." || seg === ".." || !SEGMENT.test(seg))
      return "Base URL path is not allowed";
  return null;
}

export function labelProblem(label: string): string | null {
  return label.length >= 1 && label.length <= 64 && /^[\x20-\x7e]+$/u.test(label)
    ? null
    : "Label must be 1-64 printable ASCII characters";
}

/** A fresh OutLayer secret profile per key: letters, digits, '-' (OutLayer's rule). */
export function newProfile(
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
) {
  return `kl-${Array.from(random(6), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
