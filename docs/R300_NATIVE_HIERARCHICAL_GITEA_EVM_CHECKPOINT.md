# R300 — native hierarchical Engineer → Child → Rust/EVM → OPA → Gitea read

Base SHA: `f903e06b9ec668b53c66407873726498882da0a1` (R299.1).
Branch: `refactor/post-prof-plan-contracts-20261021`.

## Scope of this milestone

R299's 5 required free CI workflows were all green on the same SHA.
R296 already proved an exact-file permission end-to-end real read, but
did **not** exercise hierarchical attenuation of Engineer authority.

This R300 workflow exercises the *new* hierarchy with a single disposable
Rust/EVM + OPA + Gitea environment and zero LLM calls:
1. Test-only trusted Gitea owner creates `feature/account-suspension`
   from `main`, then seeds `apps/backend/users/account.ts` into that
   feature branch. This provisioning happens BEFORE authorization or agent
   execution, never through the Gateway.
2. The synthetic CI Engineer signs **only**
   `gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/directories/apps/backend # read_file`.
3. Native Engineer Rust issues the operational root with that directory
   ceiling; Coordinator independently creates one Backend Task with
   narrower `.../files/apps/backend/users/account.ts # read_file`.
4. Private native Rust issues Child DC with only this Task leaf, and
   Gateway enrolls the Child with an independent durable journal.
5. Backend signs an actual VP disclosing the leaf Child; the **independent
   Core Rust verifier** authenticates Engineer root and Child accumulator
   witnesses, the parent directory -> leaf attenuation, EVM trust/status,
   audience/challenge, and the exact concrete leaf required by Gateway.
6. OPA must allow. Owner-only Gateway reserves a durable flight,
   invokes exactly **one real Gitea read**, publishes a protected HMAC
   receipt, independently re-reads the file and attests completion.
7. Negative probes reject sibling-prefix, unrelated leaf, branch
   switching, operation elevation, path traversal, wrong challenge,
   different unbound Child, repeated Prepare and revoked root. Provider
   call count must remain exactly 1.

## Security and costs

The workflow runs **only** on `workflow_dispatch` or a change to
`.github/ci-checkpoints/r300-native-evm-request.json`; Fast CI checks
its script syntax separately. No Gemini/ChatGPT API key is passed, no paid
model run is invoked, no external production Gitea is used and no
`main` edit, PR, merge, Test/Frontend implementation or Docker provider
effect is authorized. Read-only authority-only opt-in remains explicit.

A green R300 proves native hierarchical read and completion on disposable
CI test infrastructure. It is **not** evidence that the complete dynamic
Account Suspension agents, multi-operation Task journal, autonomous
recovery, signed Engineer GUI or final PR workflow are complete.

## Interpretation

Do not mark this milestone complete merely because source code is
published. Require `R300 Hierarchical Native Gitea Read EVM and OPA
(No AI)` and Fast CI SUCCESS on the **same** SHA with the expected
JSON event `r300_authority_only_native_evm_staged`, provider_calls=1
and the scope/Child/OPA/completion evidence flags all true. Fail closed
if any stage does not complete.
