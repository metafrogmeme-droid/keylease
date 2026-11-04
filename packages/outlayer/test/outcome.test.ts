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

describe("OutLayer request id", () => {
  const req = (data: unknown, event = "execution_requested") =>
    `EVENT_JSON:${JSON.stringify({ standard: "near-offshore", version: "1.0.0", event, data })}`;

  it("reads request_id from execution_requested (array or object data)", async () => {
    const { outlayerRequestId } = await import("../src/outcome.ts");
    expect(outlayerRequestId(["other", req([{ request_id: 8723, sender_id: "kl.testnet" }])])).toBe("8723");
    expect(outlayerRequestId([req({ request_id: "8724" })])).toBe("8724");
    expect(outlayerRequestId([req([{ request_id: 9 }], "execution_completed")])).toBe("9");
  });

  it("is null when no OutLayer event names one, and ignores other standards and junk", async () => {
    const { outlayerRequestId } = await import("../src/outcome.ts");
    expect(outlayerRequestId([])).toBeNull();
    expect(
      outlayerRequestId(["EVENT_JSON:{not json", req([{ success: true }], "execution_completed")]),
    ).toBeNull();
    expect(
      outlayerRequestId([
        `EVENT_JSON:${JSON.stringify({ standard: "keylease", event: "execution_requested", data: [{ request_id: 1 }] })}`,
      ]),
    ).toBeNull();
  });
});
