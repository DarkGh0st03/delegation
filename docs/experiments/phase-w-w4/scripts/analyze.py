"""Phase W4 campaign analysis (standard library only).

Usage: python3 -I analyze.py <campaign-dir> <seed>  > analysis.txt

Per measured session (warm-ups are separate files and never read):
- execution_ms: Engineer approval -> session completed (planning excluded);
- tasks / child DCs: specialist Tasks ("Orchestrator -> <role>" log lines;
  one Child DC each; create_branch and the Draft PR use the operational Root);
- VPs: Gateway decisions that verified a new VP (single requests, or the
  first item of a read/write batch, "performed"); "reused" items add none;
- full verifications: VP verifications + strict write-set re-verifications;
- verification time: sum of verification_ms (+ reverification_ms);
- OPA evaluations: Gateway decisions with an OPA result (one per item);
- commits: single update/create decisions + published write-sets;
- tool calls: ADK tool calls of the measured session (adk_tool_timing lines,
  grouped by Task; the warm-up Tasks come first in the container log and are
  dropped by count).
Bootstrap: seeded Mersenne Twister (random.Random), 10,000 resamples of the
median, independent (unpaired) groups, percentile 95% intervals.
"""
import json, os, random, statistics, sys

D, SEED = sys.argv[1], int(sys.argv[2])
B = 10_000

def load(label):
    with open(os.path.join(D, label + ".json")) as f:
        return json.load(f)

def tasks_of(run):
    return sum(1 for l in run["log"] if l["text"].startswith("Orchestrator → "))

def metrics(label):
    r = load(label)
    if r["phase"] != "completed":
        return None
    dec = r["gateway_decisions"]
    vps = sum(1 for d in dec if d.get("batch_verification") in (None, "performed"))
    rever = [d["reverification_ms"] for d in dec if "reverification_ms" in d]
    ver_ms = sum(d.get("verification_ms", 0) for d in dec if d.get("batch_verification") != "reused")
    commits = sum(1 for d in dec if d["tool"] in ("update_file", "create_file") and not d.get("write_batch_id")) \
        + sum(1 for d in dec if d.get("commit_sha"))
    opa = sum(1 for d in dec if "opa_ms" in d)
    # Tool calls: drop the warm-up Tasks (first in the log).
    warm = load("warmup-" + label)
    lines = [json.loads(x) for x in open(os.path.join(D, label + ".adk_tool_timing.jsonl")) if x.strip()]
    order = []
    for x in lines:
        if x["task_ref"] not in order:
            order.append(x["task_ref"])
    n_warm_refs = len({x["task_ref"] for x in lines}) - tasks_of(r)
    measured_refs = set(order[n_warm_refs:]) if n_warm_refs >= 0 else set()
    tool_calls = sum(1 for x in lines if x["task_ref"] in measured_refs)
    tool_ok = n_warm_refs == tasks_of(warm)
    return dict(execution_ms=r["execution_ms"], tasks=tasks_of(r), vps=vps,
                verifications=vps + len(rever), verification_ms=ver_ms + sum(rever),
                reverification_ms=sum(rever), opa=opa, decisions=len(dec), commits=commits,
                tool_calls=tool_calls, tool_calls_consistent=tool_ok, pr=(r.get("pull_request") or {}).get("number"))

def boot_median_diff(a, b, rng):
    out = []
    for _ in range(B):
        ra = [rng.choice(a) for _ in a]; rb = [rng.choice(b) for _ in b]
        out.append(statistics.median(ra) - statistics.median(rb))
    out.sort()
    return out[int(0.025 * B)], out[int(0.975 * B) - 1]

def boot_median_ratio(a, b, rng):
    out = []
    for _ in range(B):
        ra = [rng.choice(a) for _ in a]; rb = [rng.choice(b) for _ in b]
        out.append(statistics.median(ra) / statistics.median(rb))
    out.sort()
    return out[int(0.025 * B)], out[int(0.975 * B) - 1]

labels = sorted(f[:-5] for f in os.listdir(D) if f.endswith(".json") and not f.startswith("warmup-"))
rows, failed = {}, []
for label in labels:
    m = metrics(label)
    if m is None:
        failed.append(label); continue
    v, k, _ = label.split("-")
    rows.setdefault((int(k[1:]), v), []).append((label, m))

rng = random.Random(SEED)
print(f"# Phase W4 campaign analysis (bootstrap seed {SEED}, {B} resamples)")
print(f"measured sessions completed: {sum(len(x) for x in rows.values())}; not completed: {failed or 'none'}")
for k in (2, 4, 8):
    print(f"\n## k = {k} writes")
    agg = {}
    for v in ("base", "ws"):
        ms = [m for _, m in rows.get((k, v), [])]
        if not ms:
            print(f"{v}: no completed session"); continue
        agg[v] = ms
        med = lambda key: statistics.median(m[key] for m in ms)
        uniq = lambda key: sorted({m[key] for m in ms})
        print(f"{v:4} n={len(ms)} execution_ms median={med('execution_ms'):.0f} "
              f"min={min(m['execution_ms'] for m in ms)} max={max(m['execution_ms'] for m in ms)}")
        print(f"     tasks/childDCs={uniq('tasks')} VPs={uniq('vps')} verifications={uniq('verifications')} "
              f"OPA={uniq('opa')} decisions={uniq('decisions')} commits={uniq('commits')} tool_calls={uniq('tool_calls')}"
              f" tool_count_consistent={all(m['tool_calls_consistent'] for m in ms)}")
        print(f"     verification_ms median={med('verification_ms'):.0f} (of which strict re-verification "
              f"median={med('reverification_ms'):.0f})")
    if len(agg) == 2:
        a = [m["execution_ms"] for m in agg["ws"]]; b = [m["execution_ms"] for m in agg["base"]]
        d = statistics.median(a) - statistics.median(b)
        lo, hi = boot_median_diff(a, b, rng)
        rl, rh = boot_median_ratio(a, b, rng)
        va = statistics.median(m["verification_ms"] for m in agg["ws"])
        vb = statistics.median(m["verification_ms"] for m in agg["base"])
        print(f"delta execution (ws - base) median = {d:.0f} ms, 95% CI [{lo:.0f}, {hi:.0f}]; "
              f"ratio ws/base = {statistics.median(a)/statistics.median(b):.3f} [{rl:.3f}, {rh:.3f}]")
        print(f"delta verification time (ws - base) median = {va - vb:.0f} ms "
              f"-> share of the execution delta = {((va - vb) / d * 100) if d else float('nan'):.0f}%")
print("\n## per session")
for (k, v), xs in sorted(rows.items()):
    for label, m in xs:
        print(label, json.dumps(m, sort_keys=True))
