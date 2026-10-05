# Rust Delegation Adapter

The Delegation Adapter is the internal Rust service that exposes the existing delegated-authorization framework to the future TypeScript Gateway and Agent runtime.

## Phase 2 boundary

The service provides:

- `GET /health`;
- authenticated `GET /v1/whoami`;
- `POST /v1/credentials/root`;
- `POST /v1/credentials/child`;
- `POST /v1/presentations`;
- `POST /v1/verify`;
- distinct internal caller credentials;
- deterministic caller -> role -> identity binding;
- capability separation between Engineer, Orchestrator, specialized Agents and Gateway.

Internal callers authenticate with:

```http
Authorization: Bearer <service-token>
```

The signing/issuer identity is selected server-side from the authenticated caller. The request body never chooses the identity whose private signing material is used.

## Capability model

- Engineer -> root Delegation Credential issuance
- Orchestrator -> child Delegation Credential issuance + own VP creation
- Backend -> own VP creation
- Frontend -> own VP creation
- Test -> own VP creation
- Gateway -> VP verification only

The root credential is restricted to Engineer -> Orchestrator. Child issuance is restricted to Orchestrator -> Backend/Frontend/Test.

The existing Rust framework remains responsible for non-escalation, temporal capping, accumulator/witness construction, selective disclosure, VP Ed25519 signing and DelegationVerifier checks.

## Current trust backend

Phase 2 closes the HTTP/cryptographic bridge with the existing framework using its deterministic in-memory trust/status providers inside the Adapter process. This makes issuer keys, accumulator material and credential state process-local while exercising the real DelegationIssuer and DelegationVerifier code paths.

The EVM trust layer built in Phase 1 remains independently validated and is not reimplemented here. Before the final positive end-to-end experiment, the Adapter deployment mode will bind verification/public-material resolution to the already implemented EVM-backed providers.

## Required caller environment variables

```text
ADAPTER_CALLER_ENGINEER
ADAPTER_CALLER_ORCHESTRATOR
ADAPTER_CALLER_BACKEND
ADAPTER_CALLER_FRONTEND
ADAPTER_CALLER_TEST
ADAPTER_CALLER_GATEWAY
```

Identity IDs can be overridden with `ADAPTER_ID_*`.

Run tests:

```bash
cargo test --manifest-path services/delegation-adapter/Cargo.toml
```

Run service:

```bash
cargo run --manifest-path services/delegation-adapter/Cargo.toml
```
