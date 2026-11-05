# R323 — owner-native remote ADK Task prebinding

This review checkpoint ties the R322 HMAC Unix task binding path to
the **active live authority-only Coordinator**, the original
`TrustedAuthorityOnlyChildIssuer`, and the independently enrolled
Gateway Task/Child. The agent does not choose identity, permission,
role, branch or provider Git HEAD.

The new Gateway-side `assertTrustedOwnerRemoteEffectBinding` is
an in-process, NO-EXECUTION proof: it returns minimal identity/Child
metadata ONLY after active authority, enrolled native Child,
incomplete Task, satisfied dependencies, matching Engineer root and
unexpired credential checks. It has no HTTP/MCP/A2A route.

The Orchestrator owner-side `TrustedAuthorityOnlyRemoteEffectOwner`
extracts one exact Task effect from immutable Coordinator permissions.
For `update_file`, it decodes and then independently
recanonicalizes the selected Gitea file resource under the exact signed
branch. For `run_tests`, it requires a Test role and exact branch URI.
Read grants can coexist; multiple side effects or unsupported
`create_file` deny. It checks the native issued Child against the
Gateway's independent enrollment and the current root, then stages
the owner-private one-shot port in R322's owner registry BEFORE
sending minimal source-free pins over authenticated owner→agent IPC.

A bind attempt is terminal: on private IPC uncertainty the owner
port is fenced and cannot be replayed. The remote bind receipt never
authorizes an effect; Rust VP/EVM status, OPA and real Gitea/Docker
remain enforced at later Gateway Prepare/Execute. The caller must
already construct a genuine `TrustedAuthorityOnlyEffectStager`
with the exact request store/HEAD before invoking owner bind.

Offline tests use substituted Coordinator/issuer/Gateway method
outputs to exercise logic and fail-closed mismatches. They are NOT
independent evidence of native Root/Child verification. A new
native Docker/A2A integration on this exact SHA is still required.
No paid inference, no merge, no broad CI rerun.
