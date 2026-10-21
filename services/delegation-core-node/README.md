# Native Gateway → Core Rust verifier (Fase 8C)

This package builds a **Node-API (.node) addon** for the Gateway. It links
directly to the existing `delegation` Core Rust crate and calls its
`DelegationVerifier<Bn254>::verify_verifiable_presentation`. It contains
**no issuer, DID publication, governance, signing, Adapter caller or
private-key code**.

## Deployment model

The existing Gateway defaults to `GATEWAY_VERIFIER_MODE=adapter`.
The optional `core-rust` mode requires an operator-built native addon at
`poc/apps/gateway/src/native/delegation-core.node`, installed on the same
OS/architecture/Node-API compatible runtime as the Gateway.

Linux build (Rust 1.99, Node 22.15):

```sh
cargo build --release --manifest-path services/delegation-core-node/Cargo.toml
mkdir -p poc/apps/gateway/src/native
cp services/delegation-core-node/target/release/libdelegation_core_node.so \
  poc/apps/gateway/src/native/delegation-core.node
```

**Required public-only configuration for the Gateway runtime:**

```sh
GATEWAY_VERIFIER_MODE=core-rust
CORE_RUST_RPC_URL=http://anvil:8545
CORE_RUST_CHAIN_ID=31337
CORE_RUST_DID_REGISTRY_ADDRESS=<deployed public contract address>
CORE_RUST_ENTERPRISE_REGISTRY_ADDRESS=<deployed public contract address>
CORE_RUST_ISSUER_REGISTRY_ADDRESS=<deployed public contract address>
CORE_RUST_PUBLIC_ARTIFACT_DIR=/var/lib/delegation/public-verification
CORE_RUST_DID_RESOLVER_SCRIPT=blockchain/did-client/resolve-did-json.mjs
```

The shared artifact tree must already exist and contain the `accumulators`
and `status-lists` directories populated by the **EVM Adapter**
(`ADAPTER_PUBLIC_ARTIFACT_DIR`). Mount the same directory **read-only**
inside the Gateway. It is never populated with private issuer keys or
signed VP JWTs. The DID resolver script must be installed and have its
JavaScript dependencies, and RPC/registry information must point to the
same EVM chain as the Adapter.

The addon validates the source configuration and connects to the EVM
chain at Gateway startup. It does not silently fall back to the Adapter.
Each verification runs as an N-API worker pool task, creates its own Core
Rust trust and status resolvers, and checks:

1. Signed VP against the current DID assertion key;
2. Presenter/audience/challenge and required permission(s);
3. Delegation witnesses and EVM-trusted issuer identity/accumulator data;
4. Signed Status List JWT and its **current** EVM commitment.

Failed, missing, expired or stale data cause denial. The Gateway retains
OPA evaluation and task-level plan-compliance checks as separate
requirements. The addon never contacts Gitea or authorizes anything by
itself.

## Tests and limitations

`Native Gateway to Core Rust (Offline)` CI builds the real addon, loads it
in Node, exercises malformed input and missing RPC/public sources,
then re-runs Gateway regression tests with the native module present.
The test suite does **not** yet demonstrate a successful signed VP
against live Anvil and the separately started Gateway; that full
credential-issuance-to-EVM-to-native-verification E2E remains required
before switching the default mode. No Gemini paid calls are made.

The Node-API worker pool prevents blocking the main JavaScript loop but
uses blocking I/O inside Rust, and per-verification DID and EVM RPC calls
have operational cost. The production hardening stage must add explicit
timeouts, concurrency limits, observability, and cancellation semantics
without weakening the on-chain freshness checks.
