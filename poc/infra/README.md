# Phase 1 local infrastructure

This directory contains the first executable infrastructure layer of the thesis PoC.

## Services

Docker Compose starts:

- **Gitea** — protected Git provider hosting the imported `thesis/iam-console-poc` baseline;
- **OPA** — policy-engine process; contextual rules arrive in Phase 4;
- **Anvil** — local EVM node used by the existing trust layer.

The existing trust contracts are deployed from the host by `poc/scripts/bootstrap-trust.sh`, which reuses `blockchain/scripts/deploy-local.sh`. Keeping Foundry execution on the host avoids writing build artifacts through a container bind mount while still keeping Anvil itself containerized.

Pinned defaults:

- Gitea: `docker.gitea.com/gitea:28.0.0`
- OPA: `openpolicyagent/opa:1.21.1`
- Foundry / Anvil: `v1.8.4`

## Network model

Two Docker networks are declared:

- `delegation-poc-infra` — Gitea, OPA and Anvil; later authorization-side services join as needed;
- `delegation-poc-agent` — internal network reserved for Agent services.

Gitea is not attached to the Agent network. Future Agent containers therefore do not get a provider route or credential by default; the Gateway becomes the controlled bridge.

The service ports are bound to `127.0.0.1` only for local administration/debugging.

## Local configuration

Generate local-only configuration:

```bash
node poc/scripts/init-local-env.mjs
```

This creates the gitignored `poc/infra/.env`.

The deterministic Anvil mnemonic and deployer account are public development values and must never be reused outside this local PoC.

## Start and bootstrap everything

Requirements on the host:

- Docker + Docker Compose v2;
- Node.js;
- curl;
- Foundry `forge` and `cast` v1.8.4-compatible tooling.

Run:

```bash
bash poc/scripts/phase1-up.sh
```

The script:

1. validates Docker Compose;
2. starts Gitea, OPA and Anvil;
3. creates local Gitea admin and Gateway service users;
4. creates the `thesis` organization;
5. imports `DarkGh0st03/iam-console-poc` as `thesis/iam-console-poc`;
6. verifies imported `main` equals the hardened baseline SHA;
7. grants repository `write` permission only to the Gateway service user;
8. creates a Gateway API credential in a gitignored runtime file;
9. deploys the existing trust contracts against the containerized Anvil node;
10. validates health, repository SHA, deployed bytecode and network separation.

Generated runtime files:

```text
poc/infra/runtime/gateway.env
poc/infra/runtime/trust.env
```

## Validate

```bash
bash poc/scripts/phase1-check.sh
```

Success ends with:

```text
PHASE1_CHECK=PASS
```

## Stop

Preserve Gitea data:

```bash
bash poc/scripts/phase1-down.sh
```

Remove containers and the Gitea volume:

```bash
bash poc/scripts/phase1-down.sh --volumes
```

## Scope boundary

Phase 1 does not implement the Rust Adapter API, Gateway authorization, Rego policy rules, protected Gitea tools, Agents, A2A or LLM calls.
