// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";
import { holderCallTx, suggestedModel } from "../lib/holdercall.ts";
import { fakeRpc } from "./fake-rpc.ts";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("id=7") }));
const { LeaseDetail } = await import("../components/LeaseDetail.tsx");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONTRACT = "keylease.testnet"; // apps/web/vitest.config.ts sets this contract id
const HOLDER = "0x0acca2862903d0415639316574a5286d42854ea8";
const lease = (over: Record<string, unknown> = {}) => ({
  lease_id: "7",
  key_id: "2",
  owner: "alice.testnet",
  grantee: HOLDER,
  calls_total: 3,
  calls_used: 0,
  calls_left: 3,
  expires_at: String(BigInt(Date.now() + 3 * 3_600_000) * 1_000_000n),
  endpoints: ["/messages"],
  status: "active",
  parent: null,
  depth: 0,
  issuer: "alice.testnet",
  ...over,
});

function wallet(accountId: string | null, send: WalletState["send"]): WalletState {
  return {
    ready: true,
    accountId,
    walletId: accountId ? "ethereum-wallets" : null,
    error: null,
    busy: false,
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    send,
  };
}

/** get_lease answers `before` until a call went out, then `after` (calls used up by one). */
function chain(before: Record<string, unknown>, after: Record<string, unknown> = before) {
  let called = false;
  const rpc = fakeRpc({
    get_lease: () => (called ? after : before),
    list_receipts: () => [],
    get_key: () => ({
      key_id: "2",
      provider: "AnthropicCompatible",
      base_url: "https://api.anthropic.com/v1",
      label: "demo",
    }),
  });
  vi.stubGlobal("fetch", rpc.fetcher);
  return {
    rpc,
    markCalled: () => {
      called = true;
    },
  };
}

function show(accountId: string | null, send: WalletState["send"]) {
  render(
    <WalletContext value={wallet(accountId, send)}>
      <LeaseDetail />
    </WalletContext>,
  );
}

const b64 = (v: unknown) => btoa(JSON.stringify(v));
const answer = {
  v: 1,
  ok: true,
  status: 200,
  body: "{}",
  body_encoding: "utf8",
  body_sha256: "ab".repeat(32),
};
const requested = (id: number) =>
  `EVENT_JSON:${JSON.stringify({ standard: "near-offshore", version: "1.0.0", event: "execution_requested", data: [{ request_id: id }] })}`;

describe("lease page: the holder makes a test call", () => {
  it("the call is one use_lease: a models listing as a GET when allowed, else a tiny POST with the model", () => {
    const fc = (tx: ReturnType<typeof holderCallTx>) => {
      const f = (tx.actions[0] as { functionCall: { methodName: string; args: Uint8Array; deposit: bigint } })
        .functionCall;
      return {
        m: f.methodName,
        args: JSON.parse(new TextDecoder().decode(f.args)) as Record<string, unknown>,
        deposit: f.deposit,
      };
    };
    // A models listing costs no tokens, so it is used when the lease allows one; else the first endpoint.
    expect(fc(holderCallTx(CONTRACT, "7", ["/messages", "/models"], "claude-haiku-5-5")).args).toEqual({
      lease_id: "7",
      endpoint: "/models",
      method: "GET",
    });
    const post = fc(holderCallTx(CONTRACT, "7", ["/messages", "/chat/completions"], "claude-haiku-5-5"));
    expect(post.m).toBe("use_lease");
    expect(post.args).toMatchObject({ lease_id: "7", endpoint: "/messages", method: "POST" });
    expect(JSON.parse(String(post.args["body"]))).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 16,
      messages: [{ role: "user", content: "Say hi in two words." }],
    });
    expect(post.deposit).toBe(25_000_000_000_000_000_000_000n);
    // No model given: the field is left out rather than invented.
    expect(
      JSON.parse(String(fc(holderCallTx(CONTRACT, "7", ["/chat/completions"], "  ")).args["body"])),
    ).not.toHaveProperty("model");
  });

  it("suggests a model per provider (the holder can change it); none where it cannot know one", () => {
    expect(suggestedModel("AnthropicCompatible", "https://api.anthropic.com/v1")).toBe("claude-haiku-5-5");
    expect(suggestedModel("OpenAiCompatible", "https://keylease.humanoid-traders.com/mock/v1")).toBe(
      "keylease-mock-1",
    );
    expect(suggestedModel("OpenAiCompatible", "https://api.openai.com/v1")).toBe("gpt-4o-mini");
    expect(suggestedModel("OpenAiCompatible", "https://llm.example/v1")).toBe("");
    expect(suggestedModel("NearAiCloud", "https://cloud-api.near.ai/v1")).toBe("");
    expect(suggestedModel("Custom", "https://api.example")).toBe("");
  });

  it("the holder of an active lease sees the button", async () => {
    chain(lease());
    show(HOLDER, vi.fn<WalletState["send"]>());
    expect(await screen.findByRole("button", { name: "Make a test call" })).toBeTruthy();
    expect(screen.getByText(/One call on \/messages/)).toBeTruthy();
    // The key is Anthropic-compatible: the model field is filled in, and editable.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(/Model/).value).toBe("claude-haiku-5-5");
    });
  });

  it("anyone else, or nobody signed in, sees no button and why", async () => {
    chain(lease());
    show("someone.testnet", vi.fn<WalletState["send"]>());
    expect(await screen.findByText(/Only the holder/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make a test call" })).toBeNull();
    cleanup();
    chain(lease());
    show(null, vi.fn<WalletState["send"]>());
    expect(await screen.findByText(/Connect the holder's wallet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make a test call" })).toBeNull();
  });

  it("an expired, revoked or used-up lease shows no button, with the reason", async () => {
    for (const [over, text] of [
      [{ status: "expired" }, /expired/],
      [{ status: "revoked" }, /revoked/],
      [{ status: "used_up", calls_used: 3, calls_left: 0 }, /no calls left/],
      [{ calls_left: 0 }, /no calls left/],
    ] as const) {
      chain(lease(over));
      show(HOLDER, vi.fn<WalletState["send"]>());
      expect(await screen.findByText(text, { selector: ".holder-call p" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Make a test call" })).toBeNull();
      cleanup();
    }
  });

  it("success: HTTP status, OutLayer request id, tx link and calls left, and the Calls list reloads", async () => {
    const c = chain(lease(), lease({ calls_used: 1, calls_left: 2 }));
    const send = vi.fn<WalletState["send"]>().mockImplementation(() => {
      c.markCalled();
      return Promise.resolve([
        {
          status: { SuccessValue: b64(answer) },
          transaction_outcome: { id: "TxCall", outcome: { logs: [] } },
          receipts_outcome: [{ outcome: { executor_id: "outlayer.testnet", logs: [requested(8723)] } }],
        },
      ]);
    });
    show(HOLDER, send);
    fireEvent.click(await screen.findByRole("button", { name: "Make a test call" }));
    const box = await screen.findByRole("status", { name: "Test call result" });
    await waitFor(() => {
      expect(box.textContent).toMatch(/HTTP 200/);
    });
    expect(box.textContent).toMatch(/OutLayer request 8723/);
    expect(box.textContent).toMatch(/2 calls left/);
    expect(screen.getByRole("link", { name: /use_lease tx TxCall/ }).getAttribute("href")).toBe(
      "https://testnet.nearblocks.io/txns/TxCall",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(c.rpc.calls.filter((x) => x.method === "list_receipts").length).toBeGreaterThan(0);
    expect(screen.getByText("1 used, 2 left of 3")).toBeTruthy();
  });

  it("a 0x holder: the wallet contract's envelope is unwrapped and the answer read from the contract receipt", async () => {
    const c = chain(lease(), lease({ calls_used: 1, calls_left: 2 }));
    const envelope = { success: true, success_value: [], error: null }; // "Result truncated" over 16 KiB
    const send = vi.fn<WalletState["send"]>().mockImplementation(() => {
      c.markCalled();
      return Promise.resolve([
        {
          status: { SuccessValue: b64(envelope) },
          transaction_outcome: { id: "TxEvm", outcome: { logs: [] } },
          receipts_outcome: [
            { outcome: { executor_id: "outlayer.testnet", logs: [requested(9001)] } },
            {
              outcome: {
                executor_id: CONTRACT,
                logs: [],
                status: { SuccessValue: b64({ ...answer, status: 201 }) },
              },
            },
            { outcome: { executor_id: HOLDER, logs: [], status: { SuccessValue: b64(envelope) } } },
          ],
        },
      ]);
    });
    show(HOLDER, send);
    fireEvent.click(await screen.findByRole("button", { name: "Make a test call" }));
    const box = await screen.findByRole("status", { name: "Test call result" });
    await waitFor(() => {
      expect(box.textContent).toMatch(/HTTP 201/);
    });
    expect(box.textContent).toMatch(/OutLayer request 9001/);
  });

  it("sends the model the holder typed, and shows an API 4xx as the API's answer, not a KeyLease failure", async () => {
    const c = chain(lease(), lease({ calls_used: 1, calls_left: 2 }));
    const rejected = {
      ...answer,
      status: 400,
      body: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "model: Field required" },
      }),
    };
    const send = vi.fn<WalletState["send"]>().mockImplementation(() => {
      c.markCalled();
      return Promise.resolve([
        { status: { SuccessValue: b64(rejected) }, transaction_outcome: { id: "Tx400" } },
      ]);
    });
    show(HOLDER, send);
    await screen.findByRole("button", { name: "Make a test call" });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(/Model/).value).toBe("claude-haiku-5-5");
    });
    fireEvent.change(screen.getByLabelText(/Model/), { target: { value: "claude-sonnet-5-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a test call" }));
    const box = await screen.findByRole("status", { name: "Test call result" });
    await waitFor(() => {
      expect(box.textContent).toMatch(
        /⚠ The proxy works; the API rejected the request: model: Field required/,
      );
    });
    expect(box.textContent).toMatch(/HTTP 400/);
    const f = (send.mock.calls[0]?.[0][0]?.actions[0] as { functionCall: { args: Uint8Array } }).functionCall;
    const sent = JSON.parse(new TextDecoder().decode(f.args)) as { body: string };
    expect(JSON.parse(sent.body)).toMatchObject({ model: "claude-sonnet-5-5" });
  });

  it("error: a refusal or a declined wallet is shown plainly, and the button comes back", async () => {
    chain(lease());
    const send = vi
      .fn<WalletState["send"]>()
      .mockRejectedValue(
        new Error(
          "Smart contract panicked: quota_used: All calls in this lease are used; ask the key owner for more calls.",
        ),
      );
    show(HOLDER, send);
    fireEvent.click(await screen.findByRole("button", { name: "Make a test call" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/^quota_used: /);
    });
    expect(screen.getByRole("button", { name: "Make a test call" })).toBeTruthy();
  });

  it("an answer without an OutLayer event still shows the status and says where the id is", async () => {
    const c = chain(lease(), lease({ calls_used: 1, calls_left: 2 }));
    const send = vi.fn<WalletState["send"]>().mockImplementation(() => {
      c.markCalled();
      return Promise.resolve([
        { status: { SuccessValue: b64({ ...answer, status: 404 }) }, transaction_outcome: { id: "TxX" } },
      ]);
    });
    show(HOLDER, send);
    fireEvent.click(await screen.findByRole("button", { name: "Make a test call" }));
    const box = await screen.findByRole("status", { name: "Test call result" });
    await waitFor(() => {
      expect(box.textContent).toMatch(/HTTP 404/);
    });
    expect(box.textContent).toMatch(/request id: see the tx/);
  });
});
