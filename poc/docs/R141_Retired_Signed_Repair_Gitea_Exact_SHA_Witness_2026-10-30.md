# R141 — Read-only post-retirement exact-Gitea-SHA witness

30 October 2026. Development branch only, no Gemini billing.

Capture a trusted witness while the ORIGINAL Engineer root is still
live, using `TrustedOperationalEpochIntake.verifiedEpochHistory()`,
the original root DC, and the signed latest repair DAG's exact Test
Task and `run_tests` branch grant. No model/A2A/HTTP caller can provide
the Task identity or branch to this witness.

After Gateway durable retirement, independently query a trusted
GiteaClient for the real current branch HEAD, ask R140's private
Gateway HMAC IPC for the exact-SHA verified Runner PASS of the signed
Test Task, and RE-READ Gitea HEAD to refuse racing edits. A Test
artifact or a former PASS on an outdated SHA is insufficient.

This intentionally remains a NON-AUTHORIZING observation:
`rust_root_revocation_verified:false` and
`pull_request_authorized:false`. The next phase must separately
verify EVM/native Rust root revocation and review-only PR policy,
then run an integrated R133–R141 proof with actual Gitea/Docker.

R141 Gateway offline tests use a real HMAC socket and signed epoch
registry with simulated Gitea/Runner effects. The independent real
Docker provider proof R139 is green at CI #41085369293 but still
must not be represented as signed recovery. Main unchanged.
