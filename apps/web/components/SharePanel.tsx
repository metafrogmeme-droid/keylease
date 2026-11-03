"use client";
import { useState } from "react";
import { cliSnippet, leaseLink, mcpSnippet, sdkSnippet, type ShareInfo } from "../lib/snippets.ts";
import { Qr } from "./Qr.tsx";

/** One-click Share: link + QR + three copy buttons. Lease id only, never a key. */
export function SharePanel({ info }: { readonly info: ShareInfo }) {
  const [copied, setCopied] = useState<string | null>(null);
  const link = leaseLink(info);
  const items = [
    { name: "Link", text: link },
    { name: "SDK", text: sdkSnippet(info) },
    { name: "near CLI", text: cliSnippet(info) },
    { name: "MCP", text: mcpSnippet(info) },
  ];
  const copy = (name: string, text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(name);
      },
      () => {
        setCopied(null);
      },
    );
  };
  return (
    <div className="share" aria-label={`Share lease ${info.leaseId}`} role="group">
      <p>
        Lease <strong>{info.leaseId}</strong> for <code>{info.grantee}</code>. <a href={link}>{link}</a>
      </p>
      <Qr text={link} label={`QR code of the link to lease ${info.leaseId}`} />
      <div className="copies">
        {items.map((i) => (
          <button
            key={i.name}
            type="button"
            onClick={() => {
              copy(i.name, i.text);
            }}
          >
            Copy {i.name}
          </button>
        ))}
      </div>
      <p role="status" className="hint">
        {copied
          ? `${copied} copied. It holds the lease id, never the key.`
          : "Each snippet holds the lease id, never the key."}
      </p>
      <details>
        <summary>Show the snippets</summary>
        {items.slice(1).map((i) => (
          <pre key={i.name} aria-label={`${i.name} snippet`}>
            {i.text}
          </pre>
        ))}
      </details>
    </div>
  );
}
