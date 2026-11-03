/** Read-only NEAR calls over JSON-RPC (testnet RPC only; the CSP allows nothing else). */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function b64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export async function view<T>(
  rpc: string,
  contractId: string,
  method: string,
  args: object = {},
  fetcher: Fetch = fetch,
): Promise<T> {
  const res = await fetcher(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kl",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: b64(JSON.stringify(args)),
      },
    }),
  });
  if (!res.ok) throw new Error(`RPC answered HTTP ${String(res.status)}`);
  const body = (await res.json()) as {
    result?: { result?: number[]; error?: string };
    error?: { cause?: { name?: string }; message?: string };
  };
  if (body.error)
    throw new Error(`${method}: ${body.error.cause?.name ?? body.error.message ?? "RPC error"}`);
  if (body.result?.error !== undefined) throw new Error(`${method}: ${body.result.error}`);
  const bytes = body.result?.result;
  if (!bytes) throw new Error(`${method}: empty answer`);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))) as T;
}
