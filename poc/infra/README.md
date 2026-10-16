# Current infrastructure — Gitea, OPA and Anvil

`docker-compose.yml` starts three local dependency services for the current delegation PoC:

- **Gitea:** protected IAM Console fixture and feature branch.
- **OPA:** independent contextual `allow/deny` decision engine.
- **Anvil:** local EVM for DID identities, trust registries and status anchors.

Trusted TypeScript and Rust services start separately from Docker Compose. **The paid Gemini E2E and the three scripted coordinator E2E workflows start Gitea, OPA and Anvil together through Docker Compose.** The application scripts no longer start a second Gitea with `docker run`.

GitHub-hosted E2E runs use `poc/scripts/ci-compose-lifecycle.sh` to refuse pre-existing Compose containers, networks and Gitea volumes. The lifecycle claims cleanup ownership only after successful preflight, before a possibly partial startup. When a volume is rejected, the always-run teardown skips the stack entirely rather than deleting resources this job does not own. Compose creates the infrastructure. The E2E scripts only configure the IAM Console repository, verify its pinned baseline, create scoped service accounts/tokens and protect `main`. They do **not** invoke `bootstrap-gitea.sh`: that script is reserved for local development and uses another initialization path.

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

`poc/scripts/bootstrap-gitea.sh` creates local repository fixture/service credentials; `poc/scripts/bootstrap-trust.sh` deploys the local EVM contracts. Job-local secrets and runtime configuration are in ignored `poc/infra/.env` and `poc/infra/runtime/`.

Use the initializer's `--force` option only for deliberate local credential regeneration: it overwrites `.env` with new random Gitea passwords and service tokens. It does not update accounts already stored in existing Gitea volumes, so routine reinitialization with that option can leave configuration and service credentials inconsistent.

**Warning:** `phase1-down.sh --volumes` removes persistent local Docker volumes; never use it as a routine cleanup step. The default local dev keys belong exclusively to Anvil testing and must not be reused externally.

The real Gemini experiment is **manual and paid**; do not trigger it as part of local infrastructure setup.
