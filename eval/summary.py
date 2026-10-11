"""Mechanical scoreboard across eval outputs: reliability, not quality."""
import json, glob, os
rows = []
for f in sorted(glob.glob("eval/out/*.json")):
    d = json.load(open(f)); rs = d["results"]
    ok = [r for r in rs if not r.get("error")]
    words = sum(len(r["words"]) for r in ok)
    exp = sum(r["checks"].get("words", 0) for r in ok)
    cloze = [r["checks"]["clozeOk"] for r in ok if r["checks"].get("examples")]
    secs = sum(r["ms"] for r in rs) / 1000 / len(rs)
    rows.append((os.path.basename(f)[:-5], f"{len(ok)}/{len(rs)}", words, f"{sum(cloze)/max(1,len(cloze)):.2f}", f"{secs:.0f}s"))
print(f"{'model':38} {'batches ok':>10} {'words':>6} {'cloze ok':>9} {'avg time':>9}")
for r in rows: print(f"{r[0]:38} {r[1]:>10} {r[2]:>6} {r[3]:>9} {r[4]:>9}")
