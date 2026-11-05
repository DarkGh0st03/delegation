# R296 — verified real read checkpoint

Commit: 7608b84f293f7510525d612252e7452bd11bebd2
Date: 2026-11-05

## Observed evidence
- Native Rust/EVM/OPA/Gitea workflow 42016528713: SUCCESS.
- Fast CI 42016528412: SUCCESS, same commit.
- Job 127208324634 reports provider_calls=1, gateway_read_executed=true,
  completion_attested=true, unbound_child_denied=true, revoked_root_denied=true,
  paid_model_calls=0.
- The test reads README.md from a disposable Gitea feature branch.
- Engineer approval is a synthetic CI approval. This is not the full
  Account Suspension implementation, Gemini pilot, or autonomous recovery.
- The read gate is owner opt-in and supports one reserved operation per Task.

## Next: hierarchical Rust permissions
Code inspection identifies a coordinated protocol change:
1. delegation_issuer.rs selects parent witnesses by exact permission equality.
   The parent-count restriction also prevents one directory grant from
   yielding several distinct descendant permissions.
2. DelegationChainEntry stores witnesses, but no corresponding per-ancestor
   permission vector.
3. delegation_verifier.rs passes the final disclosed permission vector to
   every ancestor accumulator verification.
4. Selective disclosure and witness reordering must preserve ancestor
   permissions and witnesses together.

Required implementation: explicit canonical repository/branch/path containment;
authenticated ancestor permission vectors aligned with witnesses; attenuation
checked at every hop; unchanged operation and no authority expansion.
Do not replace equality with a prefix check alone.

Required tests: directory -> subdirectory -> file; one directory -> multiple
files; reordered selective disclosure; sibling-prefix rejection; branch/repo
mismatch; traversal/encoding ambiguity; tampered ancestor resource or witness;
unchanged exact-permission credentials. Gateway/OPA integration follows the
cryptographic implementation.

No paid Gemini workflow was started.
