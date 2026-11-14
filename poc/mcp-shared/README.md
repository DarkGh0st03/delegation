# Private cryptography boundary

Per-Task signing never goes through a network service. The Orchestrator and
each specialist talk to **their own MCP-wallet process** (one signing key per
role, generated inside the wallet) over a private socket:

- `src/owner-private-child-mcp.ts` — the Orchestrator obtains a Child
  Delegation Credential for one Task (exact permissions, bounded lifetime);
- `src/owner-private-native-crypto-stdio.mjs`, `src/native-rust-transport.mjs`
  — an agent obtains the Verifiable Presentation for one Gateway challenge;
- `src/task-token.ts` — one-time Task tokens binding a request to its Task;
- `src/tool-failure-reason.ts` — bounded, secret-free failure reasons.

The models never see credentials, keys or tokens.
