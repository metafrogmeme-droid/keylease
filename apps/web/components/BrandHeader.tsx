/** The RUNECLAW wordmark (official media-kit file) and the product name, at the top of every page. */
export function BrandHeader() {
  return (
    <header className="rc-appbar">
      <span className="rc-brand">
        <img src="/runeclaw/runeclaw-wordmark.png" width="150" height="28" alt="RUNECLAW" />
      </span>
      <span className="rc-product">KeyLease</span>
    </header>
  );
}
