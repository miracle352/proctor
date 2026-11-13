// Sealing in the browser. A hunt's questions are encrypted here, on the
// hunter's own machine, to OutLayer's keystore, so the only thing that can
// read them is the grader build running inside secure hardware. Proctor's
// servers never see them. Same scheme as the outlayer CLI (ECIES v1):
// X25519 key agreement, HKDF-SHA256 with info "outlayer-keystore-v1",
// ChaCha20-Poly1305, sent as [0x01 | ephemeral key | nonce | ciphertext].
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { NET } from "../network.js";
export const OUTLAYER = NET.outlayer;
export const GRADER_PROJECT = NET.graderProject;
const KEYSTORE = NET.keystore;

// The keystore's key for this owner. The plaintext is never sent: the key
// does not depend on it, so the request carries "{}".
export async function keystoreKey(owner, profile) {
  const body = JSON.stringify({ accessor: { type: "Project", project_id: GRADER_PROJECT }, owner, profile, secrets_json: "{}" });
  const ask = (url) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }).then((r) => {
    if (!r.ok) throw new Error(`keystore answered ${r.status}`);
    return r.json();
  });
  // straight to OutLayer when the browser allows it, else through our relay,
  // which only ever sees this request, never the questions
  const j = await ask(KEYSTORE).catch(() => ask("/api/pubkey"));
  if (!/^[0-9a-f]{64}$/.test(j.pubkey || "")) throw new Error("OutLayer's keystore sent an unexpected key");
  return j.pubkey;
}

export function encrypt(pubHex, plaintext) {
  const eph = x25519.utils.randomSecretKey();
  const shared = x25519.getSharedSecret(eph, hexToBytes(pubHex));
  const key = hkdf(sha256, shared, undefined, utf8ToBytes("outlayer-keystore-v1"), 32);
  const nonce = randomBytes(12);
  const ct = chacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  const out = new Uint8Array(1 + 32 + 12 + ct.length);
  out[0] = 1; out.set(x25519.getPublicKey(eph), 1); out.set(nonce, 33); out.set(ct, 45);
  let s = ""; for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}

// The exact bytes the grader hashes: {"set_id":…,"items":[…]} with no spaces,
// the same as tools/seal_set.py. JSON.stringify writes non-ASCII as itself,
// like ensure_ascii=False.
export function setText(setId, items) {
  return JSON.stringify({ set_id: setId, items });
}

export const hashHex = (text) => bytesToHex(sha256(utf8ToBytes(text)));

// Everything the two transactions need: the OutLayer secret row (locked to
// the grader build, readable by any caller of it) and the hunt itself.
export async function sealHunt({ owner, setId, items, build }) {
  const text = setText(setId, items);
  const secrets = JSON.stringify({ PROCTOR_SET: text });
  const pub = await keystoreKey(owner, setId);
  const encrypted = encrypt(pub, secrets);
  // OutLayer charges storage at 0.00001 NEAR a byte; leave room for the row
  const storage = BigInt(encrypted.length + 2000) * 10n ** 19n;
  return {
    text, sha256: hashHex(text), pubkey: pub, storage,
    store: {
      accessor: { Project: { project_id: GRADER_PROJECT } }, profile: setId,
      encrypted_secrets_base64: encrypted, access: { WasmHash: { hash: build } }, vault_id: null,
    },
  };
}
