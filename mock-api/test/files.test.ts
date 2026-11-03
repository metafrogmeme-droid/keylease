import { describe, expect, it } from "vitest";
import { wasmFile } from "../src/files.ts";

describe("public wasm files", () => {
  it("serves flat .wasm names from the folder", () => {
    expect(wasmFile("/srv/wasm", "/wasm/keylease-proxy.wasm")).toBe("/srv/wasm/keylease-proxy.wasm");
  });

  it.each([
    "/wasm/../etc/passwd",
    "/wasm/a/b.wasm",
    "/wasm/.hidden.wasm",
    "/wasm/notes.txt",
    "/wasm/",
    "/v1/models",
    "/wasm/%2e%2e%2fsecret.wasm",
  ])("refuses %s", (path) => {
    expect(wasmFile("/srv/wasm", path)).toBeUndefined();
  });

  it("is off without WASM_DIR", () => {
    expect(wasmFile(undefined, "/wasm/keylease-proxy.wasm")).toBeUndefined();
  });
});
