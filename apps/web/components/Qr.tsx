import qrcode from "qrcode-generator";

/** The text as a QR code, drawn as one SVG path (no HTML strings, no data URL). */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r += 1)
    for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${String(c)},${String(r)}h1v1h-1z`;
  return { size: n, d };
}

export function Qr({ text, label }: { readonly text: string; readonly label: string }) {
  const { size, d } = qrPath(text);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`-2 -2 ${String(size + 4)} ${String(size + 4)}`}
      width="176"
      height="176"
      className="qr"
    >
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
