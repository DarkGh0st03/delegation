# R352.3 — pin native D1 A2A dispatch to the independently checked ADK instruction

R352.2 admitted an original-root D1 Task and Child at Coordinator/Gateway, but the general `dispatchEnrolledTask` interface still accepted a caller-authored instruction string. Permission ceilings cannot by themselves prove that a repair instruction equals the vetted one-shot ADK proposal.

The original Engineer owner now pins `{taskId,runtimeTaskId,instruction}` immediately after successful native D1 Child enrollment. An attempted A2A dispatch for that exact runtime Task is denied unless its Task ID and instruction match the private pin exactly and no second failure candidate is supplied. Rejection occurs **before** the one-shot dispatch-attempt fence and before agent execution. The read-only admission receipt returns the pinned instruction; it is not a credential, approval, or successful provider effect.

The free R352 review-host regression now constructs an actual original-root D1 Child and owner-bound native `update_file` stager, rejects two mutated dispatch instructions without spending the Task, and verifies that the D1 Task cannot be independently attested before a real A2A report. The failed original Test remains incomplete, and its independent Runner FAIL source remains the prerequisite for the recovery Task. This does NOT yet exercise a successful D1 Gitea CAS mutation, replacement Test Task/Runner PASS, or real paid Gemini.

Next: execute the exact pinned D1 Task using the original native effect stager and independent authenticated Gitea receipt, then admit a new Test Task and prove a separate Runner PASS. Keep `main` unchanged and PR #38 in Draft.
