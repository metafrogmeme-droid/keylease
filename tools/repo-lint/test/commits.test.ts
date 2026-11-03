import { describe, expect, it } from "vitest";
import { checkCommits, parseGitLog } from "../src/commits.ts";

const j = (...parts: string[]): string => parts.join("");
const OK = "313699818+metafrogmeme-droid@users.noreply.github.com";
const commit = (over: Partial<{ authorEmail: string; committerEmail: string; message: string }> = {}) => ({
  sha: "0123456789abcdef",
  authorEmail: OK,
  committerEmail: OK,
  message: "Add lease quota checks\n",
  ...over,
});

describe("commit checks", () => {
  it("accepts the project author", () => {
    expect(checkCommits([commit()], [OK])).toEqual([]);
  });

  it("accepts GitHub as committer of web merges", () => {
    expect(checkCommits([commit({ committerEmail: "noreply@github.com" })], [OK])).toEqual([]);
  });

  it("rejects another author", () => {
    expect(checkCommits([commit({ authorEmail: "someone@example.com" })], [OK])[0]).toMatch(/author/u);
  });

  it("rejects a tool co-author trailer", () => {
    const message = j("Fix\n\nCo-Authored", "-By: Cl", "aude <x@y>\n");
    expect(checkCommits([commit({ message })], [OK])).toHaveLength(1);
  });

  it("parses git log records", () => {
    const out = `aaa\x1f${OK}\x1f${OK}\x1fFirst\n\nbody\n\x1e\nbbb\x1fx@y\x1fx@y\x1fSecond\n\x1e\n`;
    const list = parseGitLog(out);
    expect(list.map((c) => c.sha)).toEqual(["aaa", "bbb"]);
    expect(list[0]?.message).toContain("body");
  });
});
