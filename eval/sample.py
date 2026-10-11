"""Print a compact sample of a model's eval output for grading."""
import json, sys
d = json.load(open(sys.argv[1]))
n_words = int(sys.argv[2]) if len(sys.argv) > 2 else 4
langs = sys.argv[3].split(",") if len(sys.argv) > 3 else None
for r in d["results"]:
    if langs and r["lang"] not in langs: continue
    head = f"## {r['lang']} {r['kind']}"
    if r.get("error"): print(head, "ERROR", r["error"][:80]); continue
    print(head)
    for w in r["words"][:n_words]:
        print(f"- {w['lemma']} [{w['pos']}] = {w['gloss']}" + (f"  ({w['notes']})" if w.get('notes') else ""))
        for e in w["examples"][:2]:
            print(f"    {e['text']}  →  {e['translation']}  [{e['cloze']}]")
