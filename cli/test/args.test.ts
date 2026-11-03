import { describe, expect, it } from "vitest";
import { parse } from "../src/args.ts";
import { one } from "../src/commands.ts";

describe("flags, parsed with the CLI's own option table", () => {
  it("kl call --endpoint X gives call() the one endpoint (regression: it said --endpoint is required)", () => {
    const { positionals, values } = parse(["call", "--lease", "1", "--endpoint", "/v1/chat/completions"]);
    expect(positionals).toEqual(["call"]);
    expect(one(values, "endpoint")).toBe("/v1/chat/completions");
    expect(one(values, "lease")).toBe("1");
  });

  it("kl call refuses a missing or a second --endpoint, plainly", () => {
    expect(() => one(parse(["call", "--lease", "1"]).values, "endpoint")).toThrow("--endpoint is required");
    expect(() => one(parse(["call", "--endpoint", "/a", "--endpoint", "/b"]).values, "endpoint")).toThrow(
      "give --endpoint once",
    );
  });

  it("kl lease still takes --endpoint more than once", () => {
    const { values } = parse(["lease", "--endpoint", "/a", "--endpoint", "/b"]);
    expect(values["endpoint"]).toEqual(["/a", "/b"]);
  });

  it("defaults apply and a string flag passes through", () => {
    const { values } = parse(["call", "--method", "GET"]);
    expect(one(values, "method", "POST")).toBe("GET");
    expect(one(values, "deposit", "0.025")).toBe("0.025");
  });
});
