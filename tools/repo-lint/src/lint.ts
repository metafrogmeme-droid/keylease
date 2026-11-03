import { COPY_RULES, LINE_ALLOW, type Rule, type RuleId } from "./rules.ts";

export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly rule: RuleId;
  readonly message: string;
  readonly excerpt: string;
}

export interface FileAllow {
  readonly path: string;
  readonly rules: readonly RuleId[];
  readonly reason: string;
}

/** Files that are never copy-linted: lockfiles are generated, not written copy. */
const SKIP = [/(^|\/)pnpm-lock\.yaml$/u, /(^|\/)Cargo\.lock$/u, /(^|\/)package-lock\.json$/u];

export function isSkipped(path: string): boolean {
  return SKIP.some((re) => re.test(path));
}

/** Lint one text. `fileAllowed` are rules switched off for the whole file. */
export function lintText(
  path: string,
  text: string,
  rules: readonly Rule[] = COPY_RULES,
  fileAllowed: readonly RuleId[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/u);
  lines.forEach((content, i) => {
    const lineAllowed = LINE_ALLOW.exec(content)?.[1]?.split(/\s*,\s*/u) ?? [];
    for (const rule of rules) {
      if (fileAllowed.includes(rule.id) || lineAllowed.includes(rule.id)) continue;
      const m = rule.pattern.exec(content);
      if (m) {
        findings.push({
          path,
          line: i + 1,
          rule: rule.id,
          message: rule.message,
          excerpt: m[0].slice(0, 60),
        });
      }
    }
  });
  return findings;
}

/** True when the buffer looks binary (has a NUL byte in the first 8 KB). */
export function isBinary(buf: Uint8Array): boolean {
  return buf.subarray(0, 8192).includes(0);
}

export function formatFinding(f: Finding): string {
  return `${f.path}:${String(f.line)}  [${f.rule}] ${f.message}  -> "${f.excerpt}"`;
}
