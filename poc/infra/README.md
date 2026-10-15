# Current infrastructure — Gitea, OPA and Anvil

`docker-compose.yml` starts three local dependency services for the current delegation PoC:

- **Gitea:** protected IAM Console fixture and feature branch.
- **OPA:** independent contextual `allow/deny` decision engine.
- **Anvil:** local EVM for DID identities, trust registries and status anchors.

Trusted TypeScript and Rust services start separately in the E2E scripts; the full paid workflow additionally uses an **isolated disposable Gitea instance** for the role-generated branch and PR. Do not confuse that disposable environment with persistent local Gitea.

## Local infrastructure scripts

```bash
node poc/scripts/init-local-env.mjs --force
bash poc/scripts/phase1-up.sh
bash poc/scripts/phase1-check.sh
bash poc/scripts/phase1-down.sh
```

`poc/scripts/bootstrap-gitea.sh` creates local repository fixture/service credentials; `poc/scripts/bootstrap-trust.sh` deploys the local EVM contracts. Job-local secrets and runtime configuration are in ignored `poc/infra/.env` and `poc/infra/runtime/`.

**Warning:** `phase1-down.sh --volumes` removes persistent local Docker volumes; never use it as a routine cleanup step. The default local dev keys belong exclusively to Anvil testing and must not be reused externally.

The real Gemini experiment is **manual and paid**; do not trigger it as part of local infrastructure setup.
