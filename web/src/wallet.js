// NEAR wallet connection through the standard wallet selector, on testnet.
import "./polyfill.js";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { CONTRACT, NETWORK } from "./chain.js";

let selector, modal;
const listeners = new Set();
let current = null;

export async function initWallet() {
  selector = await setupWalletSelector({
    network: NETWORK,
    modules: [setupMyNearWallet(), setupMeteorWallet(), setupHereWallet(), setupIntearWallet()],
  });
  modal = setupModal(selector, { contractId: CONTRACT, description: "Connect a NEAR testnet account to run and record exams. It costs nothing real." });
  const pick = (s) => s.accounts.find((a) => a.active)?.accountId || null;
  current = pick(selector.store.getState());
  selector.store.observable.subscribe((s) => {
    const next = pick(s);
    if (next !== current) { current = next; listeners.forEach((f) => f(current)); }
  });
  return current;
}

export const account = () => current;
export const onAccount = (f) => { listeners.add(f); f(current); };
export const connect = () => modal.show();
export async function disconnect() {
  const w = await selector.wallet();
  await w.signOut();
}

const call = (methodName, args, deposit, gas = "300000000000000") => ({
  type: "FunctionCall",
  params: { methodName, args, gas, deposit: deposit.toString() },
});

// Sends one transaction per call. Browser wallets (MyNearWallet) leave the
// page and come back with ?transactionHashes=…; the others resolve here.
export async function send(calls, callbackUrl) {
  const w = await selector.wallet();
  const transactions = calls.map(([method, args, deposit, gas]) => ({
    signerId: current, receiverId: CONTRACT, actions: [call(method, args, deposit, gas)],
  }));
  const out = await w.signAndSendTransactions({ transactions, callbackUrl });
  return (out || []).map((o) => o?.transaction?.hash || o?.transaction_outcome?.id).filter(Boolean);
}
