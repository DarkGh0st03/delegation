# Direct Software Engineer → Core Rust (R225)

This crate is the new **trusted Engineer in-process Rust Node-API module**.
It is an alternative to the historical Engineer → Unix socket → Rust
Adapter process route. It is **not** a second issuer: the Rust
`CryptoRuntime` itself is instantiated **only once**, inside the same OS
process as the protected Engineer host, on a dedicated Rust thread.

```text
Software Engineer (trusted Node host)
  └── direct Node-API binding (.node)
        └── ONE Rust CryptoRuntime [keys / parent DCs / status / EVM]
              └── authenticated Unix socket, delegated commands ONLY
                   ├── Orchestrator issue_child
                   └── Orchestrator / Backend / Frontend / Test create_presentation

Cloud Access Gateway
  └── separate PUBLIC-ONLY native Rust verifier (delegation-core-node)
       └── DID / EVM / signed status / accumulator verification
```

Root issuance and confirmed revocation call the addon *in-process*;
there is no adapter HTTP request, intermediary Unix socket, MCP Server
or model-visible issuance tool between Engineer and Core Rust. The socket
owned by this process refuses `issue_root` and `revoke_root` even when
an Engineer bearer is supplied, and is only for authenticated Child/VP
commands. This preserves a single status/issuer authority, including
in-memory parent credential lookup for signed Child DCs.

The owner native bridge reuses the **existing** `delegation-adapter`
Rust library's `CryptoRuntime`, permission model and EVM publisher. It
does NOT construct an independent Core implementation or copy private
key state into JavaScript. The `delegation-adapter` **HTTP executable is
not part of this new deployment**.

## Build and package (Linux, Rust 1.99 / Node 22.15)

```sh
cargo build --release --manifest-path services/delegation-engineer-node/Cargo.toml
mkdir -p poc/packages/orchestrator-runtime/src/native
cp services/delegation-engineer-node/target/release/libdelegation_engineer_node.so \
  poc/packages/orchestrator-runtime/src/native/delegation-engineer.node
```

Set `ENGINEER_CORE_NATIVE_MODE=1` **only** on the protected Software
Engineer Node process. Configure `ADAPTER_ENGINEER_NATIVE_SOCKET` to a
fresh, absolute, private local socket path, and provide the existing
trusted Rust caller identities/tokens and `ADAPTER_TRUST_PROFILE` and
EVM private/public configuration to this same process. Agents and
Orchestrator use only the private socket, and the Gateway its
`delegation-core-node` public-only addon.

Never start the old Rust Adapter HTTP process with a competing
`CryptoRuntime` at the same time. An existing native socket prevents
this addon from initializing a duplicate publisher at that pathname.
The protected deployment must also remove the old HTTP Adapter
service from its process-supervision configuration. There is no HTTP
fallback in `ENGINEER_CORE_NATIVE_MODE=1`.

## Validation boundary

`.github/workflows/engineer-direct-native-contract.yml` is an explicitly
requested, **zero-model-billing** gate. It compiles this actual .node
module and checks native Engineer Root → same Rust Child DC →
native Backend VP → direct Engineer revocation, including denial of a
root issued from the delegated socket. No fake cryptographic JS signer
is involved.

The tests in `trusted-engineer-crypto-port.test.ts` use an injected
binding *only to test* Node input pinning, response shape, error
redaction, and the no-fallback boundary. They are **not** proof of Rust
cryptography or EVM integration.

The new addon must pass this native gate and a real EVM/Gitea/Docker
signed DAG with the old Adapter process disabled before the project
can switch its default deployment from socket-issuer to direct Engineer
binding, retire the Adapter HTTP executable, or claim migration
complete.
