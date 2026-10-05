# Rust Delegation Adapter

The Delegation Adapter is the internal Rust service that exposes the existing delegated-authorization framework to the future TypeScript Gateway and Agent runtime.

## Phase 2A boundary

This checkpoint implements only:

- process configuration;
- `GET /health`;
- authenticated `GET /v1/whoami`;
- distinct internal caller credentials;
- deterministic caller -> role -> identity binding;
- capability separation between Engineer, Orchestrator, specialized Agents and Gateway;
- unit tests proving that one caller cannot claim another caller's identity.

No credential issuance, presentation creation, or verification endpoint is exposed yet. Those arrive in Phase 2B.

## Authentication

Internal callers use:

```http
Authorization: Bearer <service-token>
```

The service token is mapped server-side to a fixed identity. Request bodies are not allowed to choose the signing identity.

Current capability model:

- Engineer -> `issue_root`
- Orchestrator -> `issue_child`, `create_presentation`
- Backend -> `create_presentation`
- Frontend -> `create_presentation`
- Test -> `create_presentation`
- Gateway -> `verify_presentation`

## Required environment variables

```text
ADAPTER_CALLER_ENGINEER
ADAPTER_CALLER_ORCHESTRATOR
ADAPTER_CALLER_BACKEND
ADAPTER_CALLER_FRONTEND
ADAPTER_CALLER_TEST
ADAPTER_CALLER_GATEWAY
```

Identity IDs can be overridden with `ADAPTER_ID_*`; development defaults are non-production thesis identifiers.

Run locally:

```bash
cargo run --manifest-path services/delegation-adapter/Cargo.toml
```

Run tests:

```bash
cargo test --manifest-path services/delegation-adapter/Cargo.toml
```
