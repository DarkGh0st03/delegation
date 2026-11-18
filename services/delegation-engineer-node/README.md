# Engineer core and role wallets (Node-API addon)

Node-API addon (`delegation-engineer.node`) that runs the Rust
`CryptoRuntime` of `services/delegation-adapter` inside trusted Node
processes started by the Engineer console. It exposes two entry points:

| Function | Process | Holds | Serves |
|---|---|---|---|
| `start_engineer_core()` | Engineer core | Engineer key, platform governance key | in-process Root issuance and revocation; Gateway read-only inspection (`read_issued_root`, `read_credential_status`) on a private socket |
| `start_role_wallet()` | one per role (Orchestrator, each specialist) | only that role's key | Child DC issuance (Orchestrator only) and the role's own VPs on its private socket |

```text
Engineer console (trusted)
 ├── Engineer core ── Root issue/revoke (in-process, never via socket)
 ├── wallet: Orchestrator ── issue_child, create_presentation
 ├── wallet: backend / frontend / test / ... ── create_presentation
Gateway
 └── delegation-core-node (public-only verifier: DID, EVM, status, accumulators)
```

Private keys never leave the Rust runtime of their process. Sockets are
created by the trusted owner with mode 0600 and accept one bounded,
token-authenticated request per connection. They are not MCP, A2A or
model-visible tools. A socket refuses `issue_root` and Root revocation
even with the Engineer token.

## Build

Built inside the Docker image (`deploy/Dockerfile`). Manual Linux build:

```sh
cargo build --release --manifest-path services/delegation-engineer-node/Cargo.toml
mkdir -p poc/packages/orchestrator-runtime/src/native
cp services/delegation-engineer-node/target/release/libdelegation_engineer_node.so \
  poc/packages/orchestrator-runtime/src/native/delegation-engineer.node
```

## Configuration

The console builds each process environment in
`poc/engineer-console/src/trusted-core.mjs`:

- Engineer core: `ENGINEER_CORE_NATIVE_MODE=1`,
  `ADAPTER_SIGNING_ROLE=engineer`, `ADAPTER_ENGINEER_NATIVE_SOCKET`, the
  Engineer and Gateway caller tokens, the governance and Engineer EVM keys;
- each wallet: `ADAPTER_SIGNING_ROLE=<role>`, `DELEGATION_WALLET_SOCKET`,
  that role's caller token and EVM key only.

Both receive the public chain configuration (RPC URL, registry
addresses, DID scripts, `ADAPTER_PUBLIC_ARTIFACT_DIR`).

## Tests

```sh
cargo test --manifest-path services/delegation-engineer-node/Cargo.toml --locked
```

The Node tests in `poc/packages/orchestrator-runtime/test/trusted-engineer-*.test.ts`
inject a binding to test input pinning, response shapes and error
redaction only; they are not evidence of Rust cryptography.
