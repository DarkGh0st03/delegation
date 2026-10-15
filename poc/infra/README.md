# Current infrastructure — Gitea, OPA and Anvil

`docker-compose.yml` starts three local dependency services for the current delegation PoC:

- **Gitea:** protected IAM Console fixture and feature branch.
- **OPA:** independent contextual `allow/deny` decision engine.
- **Anvil:** local EVM for DID identities, trust registries and status anchors.

Trusted TypeScript and Rust services start separately in the E2E scripts. The paid Gemini E2E and three related isolated coordinator workflows start **only OPA and Anvil from Docker Compose**, pre-pull the Gitea image, then create **one volume-free disposable Gitea** inside their E2E scripts. The role-generated branch, commits and PR exist only in that single disposable instance. They do not bootstrap the Compose Gitea.

The Compose `gitea` service and `poc/scripts/bootstrap-gitea.sh` remain available for **local development and other independent regressions** that genuinely operate on that infrastructure instance. They are not part of the paid Gemini execution path.

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
