# R292 — authority-only signed Task Child: real native EVM / OPA rehearsal

Parent: `fa61e186e9298339ea4dd5644f019efbe69ceb8b`  •  Branch: `refactor/post-prof-plan-contracts-20261021`

## Scope

The existing zero-LLM-billing `engineer-direct-native-evm-e2e.yml` is
extended only when explicitly triggered via the fixed checkpoint file.
No long native EVM suite is automatically triggered by every TypeScript
commit. It runs disposable Anvil **and** the pinned OPA policy service,
without Gitea, the HTTP signing Adapter, or Gemini.

A separate R292 process builds the test-only authority-only Engineer
receipt with a fresh throwaway Ed25519 key and a deterministic fake Gitea
revision. This is **not** a human Engineer production approval or a
real Gitea-pinned repository snapshot. The test exercises:

1. The same **real Rust Engineer Node-API** issues a temporary
   read-only planning root and, only after local retirement and native
   root revocation, issues the independent operational root.
2. The real Coordinator binds exactly one dynamic Backend Task, and
   `TrustedAuthorityOnlyChildIssuer` requests its exact grant via
   the same owner's **native Rust IPC**. Both issuer and Gateway reserve
   separate private, crash-durable Child intent journals.
3. A genuine signed agent VP is produced via the native owner and
   checked independently by `loadDirectCoreRustVerifier()` with
   EVM trust, accumulator witnesses and live Status List evidence.
   R289 `root_credential_id` must equal the Engineer operational root.
4. Real OPA policy must **allow** the read-only exact canonical
   `read_file` permission on `feature/account-suspension`.
5. Despite successful native proof plus OPA, authority-only
   `executeAuthorization` **must deny** before any provider effect,
   and the executable challenge is one-use.
6. A separately valid, same-root Child with an **unregistered ID** is
   rejected by the enrolled Gateway Task binding.
7. The previously signed VP fails independent Rust verification after
   root revocation is recorded on EVM; provider call count stays zero.

## What this does NOT establish

The E2E uses a synthetic approved session/Gitea SHA and no actual
Backend/Frontend/Test work or Gitea/Docker provider call. Dynamic
dependency completion proofs, durable flight-fence / effect attribution,
and executable Gateway policy remain missing. **No provider-enable flag
or legacy fallback is introduced.** Real EVM verification is a
precondition, not an authorization to execute anything.

Do not infer R292 success merely from a green Fast CI. Require the
specifically named **Engineer Direct Rust Core - EVM VP Verification**
workflow to pass on the exact R292 trigger SHA and inspect its R292
step before reporting the native rehearsal as verified.
