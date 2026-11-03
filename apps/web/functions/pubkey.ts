/** Vercel edge function behind `/api/secrets/pubkey` (bundled by scripts/vercel-output.ts). */
import { relayPubkey } from "../lib/relay.ts";

export default function handler(req: Request): Promise<Response> {
  return relayPubkey(req);
}
