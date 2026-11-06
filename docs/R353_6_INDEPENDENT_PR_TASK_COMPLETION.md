# R353.6 — Independent PR Task completion under original Engineer owner

The PR provider result remains a report until the original owner calls `attestEnrolledPullRequestCompletion` with exact original Task IDs. No PR number, receipt, SHA or model PASS can be supplied by the caller.

The concrete PR executor retains only its original confirmed provider provenance and supplies a protected completion observer. A separately configured Gitea client performs read-only branch/PR reads: original PR id/number, open/unmerged Draft, exact feature and base revisions, and unchanged branches around the read. The authenticated original Runner source is reopened before and after this independent observation. The Gateway then seals the existing original Task flight in its crash-durable completion journal and updates its successful-completion ledger. No second POST is performed.

Missing execution provenance, mismatched PR identity/state or moved feature/base branches cannot complete the Task. An ambiguous independent observation retires the original authority through the existing Gateway fence/Rust retirement path. Original provider calls are not retried. The normal mutation/read/Test completion routes keep their existing observer behavior; PR completion uses its dedicated observer.

Offline SDK variants cover successful original-owner completion, attempted completion before POST, closed/foreign PR, moved HEAD/base, caller-supplied receipt and replay. The positive flow must retain three successful development/Test Tasks immediately after POST and reach four only after the independent PR read and fsynced journal record. Gitea/Rust/OPA are explicit offline fixtures here, not a new native EVM proof.

Local validation: 27 Gitea client tests and 3 existing completion-journal/observer regressions PASS; integrated SDK tests require Actions because local Unix listeners are blocked. Next prepare one native same-root development/recovery/PR/completion run without paid models. No production PR, merge or paid inference is performed by this checkpoint.
