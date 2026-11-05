# R299 — authenticated hierarchical grants across Engineer, Coordinator, Gateway and Core Rust

Base: `6730d6b0771c52bfec913b4fbefb079066314cc4` (R298). Branch:
`refactor/post-prof-plan-contracts-20261021`.

## Why

R296 proved a **real** native Rust/EVM + OPA + authenticated Gitea READ
from the authority-only path, using synthetic Engineer approval and an
exact file grant. R297 defined the canonical directory semantics. R298
persisted per-ancestor accumulator witnesses, permission mappings and
scope attenuation; its Rust/EVM CI passed on one SHA.

R298's final `AuthorizationContext.required_permission` was still
compared to disclosed VP permissions with exact equality, while the
authority-only Engineer contract, Coordinator, Gateway, Child issuer and
native Node binding still required exact URI pairs. An Engineer directory
grant could therefore NOT yet yield a scoped Task or authorize a covered
file read end to end.

## Changed, strictly fail closed

1. `authority-only-approval.mjs` accepts **canonical directory
   resource URIs** for file operations in a signed, immutable Engineer
   maximum grant. Repository/branch/session/objective signature checks
   remain. It does not turn directories into provider operations.
2. The new shared `giteaPermissionCovers` provides a **conservative
   preflight** for directory → same-operation narrower directory/file
   grants; repository/branch, component boundaries and encoding are
   checked. No textual prefix authorization. Non-file/branch operations
   remain exact. This function is not a cryptographic verifier.
3. Coordinator, Child issuer, independent Gateway Task admission and
   canonical Prepare preflight apply that same conservative subset
   preflight. No model can add grants absent from the signed Engineer root.
4. Rust Core **independently** checks `Permission::covers()` for each
   concrete `AuthorizationContext` required permission against
   accumulated, disclosed and signature-validated VP grants. Its R298
   ancestor/attenuation witness verification, trust, revocation, and
   expiration are unchanged. Multipermission authorization remains
   all-or-nothing.
5. `DirectCoreRustVerifier` adds an explicit trusted
   `allowGiteaScopeCoverage` option (default **false**).
   Legacy/signed-DAG verifier results continue requiring exact permission.
   The actual Gateway Execute only honors the scoped response for
   `authorityOnlyReadEnabled` and a specifically opted-in native
   `DirectCoreRustVerifier` instance, and still requires independent OPA,
   a private one-flight journal and real provider result/evidence.
6. `loadDirectCoreRustVerifier` accepts the same owner-controlled
   optional setting; no public HTTP/LLM input can switch this on.

## Checks

- Rust unit tests require one signed directory VP to cover exact leaf
  requirements in atomic single/multi contexts, and deny sibling,
  traversal, repository/branch mismatch and operation change.
- JS tests cover strict path encoding, identity/branch separation and
  operation mismatch; direct native-wrapper tests verify the default
  exact-only mode and opt-in guard.
- Coordinator/Gateway tests use a synthetic signed Engineer directory
  authorization, a narrower leaf Task, and a separately enrolled Child.
  All remain staged and fail closed for outside grants.
- The previous R296 authenticated read, existing Rust/EVM verification
  workflows and Fast CI must remain green.

## Open limitations

**Not yet a full live R299 hierarchical Gitea/EVM acceptance test.**
Only the R296 real read with exact permission and R298 live EVM witness
path had been validated before this change. The next dedicated test
should run signed directory root → narrower file Child DC → native
Rust-required leaf → OPA → disposable Gitea READ with the R299 owner-only
feature opt-in, and deny a sibling, operation change and revoked root.

The canonical Planner, GUI and signed-DAG entrypoints have not migrated
to permission-only authorizations; the operational autonomy and recovery
loop still require work. No unreviewed provider writes, Docker, PR,
automatic merge or paid Gemini invocation is enabled by this change.
