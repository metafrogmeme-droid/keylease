/**
 * Copy rules. Patterns are written with a "·" splitter (removed by `w`) so this file never matches
 * its own rules and needs no allowlist entry.
 */
export interface Rule {
  readonly id: RuleId;
  readonly pattern: RegExp;
  readonly message: string;
}

export type RuleId = "banned-word" | "ai-label" | "verdict-wording" | "promo";

/** Build a case-insensitive regex from source with "·" splitters removed. */
export function w(source: string, flags = "iu"): RegExp {
  return new RegExp(source.replaceAll("·", ""), flags);
}

const TOOLS = "cl·aude|anth·ropic|chat·gpt|open·ai|co·pilot|cur·sor|gem·ini|co·dex|dev·in|ai·der";

export const COPY_RULES: readonly Rule[] = [
  {
    id: "banned-word",
    pattern: w(String.raw`\bsa·fe\w*`),
    message: "Banned word (docs/WORDING.md): describe the concrete mitigation instead.",
  },
  {
    id: "banned-word",
    pattern: w(String.raw`\bsc·am\w*`),
    message: "Banned word (docs/WORDING.md): describe the concrete threat instead.",
  },
  {
    id: "ai-label",
    pattern: w(String.raw`co-auth·ored-by:.*\b(${TOOLS})\b`),
    message: "Co-author trailer naming a tool.",
  },
  {
    id: "ai-label",
    pattern: w(String.raw`\bgener·ated\s+(with|by)\b.{0,40}\b(${TOOLS}|a·i|l·lm|g·pt)\b`),
    message: "Tool attribution label.",
  },
  {
    id: "ai-label",
    pattern: w(String.raw`\b(a·i|l·lm)[- ](gener·ated|writ·ten|auth·ored|assis·ted)\b`),
    message: "Tool attribution label.",
  },
  {
    id: "ai-label",
    pattern: w(String.raw`\bwrit·ten\s+(by|with)\s+(an?\s+)?(a·i|l·lm|${TOOLS})\b`),
    message: "Tool attribution label.",
  },
  {
    id: "ai-label",
    pattern: w(String.raw`no·reply@anth·ropic\.com|cl·aude\.(ai|com)/(code|claude-code)|cl·aude-session:`),
    message: "Tool attribution link or trailer.",
  },
  { id: "ai-label", pattern: new RegExp("\\u{1F916}", "u"), message: "Robot emoji label." },
  {
    id: "verdict-wording",
    pattern: w(String.raw`\b(allo·wed|blo·cked)\s+by\s+(your\s+)?(ru·le|pol·icy)\b`),
    message: "Verdict wording from another project; use lease vocabulary (docs/WORDING.md).",
  },
  {
    id: "verdict-wording",
    pattern: w(String.raw`\ballo·wed\s*/\s*blo·cked\b`),
    message: "Verdict wording from another project; use lease vocabulary (docs/WORDING.md).",
  },
  {
    id: "promo",
    pattern: w(String.raw`\$RC·LAW\b|\bprice\s+(tar·get|predic·tion)s?\b`),
    message: "No token promotion or price picks.",
  },
];

/** Marker that allows one rule on one line, e.g. `copy-lint-allow: banned-word`. */
export const LINE_ALLOW = /copy-lint-allow:\s*([a-z-]+(?:\s*,\s*[a-z-]+)*)/u;
