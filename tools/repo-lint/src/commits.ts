import { COPY_RULES } from "./rules.ts";
import { lintText, type Finding } from "./lint.ts";

export interface Commit {
  readonly sha: string;
  readonly authorEmail: string;
  readonly committerEmail: string;
  readonly message: string;
}

/** Commit author must be on the list; GitHub may be the committer of web merges. */
export function checkCommits(commits: readonly Commit[], authors: readonly string[]): string[] {
  const errors: string[] = [];
  for (const c of commits) {
    const short = c.sha.slice(0, 8);
    if (!authors.includes(c.authorEmail)) errors.push(`${short} author ${c.authorEmail} is not allowed`);
    const allowedCommitter = authors.includes(c.committerEmail) || c.committerEmail === "noreply@github.com";
    if (!allowedCommitter) errors.push(`${short} committer ${c.committerEmail} is not allowed`);
    for (const f of lintMeta(`commit ${short}`, c.message))
      errors.push(`${short} ${f.message} -> "${f.excerpt}"`);
  }
  return errors;
}

/** Lint free text such as a commit message or PR title and body. */
export function lintMeta(label: string, text: string): Finding[] {
  return lintText(label, text, COPY_RULES);
}

/** Parse `git log --format=%H%x1f%ae%x1f%ce%x1f%B%x1e` output. */
export function parseGitLog(out: string): Commit[] {
  return out
    .split("\x1e")
    .map((rec) => rec.replace(/^\n/u, ""))
    .filter((rec) => rec.trim() !== "")
    .map((rec) => {
      const [sha = "", authorEmail = "", committerEmail = "", message = ""] = rec.split("\x1f");
      return { sha, authorEmail, committerEmail, message };
    });
}
