const SITE = "https://www.humanoid-traders.com";

/** The RUNECLAW wordmark (official media-kit file) and the product name, at the top of every page. */
export function BrandHeader() {
  return (
    <header className="rc-appbar">
      <a className="rc-brand" href={SITE}>
        <img src="/runeclaw/runeclaw-wordmark.png" width="150" height="28" alt="RUNECLAW" />
      </a>
      <span className="rc-product">KeyLease</span>
      <nav className="rc-nav" aria-label="Company">
        <a href={SITE} target="_blank" rel="noopener noreferrer">
          humanoid-traders.com
        </a>
      </nav>
    </header>
  );
}

/** Company site link at the bottom of every page. */
export function BrandFooter() {
  return (
    <footer className="rc-footer">
      <a href={SITE} target="_blank" rel="noopener noreferrer">
        humanoid-traders.com
      </a>
    </footer>
  );
}
