/**
 * FastFS upload payload: Borsh of `FastfsData::Simple { relative_path, content: Some { mime_type, content } }`,
 * sent as the args of a `__fastdata_fastfs` call to the OutLayer contract. The file is then served at
 * https://test.fastfs.io/<signer>/<receiver>/<sha256>.wasm (testnet).
 */
export const FASTFS_METHOD = "__fastdata_fastfs";

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function borshBytes(bytes: Uint8Array): Buffer {
  return Buffer.concat([u32le(bytes.length), bytes]);
}

function borshString(s: string): Buffer {
  return borshBytes(Buffer.from(s, "utf8"));
}

export function fastfsPayload(sha256Hex: string, wasm: Uint8Array): Buffer {
  return Buffer.concat([
    Buffer.from([0]), // enum FastfsData::Simple
    borshString(`${sha256Hex}.wasm`),
    Buffer.from([1]), // Option::Some
    borshString("application/wasm"),
    borshBytes(wasm),
  ]);
}

export function fastfsUrl(signer: string, receiver: string, sha256Hex: string): string {
  return `https://test.fastfs.io/${signer}/${receiver}/${sha256Hex}.wasm`;
}
