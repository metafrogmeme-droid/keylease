import { Suspense } from "react";
import { LeaseDetail } from "../../components/LeaseDetail.tsx";

export const metadata = { title: "Lease (testnet) · KeyLease" };

export default function LeasePage() {
  return (
    <Suspense fallback={<p className="hint">Loading…</p>}>
      <LeaseDetail />
    </Suspense>
  );
}
