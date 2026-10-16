# Current infrastructure — Gitea, OPA and Anvil

`docker-compose.yml` starts three local dependency services for the current delegation PoC:

- **Gitea:** protected IAM Console fixture and feature branch.
- **OPA:** independent contextual `allow/deny` decision engine.
- **Anvil:** local EVM for DID identities, trust registries and status anchors.

Trusted TypeScript and Rust services start separately from Docker Compose. **The paid Gemini E2E and the three scripted coordinator E2E workflows start Gitea, OPA and Anvil together through Docker Compose.** The application scripts no longer start a second Gitea with `docker run`.

GitHub-hosted E2E runs use `poc/scripts/ci-compose-lifecycle.sh` to refuse pre-existing Compose containers, networks and Gitea volumes. The lifecycle claims cleanup ownership only after successful preflight, before a possibly partial startup. When a volume is rejected, the always-run teardown skips the stack entirely rather than deleting resources this job does not own. Compose creates the infrastructure. The E2E scripts only configure the IAM Console repository, verify its pinned baseline, create scoped service accounts/tokens and protect `main`. They do **not** invoke `bootstrap-gitea.sh`: that script is reserved for local development and uses another initialization path.

The full scripted and live Gemini coordinators use `poc/packages/agent-runtime/scripts/protected-gitea-bootstrap.mjs` for the same pinned-baseline repository, protected branch and least-privilege token provisioning. Their execution paths, model inputs and free-only simulated review fixture remain separate. The two smaller scripted smoke fixtures deliberately keep their own minimal bootstrap; this helper does not start Docker containers or authorize a merge.

The E2E scripts verify that Gitea belongs to the expected Compose project, is running, and binds HTTP port 3000 on loopback. The workflow runs the ownership-aware `cleanup` command even after failures, and GitHub discards the entire VM after the job. Local `phase1-up.sh` and `phase1-down.sh` still preserve their Gitea volume unless the user explicitly requests removal. Do not point an E2E fixture at an existing local development repository; CI requires a clean volume and the runtime requires `GITEA_E2E_COMPOSE_READY=1`.

The changes in this branch do not inherit the 15 October paid validation: the last paid-tested framework commit remains `02c3395b9111a63ccc9f441ea2c91c81865d6673` until the owner explicitly authorizes another run.

## Local infrastructure scripts

Run from the repository root. Initialization preserves an existing local `.env`:

```bash
node poc/scripts/init-local-env.mjs
bash poc/scripts/phase1-up.sh
bash poc/scripts/phase1-check.sh
bash poc/scripts/phase1-down.sh
```

`poc/scripts/bootstrap-gitea.sh` creates local repository fixture/service credentials; `poc/scripts/bootstrap-trust.sh` deploys the local EVM contracts on a fresh Anvil chain or **reuses recorded contracts** only after checking chain ID, deployed bytecode, governance signer and contract wiring. On partial or incompatible state it fails closed instead of silently redeploying. After Anvil is reset to block 0, the saved addresses are safely replaced by a fresh deployment. Job-local secrets and runtime configuration are in ignored `poc/infra/.env` and `poc/infra/runtime/`.

Use the initializer's `--force` option only for deliberate local credential regeneration: it overwrites `.env` with new random Gitea passwords and service tokens. It does not update accounts already stored in existing Gitea volumes, so routine reinitialization with that option can leave configuration and service credentials inconsistent.

**Runner execution budget (AUD-010):** `TEST_RUNNER_PHASE_TIMEOUT_MS` limits each Docker phase, while `TEST_RUNNER_TOTAL_TIMEOUT_MS` (default and maximum `840000` ms) bounds the entire Runner job, including Gitea checks and all project/acceptance phases. It reserves at least 60 seconds below the Gateway's 900-second Runner request limit in the canonical setup; Docker cleanup is attempted outside the canceled work signal with a separate timeout capped at 30 seconds. The Runner API cancels active work when its direct HTTP client disconnects. The Gateway execute HTTP endpoint propagates an observed caller disconnect through its authorization execution to `GiteaExecutor`, `RunnerClient` and the Runner's authenticated HTTP handler. Tests verify signal delivery without changing authorization, policy or exact SHA gates. Cancellation still depends on the transport reporting a disconnect; no guarantee is made against undetected network partitions or a misbehaving external Docker daemon.

**Warning:** `phase1-down.sh --volumes` removes persistent local Docker volumes; never use it as a routine cleanup step. The default local dev keys belong exclusively to Anvil testing and must not be reused externally.

The real Gemini experiment is **manual and paid**; do not trigger it as part of local infrastructure setup.

**Network boundary:** Compose currently attaches Gitea, OPA and Anvil to the `infra` network only. Backend, Frontend and Test Agents run as host-side processes in the PoC, not as services on a separate Docker agent network. The prior unused `agent` network declaration was not a sandbox or a security boundary; authorization is instead enforced by the task-bound shared MCP worker, Gateway, Rust verifier and OPA. `phase1-check.sh` verifies the actual Gitea network attachment rather than an inert network declaration.
