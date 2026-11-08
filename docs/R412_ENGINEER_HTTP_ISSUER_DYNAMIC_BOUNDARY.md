# R412 — HTTP Engineer issuer is late-loaded only under the historical MCP effect

8 November 2026; branch `refactor/post-prof-plan-contracts-20261021`, PR #38 Draft. Baseline `00ba57c3` passed [Fast CI #42519208693](https://github.com/DarkGh0st03/delegation/actions/runs/42519208693) and [native Security CI #42519208790](https://github.com/DarkGh0st03/delegation/actions/runs/42519208790), both SUCCESS 2/2.

## Actual behavior

`trusted-engineer-legacy-mcp-http-port.ts` previously statically loaded `SoftwareEngineerAuthorityBootstrap` from `authority-client.ts`. R412 removes that eager import. The historical MCP/HTTP port is still a **synchronous factory**; it performs the same immediate positive fixture permission gate and explicit nonempty Adapter URL/token checks as before.

Only during a gated, one-use private MCP `root_issue` or `root_revoke` effect does the port execute `import("./authority-client.ts")`. The fixture gate is checked at construction, operation entry, lazy-loader entry, after the async import, inside the private MCP callback and immediately before the HTTP effect. A change to canonical native mode at any point denies access without falling back. The signed Root input remains a `structuredClone` snapshot before the first async boundary; the existing owner-private MCP SDK receives only an opaque single-use reference and ack.

R385.17 now rejects **static issuer imports from either allowlisted historical runtime caller**: Engineer's private MCP fixture and Runner's gated EVM fixture. The test suite additionally verifies the tracked runtime graph has exactly these two dynamic issuer caller edges, preserves canonical/native denial, confirms synchronous config validation and rejects opt-in withdrawal without any fetch.

## Limits and guarantees

The historical HTTP root issuer `authority-client.ts` and transport `authority-adapter-transport.ts` are **retained** for explicit legacy EVM and offline fixture consumers. All three reviewed-DAG compatibility wrappers are also retained. R385.17 reports unverified computed/external consumers and `deletionAuthorized:false` throughout. Four private Child/VP crypto MCP modules remain protected. The canonical Engineer and Gateway direct Rust paths, signed immutable Root permissions, Child/VP/OPA/Gitea CAS, native Test FAIL→recovery→PASS, Security CI/Human Gate and Draft PR remain unchanged.

No paid Gemini calls, privilege expansion or main merge. Require Fast CI and full no-AI native Security CI on **R412 HEAD**, not just the R411.2 baseline.
