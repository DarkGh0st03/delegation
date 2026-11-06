# R352.5 — Original Engineer D1 replacement Test and independent Runner PASS gate

## Purpose
Continue the SAME R349 authenticated Engineer permission-only operational root after the verified R352.1 original Runner FAIL and R352.4 original-root D1 Backend repair. The original failed Test remains **incomplete**: it is not marked successful or rewritten.

## Changes
- The owner records a D1 repair as attested only after the original protected A2A Owner returns independently verified Gateway/Gitea completion evidence. An A2A/model report alone does not unlock the retest.
- A new one-shot `proposeAndStageVerifiedD1Retest` operation asks the ADK decision proposer for **one fresh Test Task**. It accepts only the original authorized `run_tests` permissions, the original completed Test prerequisites plus the attested D1 repair, and a new Test ID/epoch. The original Coordinator and Gateway issue/enroll a **fresh native Child** under the unchanged Engineer root.
- The replacement Test instruction is privately pinned before A2A dispatch. Modified instructions, a second retest admission or replayed dispatches are rejected.
- The Test Agent's A2A result is never counted as Test PASS. Only the original Gateway's independent Runner PASS evidence observer records completion. The original Test FAIL remains absent from the successful-completion ledger; only an independently confirmed replacement PASS may unblock ordinary later decisions.
- The ADK proposer now receives the Coordinator's actual `nextEpoch`; a failed incomplete Test does not silently lower that epoch.

## New regression scope
The offline `trusted-authority-only-review-host.test.mjs` variant `failure-d1-retest` uses real protected ADK/A2A SDK servers, original owner handles and journals, authenticated failure and completion publishers/observers, with isolated Gitea/Rust/Runner fixtures. It checks:
1. original typecheck FAIL and no successful completion;
2. D1 Backend's exact owner-pinned repair and independent Gitea CAS observation;
3. failure to admit the replacement Test BEFORE the D1 independent completion;
4. new epoch-5 Test Task with a fresh native Child and the signed permission ceiling;
5. denied mutated retest instruction, re-admission, replay and fabricated original Test completion;
6. second Runner request pinned to the repaired commit SHA, independent PASS evidence and 4 completed out of 5 registered Tasks.

## Evidence status
**Source and free offline regression are committed, but a terminal CI PASS for this exact checkpoint has NOT been verified here.** This is not proof of real external Gitea/Docker D1 retest, not autonomous Gemini diagnosis or functional feature generation. No paid Gemini call, PR merge or `main` mutation was performed.

## Next gate
Run the focused test and Fast CI on the exact branch SHA, resolve any actual failures, then extend the original-session path to real native Rust/EVM/OPA/Gitea/Docker FAIL -> repair -> replacement Runner PASS. Keep paid Gemini disabled until explicit consent.
