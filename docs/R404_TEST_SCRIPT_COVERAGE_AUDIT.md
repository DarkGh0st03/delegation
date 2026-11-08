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

## R404.1 — Verified configuration inventory (8 November 2026)

[Fast CI run #42508588421](https://github.com/DarkGh0st03/delegation/actions/runs/42508588421), SHA `1525bc4b`: SUCCESS 2/2 (Node/offline and real Docker evidence). In the tracked tree: 1,191 files, 62 workflows, nine package manifests, 353 recognized test source files. The configuration scanner observed 346 files in `node --test` commands, two in syntax-only checks and five without an observed configured test command; 18 script definitions were expanded, one reusable workflow reference was found, and one unresolved reference remained. No exact duplicate-content test group or missing R402 security witness was reported.

**Evidence qualification:** the 346 count is *configured*, not 346 separately attested executions. The seven remaining cases may be test fixtures, imported by other tests, run through indirect commands, or blocked by existing security constraints. No file has deletion authority. R404.2 includes an explicit path-level review shortlist in CI logs, so each candidate can be examined against runtime/test importers and required negative properties before choosing a consolidation batch.

## R404.4 — Promotion of five unconfigured offline regressions

The [R404.3 Fast CI #42509077171](https://github.com/DarkGh0st03/delegation/actions/runs/42509077171) completed SUCCESS 2/2 on SHA `482d868a`. Its exact-path review found five previously unconfigured `.test.mjs` sources (in addition to two Engineer tests mentioned only under `node --check`). They protect Engineer lifecycle state, closed native-root evidence, Docker failure sanitization, R401 trusted profile rejection and persistent Child issuance safety.

The five sources now have explicit `node --experimental-strip-types --test` invocations in the Fast CI workflow; this is a **coverage promotion**, not a source deletion. The change deliberately does not run the two larger Engineer HTTP/host suites, which still need independent environment and assertion review.

The post-change Fast CI must pass on its own SHA before this promotion is called verified. Automatic deletion remains forbidden.
