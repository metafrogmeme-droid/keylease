/** A fake NEAR RPC for component tests: answers view calls by method name. */
import { vi } from "vitest";

export function fakeRpc(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const fetcher = vi.fn((_url: string, init?: RequestInit) => {
    const { params } = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      params: { method_name: string; args_base64: string };
    };
    const args = JSON.parse(atob(params.args_base64)) as Record<string, unknown>;
    calls.push({ method: params.method_name, args });
    const answer = answers[params.method_name];
    if (!answer)
      return Promise.resolve(new Response(JSON.stringify({ error: { message: "unknown method" } })));
    const bytes = [...new TextEncoder().encode(JSON.stringify(answer(args)))];
    return Promise.resolve(new Response(JSON.stringify({ result: { result: bytes } })));
  });
  return { fetcher, calls };
}
