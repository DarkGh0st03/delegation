#!/usr/bin/env python3
"""Summarize Phase 1b (real trust layer). Standard library only.

Usage: python3 -I analyze_phase1b.py <raw/real-evm>
Latency statistics use ONLY rows with path=direct (no proxy in the path);
RPC counts use ONLY rows with path=proxy. Writes summary.md / summary.csv.
"""
import csv
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def pct(v, p):
    s = sorted(v)
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * p / 100
    lo, hi = int(pos), min(int(pos) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def paired_ci(single, multi, n=2000, seed=20261125):
    reps = sorted(set(single) & set(multi))
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        idx = [rng.choice(reps) for _ in reps]
        out.append(statistics.median(single[i] for i in idx) / statistics.median(multi[i] for i in idx))
    return pct(out, 2.5), pct(out, 97.5)


def main(run: Path):
    rows = list(csv.DictReader(open(run / "positive.csv")))
    bad = [r for r in rows if r["ok"] != "true"]
    direct = defaultdict(list)
    proxy = defaultdict(list)
    for r in rows:
        key = (r["config"], r["mode"], int(r["k"]))
        (direct if r["path"] == "direct" else proxy)[key].append(r)

    def med(rs, col):
        return statistics.median(float(r[col]) for r in rs)

    summary = []
    for key in sorted(direct):
        rs = direct[key]
        row = {"config": key[0], "mode": key[1], "k": key[2], "n": len(rs), "n_vps": int(rs[0]["n_vps"])}
        for col in ("verify_us", "gen_us", "total_us"):
            v = [float(r[col]) for r in rs]
            row.update({f"{col}_median": statistics.median(v), f"{col}_p5": pct(v, 5),
                        f"{col}_p95": pct(v, 95), f"{col}_mean": statistics.fmean(v),
                        f"{col}_sd": statistics.stdev(v)})
        for col in ("did_ms", "chain_ms", "file_ms"):
            row[f"{col}_median"] = med(rs, col)
        row["crypto_residual_ms_median"] = statistics.median(
            float(r["verify_us"]) / 1e3 - float(r["did_ms"]) - float(r["chain_ms"]) - float(r["file_ms"]) for r in rs)
        for col in ("did_resolutions", "chain_calls", "file_reads", "vp_bytes"):
            vals = {int(r[col]) for r in rs}
            row[col] = vals.pop() if len(vals) == 1 else f"varies:{sorted(vals)}"
        pr = proxy.get(key, [])
        for col in ("rpc_requests", "rpc_calls", "rpc_eth_call", "rpc_eth_getLogs", "rpc_eth_chainId", "rpc_other"):
            vals = {int(r[col]) for r in pr}
            row[col] = (vals.pop() if len(vals) == 1 else f"varies:{sorted(vals)}") if vals else ""
        summary.append(row)

    with open(run / "summary.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(summary[0].keys()))
        w.writeheader()
        w.writerows(summary)
    by = {(r["config"], r["mode"], r["k"]): r for r in summary}
    raw = lambda key, col: {int(r["rep"]): float(r[col]) for r in direct[key]}

    md = [f"# Phase 1b summary — {run.name}", "",
          f"- positive rows: {len(rows)} (direct {sum(len(v) for v in direct.values())}, proxy {sum(len(v) for v in proxy.values())}); failed: {len(bad)}",
          "- latency: path=direct only; RPC counts: path=proxy only", ""]
    for config in sorted({r["config"] for r in summary}):
        ks = sorted({r["k"] for r in summary if r["config"] == config})
        md += [f"## {config}", "",
               "| k | separate VPs total s (median [p5–p95]) | single VP total s (median [p5–p95]) | speedup total (paired 95% CI) | speedup verify (paired 95% CI) | time saved s |",
               "|---:|---|---|---|---|---:|"]
        for k in ks:
            s, m = by[(config, "single", k)], by[(config, "multi", k)]
            lo, hi = paired_ci(raw((config, "single", k), "total_us"), raw((config, "multi", k), "total_us"))
            vlo, vhi = paired_ci(raw((config, "single", k), "verify_us"), raw((config, "multi", k), "verify_us"))
            md.append(f"| {k} | {s['total_us_median']/1e6:.3f} [{s['total_us_p5']/1e6:.3f}–{s['total_us_p95']/1e6:.3f}] "
                      f"| {m['total_us_median']/1e6:.3f} [{m['total_us_p5']/1e6:.3f}–{m['total_us_p95']/1e6:.3f}] "
                      f"| {s['total_us_median']/m['total_us_median']:.2f} ({lo:.2f}–{hi:.2f}) "
                      f"| {s['verify_us_median']/m['verify_us_median']:.2f} ({vlo:.2f}–{vhi:.2f}) "
                      f"| {(s['total_us_median']-m['total_us_median'])/1e6:.2f} |")
        md += ["", "Breakdown of ONE verification (single VP, multi mode), medians:", "",
               "| k | verify ms | DID resolutions (n / ms) | registry reads (n / ms) | file reads (n / ms) | crypto+parsing residual ms | VP bytes |",
               "|---:|---:|---|---|---|---:|---:|"]
        for k in ks:
            m = by[(config, "multi", k)]
            md.append(f"| {k} | {m['verify_us_median']/1e3:.1f} | {m['did_resolutions']} / {m['did_ms_median']:.1f} "
                      f"| {m['chain_calls']} / {m['chain_ms_median']:.1f} | {m['file_reads']} / {m['file_ms_median']:.1f} "
                      f"| {m['crypto_residual_ms_median']:.1f} | {m['vp_bytes']} |")
        md += ["", "JSON-RPC traffic per authorization (proxy rows; requests / calls: eth_call, eth_getLogs, eth_chainId, other):", "",
               "| k | separate VPs | single VP |", "|---:|---|---|"]
        for k in ks:
            s, m = by[(config, "single", k)], by[(config, "multi", k)]
            f = lambda r: f"{r['rpc_requests']} / {r['rpc_calls']} ({r['rpc_eth_call']}, {r['rpc_eth_getLogs']}, {r['rpc_eth_chainId']}, {r['rpc_other']})"
            md.append(f"| {k} | {f(s)} | {f(m)} |")
        md.append("")

    neg = list(csv.DictReader(open(run / "negative.csv")))
    ng = defaultdict(list)
    for r in neg:
        ng[(r["config"], r["case"])].append(r)
    md += ["## Negative cases (real trust layer)", "", "| config | case | n | rejected | median s | reason |", "|---|---|---:|---:|---:|---|"]
    ok = True
    for (config, case), rs in sorted(ng.items()):
        rej = sum(r["rejected"] == "true" for r in rs)
        expect = len(rs) if case != "control_valid_batch" else 0
        ok &= rej == expect
        md.append(f"| {config} | {case} | {len(rs)} | {rej} | {statistics.median(float(r['verify_us']) for r in rs)/1e6:.3f} | {rs[0]['error'][:80]} |")
    md.insert(3, f"- negative cases as expected: {ok}")
    (run / "summary.md").write_text("\n".join(md) + "\n")
    print(f"{run}: failed positives={len(bad)}, negatives as expected={ok}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
