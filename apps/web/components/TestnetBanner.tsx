/** Always on screen: this app only talks to NEAR testnet (T9). */
export function TestnetBanner({ contractId }: { readonly contractId: string }) {
  return (
    <div className="banner" role="note" aria-label="Network">
      <strong>TESTNET</strong> · contract <code>{contractId}</code> · test tokens only, no real value
    </div>
  );
}
