"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Action, WalletSelector } from "@near-wallet-selector/core";
import { config } from "../lib/config.ts";
import { createSelector } from "../lib/selector.ts";
import type { WalletId } from "../lib/wallets.ts";

export interface WalletState {
  /** False until the selector has loaded in the browser. */
  readonly ready: boolean;
  readonly accountId: string | null;
  readonly walletId: string | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly connect: (id: WalletId) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  /** Sign and send with the connected wallet; returns final outcomes (none when the wallet redirects away). */
  readonly send: (txs: readonly Tx[]) => Promise<unknown[]>;
}

/** The transaction hash of a final outcome. */
export function txHash(outcome: unknown): string | null {
  const id = (outcome as { transaction_outcome?: { id?: unknown } } | null)?.transaction_outcome?.id;
  return typeof id === "string" ? id : null;
}

export interface Tx {
  readonly receiverId: string;
  readonly actions: Action[];
}

const idle = async () => {
  /* not ready */
};

export const WalletContext = createContext<WalletState>({
  ready: false,
  accountId: null,
  walletId: null,
  error: null,
  busy: false,
  connect: idle,
  disconnect: idle,
  send: () => Promise.reject(new Error("Connect a wallet first.")),
});

export const useWallet = () => useContext(WalletContext);

/** How long a wallet gets to answer a sign-in before the app gives up and lets you try again. */
export const SIGN_IN_TIMEOUT_MS = 60_000;
export const SIGN_IN_TIMEOUT_TEXT =
  "The wallet did not answer within 60 seconds. Close its window or app and try again.";

class SignInTimeout extends Error {}

/** `p`, or a SignInTimeout after `ms`. The wallet's own promise is left to settle on its own. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SignInTimeout(SIGN_IN_TIMEOUT_TEXT));
    }, ms);
  });
  return Promise.race([p, late]).finally(() => {
    clearTimeout(timer);
  });
}

/** Plain-language error for a failed connect; wallet messages can be long or technical. */
export function connectError(e: unknown): string {
  if (e instanceof SignInTimeout) return SIGN_IN_TIMEOUT_TEXT;
  const text = e instanceof Error ? e.message : String(e);
  if (/reject|cancel|closed/i.test(text)) return "The wallet closed or the request was declined. Try again.";
  if (/not (installed|detected|found)|no injected/i.test(text) || /ethereum/i.test(text))
    return "No wallet answered. Install or unlock it, then try again.";
  return `The wallet could not connect: ${text.slice(0, 160)}`;
}

export function WalletProvider({
  children,
  signInTimeoutMs = SIGN_IN_TIMEOUT_MS,
}: {
  readonly children: ReactNode;
  /** Tests only; the app uses SIGN_IN_TIMEOUT_MS. */
  readonly signInTimeoutMs?: number;
}) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    let sub: { unsubscribe: () => void } | null = null;
    createSelector(config).then(
      (s) => {
        if (!live) return;
        setSelector(s);
        sub = s.store.observable.subscribe((st) => {
          setAccountId(st.accounts.find((a) => a.active)?.accountId ?? null);
          setWalletId(st.selectedWalletId);
        });
      },
      (e: unknown) => {
        if (live) setError(`Wallets could not load: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
    return () => {
      live = false;
      sub?.unsubscribe();
    };
  }, []);

  const connect = useCallback(
    async (id: WalletId) => {
      if (!selector) return;
      setError(null);
      setBusy(true);
      try {
        const wallet = await selector.wallet(id);
        await withTimeout(
          wallet.signIn({ contractId: config.contractId, methodNames: [], accounts: [] }),
          signInTimeoutMs,
        );
      } catch (e) {
        setError(connectError(e));
      } finally {
        setBusy(false);
      }
    },
    [selector, signInTimeoutMs],
  );

  const disconnect = useCallback(async () => {
    if (!selector) return;
    setError(null);
    try {
      await (await selector.wallet()).signOut();
    } catch (e) {
      setError(connectError(e));
    }
  }, [selector]);

  const send = useCallback(
    async (txs: readonly Tx[]) => {
      if (!selector) throw new Error("Connect a wallet first.");
      const out = await (await selector.wallet()).signAndSendTransactions({ transactions: [...txs] });
      return out ?? [];
    },
    [selector],
  );

  const value = useMemo<WalletState>(
    () => ({ ready: selector !== null, accountId, walletId, error, busy, connect, disconnect, send }),
    [selector, accountId, walletId, error, busy, connect, disconnect, send],
  );
  return <WalletContext value={value}>{children}</WalletContext>;
}
