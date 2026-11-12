// The agent's own account, made in the browser.
//
// Two fresh ed25519 keys: the first one's public key is the account's name
// (a NEAR implicit account, which exists as soon as someone sends it NEAR);
// the second becomes a function-call key that can call only `spend` on the
// wallets contract. Once the owner has funded the account, setUp() signs
// one transaction with the first key that adds the second and deletes the
// first. After that the account cannot transfer, deploy, or call anything
// else: NEAR's protocol enforces it, not our code.
import { KeyPairEd25519, KeyPair } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { NET } from "../network.js";

const hexOf = (pk) => Array.from(pk.data, (b) => b.toString(16).padStart(2, "0")).join("");

export function newAgentKeys() {
  const setup = KeyPairEd25519.fromRandom(), spend = KeyPairEd25519.fromRandom();
  return { account: hexOf(setup.getPublicKey()), setupKey: setup.toString(), spendKey: spend.toString(), spendPublic: spend.getPublicKey().toString() };
}

export async function setUp(k, { allowance = 25n * 10n ** 22n } = {}) {
  const setup = KeyPair.fromString(k.setupKey), spend = KeyPair.fromString(k.spendKey);
  const acct = new Account(k.account, new JsonRpcProvider({ url: NET.rpc[0] }), new KeyPairSigner(setup));
  return acct.signAndSendTransaction({
    receiverId: k.account,
    actions: [
      actionCreators.addKey(spend.getPublicKey(), actionCreators.functionCallAccessKey(NET.wallets, ["spend"], allowance)),
      actionCreators.deleteKey(setup.getPublicKey()),
    ],
    waitUntil: "FINAL",
  });
}

// What the agent runs to pay someone: a call only its function-call key can make.
export async function agentSpend(k, to, yocto) {
  const acct = new Account(k.account, new JsonRpcProvider({ url: NET.rpc[0] }), new KeyPairSigner(KeyPair.fromString(k.spendKey)));
  return acct.callFunctionRaw({ contractId: NET.wallets, methodName: "spend", args: { to, amount: String(yocto) }, deposit: 0n, gas: 70n * 10n ** 12n, waitUntil: "FINAL" });
}

export async function keysOn(account) {
  const r = await new JsonRpcProvider({ url: NET.rpc[0] }).query({ request_type: "view_access_key_list", account_id: account, finality: "final" });
  return r.keys.map((x) => ({ key: x.public_key, permission: x.access_key.permission }));
}
