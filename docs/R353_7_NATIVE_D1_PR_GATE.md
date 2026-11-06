# R353.7 — One native original-owner recovery and PR completion gate

Adds opt-in `R3537_NATIVE_PR=1` on the already successful R352.9 reviewed D1 proof. It requires reviewed-native plus D1 modes and preserves existing modes without PR. The original permission-only review includes create_pull_request from the start; no new Engineer approval or operational root is introduced after failure.

After actual native Backend/Frontend writes, Docker FAIL, D1 repair and fresh Docker/acceptance PASS, ADK proposes the final Orchestrator PR Task. The original host issues/enrolls the PR Child, privately stages canonical HTTP Prepare, signs a VP through the existing private native Rust issuer socket, and executes through the actual independent Gateway Rust/EVM verifier, OPA and Gitea Draft-PR client. A separate Gitea reader must independently confirm the exact PR before Gateway completion is durably sealed. Replays are denied and root revocation is checked against the native PR VP.

Expected evidence: 6 registered Tasks, 5 independently completed Tasks (original Test still failed), 3 CAS mutations, 2 real Runner calls, one Draft PR creation, unchanged original root/main, no merge and zero paid calls. The new dedicated workflow is manual/checkpoint-only and is not triggered by ordinary source edits.

Scope remains explicit: scripted model decisions, known injected compiler repair and owner-preseeded functional app. The preliminary Planning Gateway transport remains a pinned-read fixture, and the PR VP uses the current private native IPC rather than claiming the final MCP topology. Native PASS may be declared only from terminal structured evidence, not from syntax/offline tests. Cleanup closes the Engineer listener even if failure already retired its root.
