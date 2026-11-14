import { FAUCET_URL } from "../lib/config.ts";

/**
 * Collapsed-by-default help. Native <details>/<summary>, no client JS, no third-party assets.
 * Copy follows what the page actually does (AddKey, OnboardingStrip, LeaseList, PanicButton, config).
 */
export function HelpPanel() {
  return (
    <details className="rc-help">
      <summary>How it works / Help</summary>
      <div className="rc-help-body">
        <h2>Steps</h2>
        <ol>
          <li>
            <strong>Connect a wallet.</strong> Open Connect wallet and pick a NEAR wallet, WalletConnect (when
            it is configured) or MetaMask. This app talks only to NEAR testnet.
          </li>
          <li>
            <strong>Add a key.</strong> Paste an API key, choose a provider and a label, then confirm two
            transactions in your wallet. The key is encrypted in this browser to OutLayer&apos;s keystore
            before it leaves the page; only the sealed envelope is sent. Only the pinned proxy build, called
            by the KeyLease contract, can open it. The paste field is cleared after sealing; the key is not
            kept in page state, storage or logs.
          </li>
          <li>
            <strong>Share a lease.</strong> On a key, choose Share, pick a preset (or Custom) and confirm. You
            get a lease link, a QR code and copyable snippets. The link and snippets hold the lease id, never
            the key. The holder can make calls up to the quota, endpoints and expiry you set.
          </li>
          <li>
            <strong>Revoke.</strong> On an active lease, Revoke ends that lease. Revoke all for this key ends
            every lease on that key. The panic button (Revoke everything) ends every lease of your account on
            every key, after a second confirmation. The next call on a revoked lease is refused with
            lease_revoked.
          </li>
          <li>
            <strong>Testnet faucet.</strong> This app uses test tokens only. If you need testnet NEAR for gas,{" "}
            <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
              get some from the testnet faucet
            </a>
            .
          </li>
        </ol>
        <h2>FAQ</h2>
        <h3>Does the API key leave this device unencrypted?</h3>
        <p>
          No. It is encrypted in this browser to OutLayer&apos;s keystore before it leaves the page. Only the
          sealed envelope is sent. The plaintext key is read from the input once, then the field is cleared;
          it is not stored in page state, local storage or logs. Only the pinned proxy build, called by the
          KeyLease contract, can open the envelope.
        </p>
        <h3>Is this mainnet?</h3>
        <p>
          No. The banner at the top says TESTNET. The contract is a .testnet account, and tokens here have no
          real value. This page does not talk to NEAR mainnet.
        </p>
      </div>
    </details>
  );
}
