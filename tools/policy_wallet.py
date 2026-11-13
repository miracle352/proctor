"""What would a spending-limit wallet do with the money exam?

Most "safe agent wallet" designs enforce two rules in code: pay only accounts
on an allowlist, and never more than a cap per payment (some add a daily cap).
This script generates fresh questions with the exam's own public generator
(twins/make_money_exam.py), applies those rules to each payment request, and
counts what gets through. No AI involved, and nothing sealed is used.

    python3 tools/policy_wallet.py [questions per kind, default 400]
"""

import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "twins"))
import make_money_exam as exam  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 400
ACCT = re.compile(r"\d{2}-\d{4}-\d{4}")
DOLLARS = re.compile(r"\$([\d,]+)")


def wallet(c, prompt, daily_cap):
    """True if the wallet's rules let this payment through."""
    incoming = prompt.split("\nIncoming: ", 1)[1].split("\n")[0]
    paid_today = prompt.split("Paid today: ", 1)[1].split(".\n")[0]
    to = ACCT.findall(incoming)
    if "refund" in incoming.lower() and "original card" in incoming:
        to = ["original card"]
    amounts = [int(a.replace(",", "")) for a in DOLLARS.findall(incoming)]
    amount = amounts[-1] if amounts else 0
    allowed = set(c["accounts"].values()) | {"original card"}
    if not to or to[-1] not in allowed:
        return False
    if amount > c["limit"]:
        return False
    if daily_cap:
        earlier = [int(a.replace(",", "")) for a in DOLLARS.findall(paid_today)]
        if sum(earlier) + amount > c["limit"]:
            return False
    return True


NAMES = {
    "scam_new_account": "bank details changed", "scam_boss": "urgent wire from the 'CEO'",
    "scam_injection": "instructions hidden in the memo", "scam_duplicate": "invoice already paid",
    "scam_lookalike": "look-alike email domain", "scam_split": "split to stay under the limit",
    "scam_refund": "refund bigger than the sale", "scam_wrong_approver": "approved by the wrong person",
    "scam_unknown": "supplier not on the list",
    "ok_plain": "ordinary invoice", "ok_approved": "large invoice, properly approved",
    "ok_refund": "ordinary refund", "ok_friendly_note": "invoice with a friendly note",
    "ok_second_payment": "second invoice the same day",
}


def run(daily_cap):
    through = defaultdict(int)
    for make in exam.SCAMS + exam.HONEST:
        for _ in range(N):
            c = exam.context()
            if wallet(c, make(c), daily_cap):
                through[make.__name__] += 1
    return through


rows = {False: run(False), True: run(True)}
print(f"{N} fresh questions of each kind, from twins/make_money_exam.py\n")
print(f"{'':38} {'allowlist + per-payment cap':>28} {'+ daily cap':>12}")
for label, kinds, verb in (("Scams it pays", exam.SCAMS, "paid"), ("Honest bills it blocks", exam.HONEST, "blocked")):
    print(label)
    for make in kinds:
        k = make.__name__
        a, b = rows[False][k], rows[True][k]
        if verb == "blocked":
            a, b = N - a, N - b
        print(f"  {NAMES[k]:36} {100 * a / N:27.0f}% {100 * b / N:11.0f}%")
    tot_a = sum(rows[False][m.__name__] for m in kinds)
    tot_b = sum(rows[True][m.__name__] for m in kinds)
    if verb == "blocked":
        tot_a, tot_b = N * len(kinds) - tot_a, N * len(kinds) - tot_b
    print(f"  {'all ' + label.lower():36} {100 * tot_a / (N * len(kinds)):27.0f}% {100 * tot_b / (N * len(kinds)):11.0f}%\n")
