import { describe, expect, it } from "vitest";
import { completion } from "../src/outcome.ts";

const ev = (data: unknown) =>
  `EVENT_JSON:${JSON.stringify({ standard: "near-offshore", version: "1.0.0", event: "execution_completed", data })}`;

describe("execution_completed", () => {
  it("reads a failed run and its message (NEP-297 data array)", () => {
    expect(
      completion(["spike run requested", ev([{ success: false, error_message: "access denied" }])]),
    ).toEqual({
      success: false,
      error_message: "access denied",
    });
  });

  it("reads a successful run (data object)", () => {
    expect(completion([ev({ success: true, error_message: null })])?.success).toBe(true);
  });

  it("is undefined when the run never reached OutLayer", () => {
    expect(completion(["spike result: null"])).toBeUndefined();
    expect(
      completion([`EVENT_JSON:${JSON.stringify({ event: "execution_requested", data: [{}] })}`]),
    ).toBeUndefined();
  });
});
