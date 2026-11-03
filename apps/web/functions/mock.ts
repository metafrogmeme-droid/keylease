/** Vercel edge function behind `/mock/*`: the demo API (bundled by scripts/vercel-output.ts). */
import { serveMock } from "../lib/mock-edge.ts";

declare const process: { env: Record<string, string | undefined> } | undefined;

export default function handler(req: Request): Promise<Response> {
  return serveMock(req, { key: typeof process === "undefined" ? undefined : process.env["MOCK_API_KEY"] });
}
