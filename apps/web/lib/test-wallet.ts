/**
 * Test-only wallet for the Playwright timing test (brief §4: time to first lease ≤ 60 s). It is compiled
 * in only when the build sets NEXT_PUBLIC_KL_E2E=1 (lib/selector.ts); CI checks that the normal build does
 * not contain TEST_WALLET_MARKER. It signs nothing: it answers each transaction the way the chain would.
 */
export const TEST_WALLET_MARKER = "keylease-e2e-test-wallet";
export const TEST_ACCOUNT = "judge.testnet";

interface State {
  accounts: { accountId: string; active: boolean }[];
  selectedWalletId: string | null;
}

type Listener = (s: State) => void;

function outcome(value: unknown, n: number) {
  const json = value === undefined ? "" : btoa(JSON.stringify(value));
  return {
    status: { SuccessValue: json },
    transaction_outcome: { id: `${TEST_WALLET_MARKER}-tx-${String(n)}` },
  };
}

/** Enough of wallet-selector's `WalletSelector` for components/WalletProvider.tsx. */
export function createTestSelector() {
  let state: State = { accounts: [], selectedWalletId: null };
  const listeners = new Set<Listener>();
  const set = (s: State) => {
    state = s;
    for (const l of listeners) l(s);
  };
  let n = 0;
  let leases = 0;
  const wallet = {
    signIn: () => {
      set({ accounts: [{ accountId: TEST_ACCOUNT, active: true }], selectedWalletId: "my-near-wallet" });
      return Promise.resolve([]);
    },
    signOut: () => {
      set({ accounts: [], selectedWalletId: null });
      return Promise.resolve();
    },
    signAndSendTransactions: ({ transactions }: { transactions: { actions: unknown[] }[] }) =>
      Promise.resolve(
        transactions.map((tx) => {
          n += 1;
          const method = (tx.actions[0] as { functionCall?: { methodName?: string } }).functionCall
            ?.methodName;
          if (method === "create_lease") return outcome(String(leases++), n);
          if (method === "add_key") return outcome("0", n);
          if (method === "use_lease") return outcome({ ok: true, status: 200 }, n);
          return outcome(undefined, n);
        }),
      ),
  };
  return {
    store: {
      observable: {
        subscribe: (l: Listener) => {
          listeners.add(l);
          l(state);
          return { unsubscribe: () => listeners.delete(l) };
        },
      },
    },
    wallet: () => Promise.resolve(wallet),
  };
}
