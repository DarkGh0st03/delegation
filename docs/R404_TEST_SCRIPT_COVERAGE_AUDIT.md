# R404 — Configured test/script coverage audit

**8 November 2026.** Work branch `refactor/post-prof-plan-contracts-20261021`, PR #38 Draft. R403.1 was validated by [Fast CI #42507757234](https://github.com/DarkGh0st03/delegation/actions/runs/42507757234) on SHA `49e07532`.

The new `poc/scripts/r404-test-and-script-coverage-audit.mjs` is **read-only** and reports which tracked tests are named in workflow Node test commands, workspace npm script chains, and literal filename globs. It distinguishes `node --test`, restricted `--test-name-pattern`, and `node --check`. It records reusable workflow references and exact SHA-256 identical test-file bytes. The twelve protected security witness groups in R402 must remain present.

Run:

```bash
node --experimental-vm-modules --test poc/scripts/test/r404-test-and-script-coverage-audit.test.mjs
node --experimental-vm-modules poc/scripts/r404-test-and-script-coverage-audit.mjs --out /tmp/r404-test-configuration.json
```

Fast CI publishes the exact-SHA review artifact `r404-test-configuration`.

**Critical distinction:** all findings are configured command **mentions**, not a proof that a particular job, test case or external consumer executed. A file referenced by `node --check` is syntactically checked only, not exercised. `--test-name-pattern` can run only some cases. An absent literal command does not imply dead code. Duplicate SHA-256 content does not establish that a test is safe to delete. This scan does not resolve all shell conditions, Python/Rust test discovery, Docker invocations, dynamic paths or third-party consumers.

**Next gate:** inspect each potentially redundant test/script against R402 graph reachability, R385.17 non-test legacy callers and the negative security behaviors in R402 witnesses. First port any irreplaceable test to a canonical successor, then retire exact caller chains in a small batch. No source, test, script, MCP component or workflow is deleted in R404; no Gemini, provider, signing or merge action is run.
