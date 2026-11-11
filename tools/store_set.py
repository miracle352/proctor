"""Store a sealed set as an OutLayer secret without the outlayer CLI.

The CLI attaches a fixed 0.1 NEAR storage deposit, which is too little for a
set with long questions. This does the same thing by hand: ask OutLayer's
keystore for its X25519 key, encrypt with ECIES v1 (X25519, HKDF-SHA256 with
info "outlayer-keystore-v1", ChaCha20-Poly1305), then call store_secrets on
the OutLayer contract with a deposit sized to the ciphertext. The row is
locked to one grader build and readable by any caller of that build.

The browser bounty page uses the same scheme.

    python3 tools/store_set.py SET_ID sealed.json OWNER PROJECT BUILD_HASH
"""

import base64
import json
import os
import subprocess
import sys
import urllib.request

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import serialization

API = os.environ.get("OUTLAYER_API", "https://testnet-api.outlayer.ai")
OUTLAYER = os.environ.get("OUTLAYER_CONTRACT", "outlayer.testnet")


def pubkey(project, owner, profile, secrets_json):
    body = json.dumps({"accessor": {"type": "Project", "project_id": project}, "owner": owner,
                       "profile": profile, "secrets_json": secrets_json}).encode()
    req = urllib.request.Request(f"{API}/secrets/pubkey", data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["pubkey"]


def encrypt(pub_hex, plaintext):
    eph = X25519PrivateKey.generate()
    shared = eph.exchange(X25519PublicKey.from_public_bytes(bytes.fromhex(pub_hex)))
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"outlayer-keystore-v1").derive(shared)
    nonce = os.urandom(12)
    ct = ChaCha20Poly1305(key).encrypt(nonce, plaintext.encode(), None)
    eph_pub = eph.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(b"\x01" + eph_pub + nonce + ct).decode()


def main():
    set_id, path, owner, project, build = sys.argv[1:6]
    secrets_json = json.dumps({"PROCTOR_SET": open(path).read()})
    enc = encrypt(pubkey(project, owner, set_id, secrets_json), secrets_json)
    # 0.00001 NEAR a byte, plus room for the row's other fields
    deposit = (len(enc) + 2000) * 10**19
    args = {"accessor": {"Project": {"project_id": project}}, "profile": set_id,
            "encrypted_secrets_base64": enc, "access": {"WasmHash": {"hash": build}}, "vault_id": None}
    out = subprocess.run(["near", "contract", "call-function", "as-transaction", OUTLAYER, "store_secrets",
                          "json-args", json.dumps(args), "prepaid-gas", "100 Tgas",
                          "attached-deposit", f"{deposit} yoctoNEAR", "sign-as", owner,
                          "network-config", "testnet", "sign-with-keychain", "send"],
                         capture_output=True, text=True)
    text = out.stdout + out.stderr
    ok = "succeeded" in text.lower() or "Transaction ID" in text and "Failure" not in text
    print(set_id, "stored" if ok else "FAILED", f"deposit {deposit / 1e24:.3f} NEAR")
    if not ok:
        print(text[-1500:])
        sys.exit(1)


if __name__ == "__main__":
    main()
