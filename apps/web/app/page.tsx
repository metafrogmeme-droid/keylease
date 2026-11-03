import { OnboardingStrip } from "../components/OnboardingStrip.tsx";

export default function Home() {
  return (
    <>
      <h1>KeyLease</h1>
      <p className="lead">
        Lend the call, never the key. Your API key stays sealed in an enclave; agents and teammates get a
        lease with a call quota, endpoints and an expiry, and you can revoke it in one click.
      </p>
      <OnboardingStrip progress={{ connected: false, hasKey: false, hasLease: false }} />
    </>
  );
}
