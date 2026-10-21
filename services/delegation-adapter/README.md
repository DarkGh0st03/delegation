# Rust Delegation Adapter

The Delegation Adapter is the internal Rust service that exposes the existing delegated-authorization framework to the current trusted TypeScript Gateway and private Agent runtimes.

## Phase 2 boundary

The service provides:

- `GET /health`;
- authenticated `GET /v1/whoami`;
- `POST /v1/credentials/root`;
- `POST /v1/credentials/child`;
- `POST /v1/credentials/status`;
- `POST /v1/presentations`;
- `POST /v1/verify`;
- `POST /v1/verify-multiple` (Gateway-only composite verification);
- distinct internal caller credentials;
- deterministic caller -> role -> identity binding;
- capability separation between Engineer, Orchestrator, specialized Agents and Gateway.

Internal callers authenticate with:

```http
Authorization: Bearer <service-token>
```

The signing/issuer identity is selected server-side from the authenticated caller. The request body never chooses the identity whose private signing material is used.

## Stage 5: composite verification (no execution)

The existing `POST /v1/verify` remains backward compatible with a
single `required_permission`.

The additional authenticated `POST /v1/verify-multiple` accepts
`presenter`, `audience`, `challenge`, `required_permissions`
(an array of 1–128 distinct permissions) and `signed_vp`. Only the
Gateway caller with the VerifyPresentation capability may invoke it.

The adapter constructs `AuthorizationContext::new_multiple` and passes
the **whole** set to the Core Rust DelegationVerifier, which checks VP
binding, disclosed permissions, accumulator witnesses, delegation-chain
status and trust. If any permission is not verified the endpoint returns
an error instead of a partial VerifiedDelegation result.

This endpoint performs verification **only**. The Gateway separately
checks OPA for every proposed action and does not execute composite
provider operations during this refactoring stage.

## Stage 8B — Shared public verification artifacts (opt-in)

The EVM Adapter can publish **public-only** verification artifacts into a
directory accessible to an independently deployed Rust verifier. Enable it
only with an **operator-controlled**, dedicated directory:

```sh
ADAPTER_TRUST_PROFILE=evm
ADAPTER_PUBLIC_ARTIFACT_DIR=/var/lib/delegation/public-verification
```

Without `ADAPTER_PUBLIC_ARTIFACT_DIR`, the historical Adapter
in-memory material providers remain unchanged. When enabled:

- After confirming the on-chain accumulator commitment for each managed
  issuer, the Adapter stores its public key and setup parameters using
  canonical compressed Arkworks serialization, keyed by issuer and
  immutable material version. Another Rust process can recover the same
  bytes through `FilePublicArtifactStore<Bn254>`.
- After registering/updating a Status List on-chain, the Adapter
  publishes its exact signed compact JWT to an atomically replaced
  shared file. Only original JWT bytes, **not** the decoded JSON, are
  kept in this store so that the verifier can match the on-chain hash.
- Directory names are derived from SHA-256 identifiers rather than
  issuer/URL-controlled paths. Files are size-bounded; symlink file
  targets and inconsistent immutable versions fail closed.
- The Adapter may write to this directory. The future Gateway-native
  Rust verifier should mount it **read-only**, together with
  independent DID/EVM-read access. Never store issuance private keys,
  caller bearer tokens, unsigned authority assertions or root DCs in
  this directory.

**Critical trust boundary:** a file is not an authorization decision.
The independent verifier must continue to use
`EvmTrustResolver` to validate identity status, trust anchors and
exact public-material version/hash against `IssuerRegistry`, and
`JwtAuthenticatedStatusListCredentialProvider` together with
`EvmAnchoredStatusListResolver` to validate both the issuer's
signature and the **current** on-chain Status List commitment. Missing,
tampered, stale or inconsistent artifacts must reject the VP.

**Limitations:** this file-based store is an initial local/container
sharing mechanism, not yet a production remote artifact service.
The native Gateway addon was subsequently implemented in Stage 8C
(`services/delegation-core-node`). The real signed-VP/OPA/Anvil test
[GitHub Actions #39576496255](https://github.com/DarkGh0st03/delegation/actions/runs/39576496255)
passed, including denial of replay, wrong challenge and on-chain
revocation; the provider was a non-mutating mock. The legacy
`adapter` verifier remains the default until wider runtime
compatibility is validated.
The EVM issuer bootstrap still requires a fresh or matching chain; this
change does not introduce persistent private issuer identities.
An on-chain Status List update and its file replacement are not one
distributed transaction. In the short interval between them,
verification must deny stale artifacts instead of authorizing on
an old status.

## Capability model

- Engineer -> root Delegation Credential issuance + status management for credentials it issued
- Orchestrator -> child Delegation Credential issuance + status management for credentials it issued + own VP creation
- Backend -> own VP creation
- Frontend -> own VP creation
- Test -> own VP creation
- Gateway -> VP verification only

The root credential is restricted to Engineer -> Orchestrator. Child issuance is restricted to Orchestrator -> Backend/Frontend/Test.

Status updates are issuer-bound: an authenticated caller can update only credentials whose `issuer` matches its server-side identity. Revocation is terminal; suspension can be set and later cleared. In the EVM profile, each update mutates the Bitstring Status List, signs a fresh compact JWT, anchors the new exact JWT hash through `IssuerRegistry.updateStatusList`, and only then replaces the locally served current artifact.

The existing Rust framework remains responsible for non-escalation, temporal capping, accumulator/witness construction, selective disclosure, VP Ed25519 signing and DelegationVerifier checks.

## Current trust backend

The Adapter supports two explicit trust profiles. The default in-memory profile is deterministic local/test support; the canonical full E2E selects EVM explicitly with `ADAPTER_TRUST_PROFILE=evm`. The EVM profile resolves live enterprise trust and accumulator commitments from the chain, resolves Ed25519 verification keys through `did:ethr`, authenticates signed Status List JWTs, and checks their exact artifact commitments against the current on-chain anchor.

Status List lifecycle is implemented in both profiles. The EVM profile preserves the separation between off-chain artifact contents and on-chain current-state commitment/version.

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
cargo test --manifest-path services/delegation-adapter/Cargo.toml --locked
```

Run service:

```bash
cargo run --manifest-path services/delegation-adapter/Cargo.toml --locked
```
