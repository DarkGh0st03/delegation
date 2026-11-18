# Rust delegation library (`delegation-adapter`)

Rust library that wraps the core `delegation` crate for the PoC. It is
not a network service. It is linked only into the native Node-API addon
`services/delegation-engineer-node`, which starts one `CryptoRuntime`
per trusted process:

- **Engineer core** (`ADAPTER_SIGNING_ROLE=engineer`): issues Root
  Delegation Credentials and revokes them, and answers the Gateway's
  read-only status and Root inspection;
- **one wallet per role** (Orchestrator and each specialist agent): the
  role's signing key is generated in that process and only its public
  key is published on-chain. The Orchestrator wallet issues Child DCs;
  every wallet creates its own role's VPs.

No process receives another role's private key. Other roles are known
only by their public DID.

## Modules

| Module | Purpose |
|---|---|
| `auth.rs` | Caller registry: maps each caller token to exactly one role (Engineer, Orchestrator, specialists, Gateway) and its capabilities. |
| `config.rs` | Reads the trust profile, the signing role and the caller identities from the environment. |
| `crypto.rs` | `CryptoRuntime`: Root/Child issuance, VP creation, status update/read, verification. |
| `engineer_native.rs` | Private Unix socket (mode 0600) of a runtime, one bounded request per connection. It refuses `issue_root` and Root revocation, which only the Engineer process calls in-process. |
| `evm_profile.rs` | EVM trust profile: `did:ethr` keys, issuer registry, accumulator and Status List anchors; publishes public verification artifacts. |

## Capability model

| Caller | Allowed |
|---|---|
| Engineer | Root DC issuance; status changes of credentials it issued |
| Orchestrator | Child DC issuance (subset of the Root); status of its Child DCs; its own VP |
| Specialist agents | their own VP only |
| Gateway | read-only status and Root inspection; VP verification runs in the Gateway's own public-only addon (`delegation-core-node`) |

The signing identity is always chosen from the authenticated caller,
never from the request body. Non-escalation, temporal capping,
accumulator witnesses, selective disclosure and VP Ed25519 signatures
come from the core `delegation` crate.

## Trust profiles

- `ADAPTER_TRUST_PROFILE=in-memory` (default): deterministic, for tests.
- `ADAPTER_TRUST_PROFILE=evm`: used by the Docker deployment. Issuer
  trust, accumulator commitments and Status List hashes are anchored on
  the chain. With `ADAPTER_PUBLIC_ARTIFACT_DIR`, public material
  (accumulator parameters, signed Status List JWTs) is written there
  for the Gateway verifier, which mounts it read-only and still checks
  every artifact against the chain.

## Environment

```text
ADAPTER_SIGNING_ROLE             engineer | orchestrator | backend | ... (one per process)
ADAPTER_CALLER_<ROLE>            caller token of the roles this process serves
ADAPTER_ID_<ROLE>                public DID of each role
ADAPTER_ADDITIONAL_SPECIALISTS   extra specialist roles (e.g. docs,data,devops)
ADAPTER_TRUST_PROFILE            in-memory | evm
ADAPTER_PUBLIC_ARTIFACT_DIR      optional public artifact directory (evm)
```

The Engineer console builds these environments
(`poc/engineer-console/src/trusted-core.mjs`) from the secrets generated
by `deploy/bootstrap/setup.mjs`.

## Tests

```bash
cargo test --manifest-path services/delegation-adapter/Cargo.toml --locked
```
