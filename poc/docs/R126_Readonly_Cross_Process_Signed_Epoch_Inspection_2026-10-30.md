# R126 — Read-only cross-process signed epoch ledger correlation

Date: 30 October 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.

R125 can admit a newly reserved repair epoch when Gateway has the exact
original live Rust-root-bound Intake. In actual deployment, Engineer and
Gateway are different processes and Gateway does not possess that Intake.
Copying a root ID from an IPC request would be a security violation.

R126 introduces `TrustedGatewaySignedEpochInspector`, a read-only
Gateway process component optionally configured via the operator-owned
`TRUSTED_PLAN_EPOCH_LEDGER_DIR`. It opens the fsynced owner-only 0700
journal, checks 0600 no-follow regular first-epoch file, reloads
original unexpired Ed25519 Engineer approval independently, then checks
the canonical epoch journal and all successive pure plan preflight
constraints against the **signed maximum** permission envelope. Every
record must match pinned session, original plan digest, epoch number,
current plan digest and replay-safe plan/Task IDs.

The HMAC Unix IPC `inspect_signed_epoch` returns only fixed digest pins,
`signed_epoch_ledger_consistent_not_native_root_verified`, and
`execution_authorized:false`, `gateway_epoch_admitted:false`,
`child_credential_issued:false`. A bare hash or signed plan does NOT
establish actual Rust issuance, grant validity or revocation state.

The live Gateway `admit_epoch` still requires the genuine original
Rust-root-bound Intake and completed failure quiescence: **signed ledger
inspection alone never activates Tasks or issues DCs**. Four offline
regressions prove signed epoch reads via actual HMAC Unix control,
wrong/stale pins, tampering and rejection of an independently generated
owner-only epoch that Gateway has not admitted.

Next: independent native Rust issuance + revocation evidence in the
Gateway process, then actual Gateway epoch admission, new Child DCs,
Gitea repair, Docker PASS and PR review-only. No paid Gemini, no main merge.
