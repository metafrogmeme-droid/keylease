import { Suspense } from "react";
import { HelpPanel } from "../../components/HelpPanel.tsx";
import { LeaseDetail } from "../../components/LeaseDetail.tsx";

export const metadata = { title: "Lease (testnet) · KeyLease" };

export default function LeasePage() {
  return (
    <>
      <HelpPanel />
      <Suspense fallback={<p className="hint">Loading…</p>}>
        <LeaseDetail />
      </Suspense>
    </>
  );
}
