/** `.env.example` holds names only: every entry is `NAME=` with an empty value. */
export function checkEnvExample(text: string): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/u).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    const where = `.env.example:${String(i + 1)}`;
    if (!m) {
      errors.push(`${where} is not NAME=`);
      return;
    }
    const [, name = "", value = ""] = m;
    if (value !== "") errors.push(`${where} ${name} has a value; names only`);
    if (seen.has(name)) errors.push(`${where} ${name} is listed twice`);
    seen.add(name);
  });
  if (seen.size === 0) errors.push(".env.example lists no names");
  return errors;
}

/** No real env file may be tracked; only `.env.example`. */
export function checkTrackedEnvFiles(paths: readonly string[]): string[] {
  return paths
    .filter((p) => /(^|\/)\.env(\.[^/]+)?$/u.test(p) && !p.endsWith(".env.example"))
    .map((p) => `${p} is tracked; env files must stay local`);
}
