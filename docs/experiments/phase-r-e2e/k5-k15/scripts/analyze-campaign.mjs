// Phase R k=5/15 campaign analysis. Usage: node analyze-campaign.mjs <dir>
import {readFileSync, readdirSync} from "node:fs";
const dir = process.argv[2] ?? "e2e2";
const med = a => { const s = [...a].sort((x, y) => x - y); const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
// Deterministic PRNG for the bootstrap: mulberry32, exact 32-bit integer
// arithmetic (Math.imul, >>>), so no product exceeds 2^53. The first version
// used an LCG whose product seed*1103515245 could exceed Number.MAX_SAFE_INTEGER
// (rounded, deterministic but not the intended generator).
let seed = 20261125 >>> 0;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = a => a[Math.floor(rnd() * a.length)];
function bootDiff(a, b, B = 10000) { // CI of median(b) - median(a), unpaired
  const d = []; for (let i = 0; i < B; i++)
    d.push(med(b.map(() => pick(b))) - med(a.map(() => pick(a))));
  d.sort((x, y) => x - y); return [d[Math.floor(B * 0.025)], d[Math.floor(B * 0.975)]];
}
const runs = [];
for (const f of readdirSync(dir).filter(f => /^(batch|single)-k\d+-\d+\.json$/u.test(f))) {
  const r = JSON.parse(readFileSync(`${dir}/${f}`));
  const [, variant, k] = /^(batch|single)-k(\d+)/u.exec(f);
  const d = r.gateway_decisions, reads = d.filter(x => x.tool === "read_file");
  const timing = readFileSync(`${dir}/${f.replace(/\.json$/u, ".adk_tool_timing.jsonl")}`, "utf8")
    .split("\n").filter(Boolean).map(l => JSON.parse(l.slice(l.indexOf("{"))));
  // The container log also holds the discarded warm-up session: keep only
  // the LAST Test Task that performed reads (the measured session's).
  const byTask = new Map();
  for (const t of timing) if (t.role === "test" && /^read_file/u.test(t.tool))
    byTask.set(t.task_ref, [...(byTask.get(t.task_ref) ?? []), t]);
  const testReads = [...byTask.values()].at(-1) ?? [];
  runs.push({run: f.replace(".json", ""), variant, k: +k, phase: r.phase,
    decisions: d.length, all_allow: d.every(x => x.decision === "allow"),
    performed: d.filter(x => x.batch_verification === "performed").length,
    reused: d.filter(x => x.batch_verification === "reused").length,
    batch_ids: new Set(d.map(x => x.read_batch_id).filter(Boolean)).size,
    verif_s: d.reduce((a, x) => a + x.verification_ms, 0) / 1e3,
    read_verif_s: reads.reduce((a, x) => a + x.verification_ms, 0) / 1e3,
    test_read_phase_s: testReads.reduce((a, t) => a + t.duration_ms, 0) / 1e3,
    test_read_calls: testReads.length,
    opa_n: d.filter(x => x.opa_ms > 0).length,
    exec_s: r.execution_ms / 1e3});
  if (r.phase !== "completed") runs.at(-1).excluded = true;
}
runs.sort((a, b) => a.run.localeCompare(b.run, undefined, {numeric: true}));
console.table(runs.map(r => ({...r, verif_s: +r.verif_s.toFixed(2), read_verif_s: +r.read_verif_s.toFixed(2),
  test_read_phase_s: +r.test_read_phase_s.toFixed(2)})));
const metrics = ["verif_s", "read_verif_s", "test_read_phase_s", "exec_s"];
const summary = [];
for (const k of [...new Set(runs.map(r => r.k))].sort((a, b) => a - b)) {
  const ok = runs.filter(r => !r.excluded);
  const s = ok.filter(r => r.k === k && r.variant === "single"), b = ok.filter(r => r.k === k && r.variant === "batch");
  for (const m of metrics) {
    const ms = s.map(r => r[m]), mb = b.map(r => r[m]);
    const [lo, hi] = bootDiff(ms, mb);
    summary.push({k, metric: m, n_single: ms.length, n_batch: mb.length,
      median_single: +med(ms).toFixed(2), median_batch: +med(mb).toFixed(2),
      diff: +(med(mb) - med(ms)).toFixed(2), ci95: `[${lo.toFixed(2)}, ${hi.toFixed(2)}]`,
      ratio: +(med(ms) / med(mb)).toFixed(2)});
  }
}
console.table(summary);
