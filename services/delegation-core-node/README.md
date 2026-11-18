# Gateway verifier (Node-API addon)

This package builds a **Node-API (.node) addon** for the Gateway. It links
directly to the existing `delegation` Core Rust crate and calls its
`DelegationVerifier<Bn254>::verify_verifiable_presentation`. It contains
**no issuer, DID publication, governance, signing, Adapter caller or
private-key code**.

## Deployment model

The Gateway always verifies VPs with this addon
(the console sets `verifier_mode: "core-rust"`); there is no other verifier. The
addon is built into the Docker image (`deploy/Dockerfile`) at
`poc/apps/gateway/src/native/delegation-core.node`.

Manual Linux build:

```sh
cargo build --release --manifest-path services/delegation-core-node/Cargo.toml
mkdir -p poc/apps/gateway/src/native
cp services/delegation-core-node/target/release/libdelegation_core_node.so \
  poc/apps/gateway/src/native/delegation-core.node
```

**Required public-only configuration for the Gateway runtime:**

```sh
CORE_RUST_RPC_URL=http://anvil:8545
CORE_RUST_CHAIN_ID=31337
CORE_RUST_DID_REGISTRY_ADDRESS=<deployed public contract address>
CORE_RUST_ENTERPRISE_REGISTRY_ADDRESS=<deployed public contract address>
CORE_RUST_ISSUER_REGISTRY_ADDRESS=<deployed public contract address>
CORE_RUST_PUBLIC_ARTIFACT_DIR=/var/lib/delegation/public-verification
CORE_RUST_DID_RESOLVER_SCRIPT=blockchain/did-client/resolve-did-json.mjs
```

The shared artifact tree must already exist and contain the `accumulators`
and `status-lists` directories populated by the Engineer core and the role wallets
(`ADAPTER_PUBLIC_ARTIFACT_DIR`). Mount the same directory **read-only**
inside the Gateway. It is never populated with private issuer keys or
signed VP JWTs. The DID resolver script must be installed and have its
JavaScript dependencies, and RPC/registry information must point to the
same EVM chain as the issuers.

The addon validates the source configuration and connects to the EVM
chain at Gateway startup. It has no fallback verifier.
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

```sh
cargo test --manifest-path services/delegation-core-node/Cargo.toml --locked
```

The full signed-VP path (real VP, EVM status, wrong challenge, replay
and revocation denial) is exercised by the local Docker deployment.

The Node-API worker pool prevents blocking the main JavaScript loop but
uses blocking I/O inside Rust, and per-verification DID and EVM RPC calls
have operational cost. The production hardening stage must add explicit
timeouts, concurrency limits, observability, and cancellation semantics
without weakening the on-chain freshness checks.
