"""Turn questions into the exact JSON string the grader reads, and print its
sha256. The hash is computed over these bytes and nothing else, so the
string written into the OutLayer secret must be this file, byte for byte.

    python3 tools/seal_set.py SET_ID items.jsonl out/SET_ID.json

Each line of items.jsonl:
    {"id": "q1", "author": "alice.testnet", "prompt": "...",
     "answer": {"kind": "number", "value": 42, "tol": 0}}
or  {"answer": {"kind": "exact", "value": "Lisbon"}}

Twins from make_twins.py can be split with --from-pairs original|twin.
"""

import hashlib
import json
import sys
from pathlib import Path


def load_items(path, side=None, author=None):
    items = []
    for i, line in enumerate(Path(path).read_text().splitlines()):
        if not line.strip():
            continue
        row = json.loads(line)
        if side:
            q = row[side]
            items.append({
                "id": f"{row['template']}",
                "author": author,
                "prompt": q["prompt"],
                "answer": {"kind": "number", "value": q["value"], "tol": 0},
            })
        else:
            items.append(row)
    return items


def check(items):
    seen = set()
    for it in items:
        assert it["id"] not in seen, f"duplicate id {it['id']}"
        seen.add(it["id"])
        assert it["author"], f"{it['id']} has no author"
        kind = it["answer"]["kind"]
        assert kind in ("number", "exact"), f"{it['id']}: answer kind must be number or exact"
        if kind == "number":
            float(it["answer"]["value"])


def main():
    args = sys.argv[1:]
    side = author = None
    if "--from-pairs" in args:
        i = args.index("--from-pairs")
        side = args[i + 1]
        author = args[i + 2]
        del args[i:i + 3]
    set_id, src, out = args
    items = load_items(src, side, author)
    check(items)
    text = json.dumps({"set_id": set_id, "items": items}, separators=(",", ":"), ensure_ascii=False)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(text)
    digest = hashlib.sha256(text.encode()).hexdigest()
    authors = sorted({it["author"] for it in items})
    print(json.dumps({"set_id": set_id, "sha256": digest, "size": len(items), "authors": authors}))


if __name__ == "__main__":
    main()
