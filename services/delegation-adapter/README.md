# Delegation Adapter service

The Delegation Adapter exposes the existing Rust delegated-authorization framework to the TypeScript/Node PoC without moving cryptographic logic or private keys into the LLM execution layer.

## Phase 2A — identity-bound service skeleton

Implemented now:

- Axum HTTP service;
- public `GET /health`;
- protected `GET /v1/whoami`;
- one service credential per internal caller;
- server-side mapping from caller credential to role, identity and capabilities;
- no request body can select a signing identity;
- fail-closed startup if any required binding is missing.

Roles and capabilities at this checkpoint:

| Caller | Capabilities |
| --- | --- |
| Engineer | `issue_root` |
| Gateway | `verify` |
| Orchestrator | `issue_child`, `present` |
| Backend Agent | `present` |
| Frontend Agent | `present` |
| Test Agent | `present` |

Phase 2B adds the actual delegation issuance, signed VP creation and verification endpoints while reusing the root Rust framework.

## Required environment variables

Service credentials:

- `ADAPTER_CALLER_ENGINEER`
- `ADAPTER_CALLER_GATEWAY`
- `ADAPTER_CALLER_ORCHESTRATOR`
- `ADAPTER_CALLER_BACKEND`
- `ADAPTER_CALLER_FRONTEND`
- `ADAPTER_CALLER_TEST`

Server-side identities:

- `ADAPTER_ID_ENGINEER`
- `ADAPTER_ID_GATEWAY`
- `ADAPTER_ID_ORCHESTRATOR`
- `ADAPTER_ID_BACKEND`
- `ADAPTER_ID_FRONTEND`
- `ADAPTER_ID_TEST`

The caller credential determines the identity. A future issuance/presentation request is therefore not allowed to say “sign as Backend” or “sign as Orchestrator”.

## Test

```bash
cargo test --manifest-path services/delegation-adapter/Cargo.toml
```
