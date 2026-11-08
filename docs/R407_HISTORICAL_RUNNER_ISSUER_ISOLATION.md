# R407 — Historical Runner executable issuer boundary

**8 November 2026** — branch `refactor/post-prof-plan-contracts-20261021`, PR #38 Draft. Parent SHA `bd705cbb4f511ba8ac57d5951bb19b63c5c67154` has [Fast CI #42512317136](https://github.com/DarkGh0st03/delegation/actions/runs/42512317136) SUCCESS 2/2 and [Trusted Engineer Two-Root Authority #42512317054](https://github.com/DarkGh0st03/delegation/actions/runs/42512317054) SUCCESS.

## What changed (and what has not)

The legacy scenario `poc/apps/test-runner-controller/scripts/approved-gateway-runner-session.mjs` imported `SoftwareEngineerAuthorityBootstrap` from `authority-client.ts` eagerly at module load, even when it ran the default non-native scripted fixture and never requested an Adapter-root. R407 removes this **static runtime dependency**. It loads the historical HTTP Adapter issuer via a literal `await import()` only inside its pre-existing `if(native)` branch, after a local fail-closed gate.

The branch remains the explicitly opted-in historical EVM fixture using `APPROVED_RUNNER_NATIVE_EVM=1`. The gate denies attempts to enter it when canonical `DELEGATION_GATEWAY_ARCHITECTURE=authority-only`, direct Engineer Core, native Engineer socket, strict native full-recovery, or native private-MCP profiles are configured. The default scripted fixture never loads `authority-client.ts`. The canonical Software Engineer Core and Gateway paths are unchanged. No credential, plan scope, Docker outcome, model or A2A behavior is faked.

The file `authority-client.ts` **is retained**, and so is `authority-adapter-transport.ts`. A literal dynamic runtime caller still exists, alongside the explicitly gated historical Engineer MCP/HTTP compatibility port. This is an executable-load isolation step, **not** proof of deletion safety or replacement of the historical native-EVM fixture with the direct Node-API Rust Core.

## Tests and audit

Fast CI executes `poc/scripts/test/r407-historical-runner-issuer-isolation.test.mjs` offline, checking the absence of static imports, the single literal dynamic edge, the ordering of native selection → policy gate → import → construction, denial under every canonical Rust flag, and no imports/side effects from the gate. R385.17 still allows the exact known historical script **but no new caller**, reports the runtime edge as dynamic and retains `deletionAuthorized:false`. R402 static reachability and R404 configured-test inventories remain independent.

## Remaining

Migrate the actual historical EVM Router/Runner to the canonical native Rust issuer only when its single-core Rust lifecycle is demonstrably available in that test environment; do not silently replace its currently authenticated legacy HTTP path or delete negative security coverage. Subsequently migrate the three historical signed-DAG handoffs and the two recovery-controller dynamic imports under independent signed Root/Child/VP/OPA/Gateway evidence. Perform native full Security CI after the final runtime cleanup. No paid Gemini invocation or main merge without explicit authorization.
