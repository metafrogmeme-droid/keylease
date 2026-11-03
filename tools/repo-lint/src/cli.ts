#!/usr/bin/env node
// Usage: node tools/repo-lint/src/cli.ts <copy [files...] | env | commits <range> | text>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkCommits, lintMeta, parseGitLog } from "./commits.ts";
import { checkEnvExample, checkTrackedEnvFiles } from "./env.ts";
import { formatFinding, isBinary, isSkipped, lintText, type FileAllow, type Finding } from "./lint.ts";

interface AllowConfig {
  readonly files: readonly FileAllow[];
  readonly commitAuthors: readonly string[];
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const allow = JSON.parse(readFileSync(join(root, "tools/repo-lint/allow.json"), "utf8")) as AllowConfig;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function repoFiles(): string[] {
  return git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
}

function fail(lines: readonly string[], what: string): never {
  for (const l of lines) console.error(l);
  console.error(`\n${what}: ${String(lines.length)} problem(s).`);
  process.exit(1);
}

function copy(files: readonly string[]): void {
  for (const a of allow.files) {
    if (!existsSync(join(root, a.path))) fail([`allow.json lists missing file ${a.path}`], "copy-lint");
    if (a.reason.trim() === "") fail([`allow.json entry ${a.path} has no reason`], "copy-lint");
  }
  const findings: Finding[] = [];
  let checked = 0;
  for (const path of files) {
    const abs = join(root, path);
    if (isSkipped(path) || !existsSync(abs)) continue;
    const buf = readFileSync(abs);
    if (isBinary(buf)) continue;
    checked += 1;
    const fileAllowed = allow.files.find((a) => a.path === path)?.rules ?? [];
    findings.push(...lintText(path, buf.toString("utf8"), undefined, fileAllowed));
  }
  if (findings.length > 0) fail(findings.map(formatFinding), "copy-lint");
  console.warn(`copy-lint: ${String(checked)} files clean.`);
}

function env(): void {
  const errors = [
    ...checkEnvExample(readFileSync(join(root, ".env.example"), "utf8")),
    ...checkTrackedEnvFiles(repoFiles()),
  ];
  if (errors.length > 0) fail(errors, "env-lint");
  console.warn("env-lint: .env.example holds names only; no env files tracked.");
}

function commits(range: string): void {
  const log = git(["log", "--no-merges", "--format=%H%x1f%ae%x1f%ce%x1f%B%x1e", range]);
  const list = parseGitLog(log);
  const errors = checkCommits(list, allow.commitAuthors);
  if (errors.length > 0) fail(errors, "commit-lint");
  console.warn(`commit-lint: ${String(list.length)} commit(s) in ${range} clean.`);
}

function text(): void {
  const findings = lintMeta("stdin", readFileSync(0, "utf8"));
  if (findings.length > 0) fail(findings.map(formatFinding), "text-lint");
  console.warn("text-lint: clean.");
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "copy":
    copy(rest.length > 0 ? rest : repoFiles());
    break;
  case "env":
    env();
    break;
  case "commits":
    commits(rest[0] ?? "origin/main..HEAD");
    break;
  case "text":
    text();
    break;
  default:
    fail([`unknown command ${cmd ?? "(none)"}; use copy | env | commits <range> | text`], "repo-lint");
}
