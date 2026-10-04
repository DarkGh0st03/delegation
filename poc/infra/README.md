# Phase 1 local infrastructure

This directory contains the first executable infrastructure layer of the thesis PoC.

## Services

The Docker Compose topology starts:

- **Gitea** — protected Git provider that hosts the imported `thesis/iam-console-poc` baseline;
- **OPA** — policy engine process, started now so the service boundary exists before policy rules are implemented in Phase 4;
- **Anvil** — local EVM node used by the already implemented trust layer;
- **trust-bootstrap** — one-shot Foundry container that reuses `blockchain/scripts/deploy-local.sh` to deploy the DID, enterprise trust and issuer registries.

Pinned defaults at this checkpoint:

- Gitea: `docker.gitea.com/gitea:28.0.0`
- OPA: `openpolicyagent/opa:1.21.1`
- Foundry: `ghcr.io/foundry-rs/foundry:v1.8.4`

The image values can be overridden in the generated `poc/infra/.env` file.

## Network model

Two Docker networks are declared:

- `delegation-poc-infra` — Gitea, OPA, Anvil and, in later phases, the Gateway / authorization-side services;
- `delegation-poc-agent` — internal network reserved for Agent services.

Gitea is **not** attached to the Agent network.

When the Gateway is implemented it will be the controlled bridge between the Agent network and the infrastructure/provider network. Specialized Agent services must never receive the Gitea provider credential.

The Gitea, OPA and Anvil ports are bound to `127.0.0.1` for local administration and debugging. Those host bindings are development conveniences and are not the authority boundary; authorization remains based on missing Agent credentials, network membership and the Gateway enforcement path.

## Local configuration

Generate local-only credentials and pinned configuration:

```bash
node poc/scripts/init-local-env.mjs
```

This creates:

```text
poc/infra/.env
```

The file is gitignored. It contains local Gitea passwords plus placeholders for the future Adapter service callers.

The deterministic Anvil mnemonic and deployer account are public development values and must never be reused outside this local PoC.

## Start and bootstrap everything

From the repository root:

```bash
bash poc/scripts/phase1-up.sh
```

The script:

1. validates Docker Compose;
2. starts Gitea, OPA and Anvil;
3. creates the local Gitea admin and Gateway service users;
4. creates the `thesis` organization;
5. imports `DarkGh0st03/iam-console-poc` into `thesis/iam-console-poc`;
6. verifies that imported `main` equals the hardened baseline SHA;
7. grants only repository `write` permission to the Gateway service user;
8. creates a Gateway API credential and stores it in a gitignored runtime file;
9. deploys the existing trust contracts through the Foundry bootstrap container;
10. verifies health, imported revision, contract bytecode and the declared network separation.

Generated runtime files:

```text
poc/infra/runtime/gateway.env
poc/infra/runtime/trust.env
```

They are gitignored.

## Validate an already running environment

```bash
bash poc/scripts/phase1-check.sh
```

A successful run ends with:

```text
PHASE1_CHECK=PASS
```

## Stop

Preserve Gitea data:

```bash
bash poc/scripts/phase1-down.sh
```

Remove containers **and** the Gitea volume:

```bash
bash poc/scripts/phase1-down.sh --volumes
```

## Important scope boundary

Phase 1 does **not** implement:

- the Rust Delegation Adapter HTTP API;
- Gateway authorization;
- Rego policy rules;
- protected Gitea tool operations;
- Agents, A2A or LLM calls.

Those are intentionally later phases.
