"""Run every question of some sets against one model, one question per run,
several runs at a time (one signer per worker so nonces never collide).

    python3 tools/run_all.py MODEL SET_ID[,SET_ID...] --runners FILE [--skip-done] [--workers N]

A reasoning model needs 40-60 s per answer and a NEAR contract waits about
two minutes for OutLayer, so one question per run is what fits.
--skip-done reads existing certificates and only asks what is missing.
OutLayer testnet has two executors that restart often, so a failed run is
put back on the queue up to three times. A failed run refunds the writers'
fee; only OutLayer's small base charge is lost.
"""

import json
import queue
import subprocess
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from report import view  # noqa: E402

CONTRACT = "app.proctor-91796.testnet"
HERE = Path(__file__).parent


def done_indexes(model, set_id):
    cfg = view(CONTRACT, "config", {})
    comparable = set(cfg.get("comparable") or [cfg["grader_version"]])
    start, done = 0, set()
    while True:
        batch = view(CONTRACT, "get_certificates", {"from": start, "limit": 50})
        for c in batch:
            if c["model"] == model and c["set_id"] == set_id and c["grader_version"] in comparable:
                for i, ch in enumerate(c["results"]):
                    if ch in "01":
                        done.add(c["start"] + i)
        if len(batch) < 50:
            return done
        start += 50


def main():
    args = sys.argv[1:]
    runners = Path(args[args.index("--runners") + 1]).read_text().split()
    skip = "--skip-done" in args
    workers = int(args[args.index("--workers") + 1]) if "--workers" in args else 2
    runners = runners[:workers]
    model, sets = args[0], args[1].split(",")

    jobs = queue.Queue()
    for sid in sets:
        size = view(CONTRACT, "get_set", {"set_id": sid})["size"]
        done = done_indexes(model, sid) if skip else set()
        for i in range(size):
            if i not in done:
                jobs.put((sid, i, 0))
    total = jobs.qsize()
    print(f"{model}: {total} questions across {len(sets)} sets, {len(runners)} workers", flush=True)

    lock = threading.Lock()
    tally = {"ok": 0, "wrong": 0, "failed": 0}

    def worker(signer):
        while True:
            try:
                sid, i, tries = jobs.get_nowait()
            except queue.Empty:
                return
            out = subprocess.run([sys.executable, "-I", str(HERE / "run.py"), sid, model, str(i), "1", "--as", signer],
                                 capture_output=True, text=True).stdout
            with lock:
                if "certificate" in out and "1/1" in out:
                    tally["ok"] += 1
                elif "certificate" in out:
                    tally["wrong"] += 1
                elif tries < 3:
                    jobs.put((sid, i, tries + 1))
                    continue
                else:
                    tally["failed"] += 1
                    print(f"  gave up on {sid}#{i}", flush=True)
                n = sum(tally.values())
                if n % 5 == 0 or n == total:
                    print(f"  {n}/{total}  {tally}", flush=True)

    threads = [threading.Thread(target=worker, args=(r,)) for r in runners]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print("done", tally)


if __name__ == "__main__":
    main()
