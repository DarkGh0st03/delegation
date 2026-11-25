#!/usr/bin/env python3
"""Summarize the multi-permission verification benchmark (standard library only).

Usage: python3 -I analyze.py <raw-run-dir> [<raw-run-dir> ...]
Writes summary.csv, negative-summary.csv and summary.md into each run directory.
"""
import csv
import json
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path

METRICS = ("verify_us", "gen_us", "total_us")
QUERY_COLS = ("q_identity_status", "q_trust_anchor", "q_latest_material_version",
              "q_material_anchor", "q_accumulator_data", "q_verification_key",
              "q_status_anchor", "q_status_list_fetch", "q_chain_reads", "q_total")


def pct(values, p):
    """Linear-interpolation percentile (same convention as numpy 'linear')."""
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * p / 100
    lo, hi = int(pos), min(int(pos) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def bootstrap_ratio(single, multi, n=2000, seed=20261125):
    """Paired 95% percentile-bootstrap CI of median(single)/median(multi).

    `single` and `multi` are dicts rep -> value. The SAME resampled set of
    repetitions is used for both modes, preserving the pairing of trials that
    ran within the same repetition (same machine state, same shuffled block).
    """
    reps = sorted(set(single) & set(multi))
    rng = random.Random(seed)
    ratios = []
    for _ in range(n):
        idx = [rng.choice(reps) for _ in reps]
        ratios.append(statistics.median(single[i] for i in idx) /
                      statistics.median(multi[i] for i in idx))
    return pct(ratios, 2.5), pct(ratios, 97.5)


def ols(xs, ys):
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    a = my - b * mx
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    return a, b, 1 - ss_res / ss_tot if ss_tot else 1.0


def analyze(run: Path):
    rows = list(csv.DictReader(open(run / "positive.csv")))
    meta = json.loads((run / "run-meta.json").read_text())
    groups = defaultdict(list)
    for r in rows:
        groups[(r["config"], r["mode"], int(r["k"]))].append(r)

    out = []
    for (config, mode, k), rs in sorted(groups.items()):
        row = {"config": config, "mode": mode, "k": k, "n": len(rs),
               "all_ok": all(r["ok"] == "true" and r["depth_ok"] == "true" for r in rs)}
        for m in METRICS:
            v = [float(r[m]) for r in rs]
            row.update({f"{m}_median": statistics.median(v), f"{m}_p5": pct(v, 5),
                        f"{m}_p25": pct(v, 25), f"{m}_p75": pct(v, 75),
                        f"{m}_p95": pct(v, 95), f"{m}_mean": statistics.fmean(v),
                        f"{m}_sd": statistics.stdev(v) if len(v) > 1 else 0.0})
        row["verify_us_per_permission_median"] = row["verify_us_median"] / k
        row["total_us_per_permission_median"] = row["total_us_median"] / k
        row["vp_bytes_median"] = statistics.median(int(r["vp_bytes"]) for r in rs)
        row["n_vps"] = int(rs[0]["n_vps"])
        for q in QUERY_COLS:
            vals = {int(r[q]) for r in rs}
            row[q] = vals.pop() if len(vals) == 1 else f"varies:{sorted(vals)}"
        out.append(row)

    cols = list(out[0].keys())
    with open(run / "summary.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(out)

    by = {(r["config"], r["mode"], r["k"]): r for r in out}
    raw = {key: {int(x["rep"]): float(x["verify_us"]) for x in v} for key, v in groups.items()}
    raw_total = {key: {int(x["rep"]): float(x["total_us"]) for x in v} for key, v in groups.items()}

    md = [f"# Summary — {run.name}", "",
          f"- reps: {meta['reps']} (warm-up {meta['warmup']} discarded), seed {meta['seed']}, "
          f"credential with {meta['n_permissions_in_credential']} permissions, "
          f"parallel_verification={meta['features']['parallel_verification']}, "
          f"elapsed {meta['elapsed_s']:.0f} s", ""]
    for config in sorted({r["config"] for r in out}):
        md += [f"## {config}", "",
               "| k | single verify ms (median [p5–p95]) | multi verify ms (median [p5–p95]) | "
               "ratio single/multi (paired 95% CI) | multi ms/permission | single VPs bytes | multi VP bytes | "
               "trust queries single / multi |",
               "|---:|---|---|---|---:|---:|---:|---|"]
        ks = sorted({r["k"] for r in out if r["config"] == config})
        for k in ks:
            s, m = by[(config, "single", k)], by[(config, "multi", k)]
            lo, hi = bootstrap_ratio(raw[(config, "single", k)], raw[(config, "multi", k)])
            md.append(
                f"| {k} | {s['verify_us_median']/1e3:.2f} [{s['verify_us_p5']/1e3:.2f}–{s['verify_us_p95']/1e3:.2f}] "
                f"| {m['verify_us_median']/1e3:.2f} [{m['verify_us_p5']/1e3:.2f}–{m['verify_us_p95']/1e3:.2f}] "
                f"| {s['verify_us_median']/m['verify_us_median']:.2f} ({lo:.2f}–{hi:.2f}) "
                f"| {m['verify_us_per_permission_median']/1e3:.2f} "
                f"| {s['vp_bytes_median']:.0f} | {m['vp_bytes_median']:.0f} "
                f"| {s['q_total']} / {m['q_total']} |")
        md.append("")
        md += ["| k | single presentation ms | multi presentation ms | single total ms | multi total ms | "
               "ratio total (paired 95% CI) |", "|---:|---:|---:|---:|---:|---|"]
        for k in ks:
            s, m = by[(config, "single", k)], by[(config, "multi", k)]
            lo, hi = bootstrap_ratio(raw_total[(config, "single", k)], raw_total[(config, "multi", k)])
            md.append(f"| {k} | {s['gen_us_median']/1e3:.2f} | {m['gen_us_median']/1e3:.2f} "
                      f"| {s['total_us_median']/1e3:.2f} | {m['total_us_median']/1e3:.2f} "
                      f"| {s['total_us_median']/m['total_us_median']:.2f} ({lo:.2f}–{hi:.2f}) |")
        md.append("")
        for mode in ("single", "multi"):
            xs = [k for k in ks]
            ys = [by[(config, mode, k)]["verify_us_median"] / 1e3 for k in ks]
            a, b, r2 = ols(xs, ys)
            md.append(f"- OLS on medians, {mode}: verify_ms ≈ {a:.2f} + {b:.3f}·k (R² = {r2:.4f})")
        md.append("")

    neg = list(csv.DictReader(open(run / "negative.csv")))
    ng = defaultdict(list)
    for r in neg:
        ng[(r["config"], r["case"], int(r["k"]))].append(r)
    nout = []
    for (config, case, k), rs in sorted(ng.items()):
        expect_reject = case != "control_valid_batch"
        rejected = sum(r["rejected"] == "true" for r in rs)
        lat = [float(r["verify_us"]) for r in rs]
        nout.append({"config": config, "case": case, "k": k, "n": len(rs),
                     "stage": rs[0]["stage"], "rejected": rejected,
                     "as_expected": (rejected == len(rs)) if expect_reject else (rejected == 0),
                     "latency_ms_median": statistics.median(lat) / 1e3,
                     "error_example": rs[0]["error"]})
    with open(run / "negative-summary.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(nout[0].keys()))
        w.writeheader()
        w.writerows(nout)
    neg_groups = [r for r in nout if r["case"] != "control_valid_batch"]
    ctl_groups = [r for r in nout if r["case"] == "control_valid_batch"]
    md += ["## Negative cases", "",
           f"{len(nout)} groups: {len(neg_groups)} invalid-request groups "
           f"({sum(r['n'] for r in neg_groups)} trials, {sum(r['rejected'] for r in neg_groups)} rejected) and "
           f"{len(ctl_groups)} valid-control groups ({sum(r['n'] for r in ctl_groups)} trials, "
           f"{sum(r['n'] - r['rejected'] for r in ctl_groups)} accepted).", "",
           "| config | case | k | n | rejected | as expected | median ms to decision | reason (first) |",
           "|---|---|---:|---:|---:|---|---:|---|"]
    for r in nout:
        md.append(f"| {r['config']} | {r['case']} | {r['k']} | {r['n']} | {r['rejected']} | "
                  f"{'yes' if r['as_expected'] else '**NO**'} | {r['latency_ms_median']:.2f} | "
                  f"{r['error_example'][:90]} |")
    (run / "summary.md").write_text("\n".join(md) + "\n")
    print(f"{run}: {len(out)} groups, {len(nout)} negative groups, "
          f"all positives ok={all(r['all_ok'] for r in out)}, "
          f"all negatives as expected={all(r['as_expected'] for r in nout)}")


if __name__ == "__main__":
    for d in sys.argv[1:]:
        analyze(Path(d))
