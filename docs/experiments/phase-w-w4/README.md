# Phase W4: real-stack security checks and campaign (scripted, no AI, no paid API)

Report: `docs/PHASE_W_RESULTS.md`. Image `delegation-app:phase-w4` = `delegation-app:local` + `poc/` of the W4 commit (tree `f997e709…`).

- `scripts/compose.phase-w4.yaml`: override (batch reads/writes, plan size, `DELEGATION_W4_PROBE`).
- `scripts/run-e2e.mjs`, `scripts/console.mjs`: session driver (derived from Phase R; `APPROVE=creates`).
- `scripts/one-run.sh`: one fresh stack + one session (security checks).
- `scripts/make-plan.py`, `scripts/campaign.sh`: seeded random order; per run the containers are recreated (`down`/`up`, Docker volumes persist) and one discarded warm-up (always the 2-write workload, same variant) precedes the measured session.
- `scripts/analyze.py`: counts, medians, seeded bootstrap (`python3 -I analyze.py raw/campaign 20261125`).
- `raw/security/`: `revoke-mixed`, `control-mixed`, `creates-only` (session JSON, tool timing), `gitea-evidence.txt`,
  `revoke-mixed.status-list-updated.json` (Anvil `StatusListUpdated` logs), `anvil-blocks.txt`.
- `raw/plan-seed-20261125.txt`, `raw/campaign.log`, `raw/campaign/` (36 measured + 36 warm-up sessions), `raw/analysis.txt`.

Failed attempts / deviations: the first campaign launch stopped at once (relative plan path, no session run); relaunched
unchanged with absolute paths. No session failed.
