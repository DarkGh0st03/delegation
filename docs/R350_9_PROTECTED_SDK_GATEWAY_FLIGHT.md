# R350.9 — One original Engineer session: protected SDK A2A plus crash-durable Gateway flight

R350.4 previously passed an arbitrary callback to an exposed low-level A2A Owner and fabricated its Gateway Prepare response. R350.8 separately exercised actual Gateway Prepare and its crash-durable Task fence. This change unifies the two proofs in **one** R349-reviewed offline integration test.

The owner constructs a real InMemoryRequestStore and calls actual Gateway prepareAuthorization against the same authenticated Engineer permission subset and registered Task/Child. It binds the original Gateway's preflights and issues a one-shot TrustedAuthorityOnlyEffectStager. A real Backend ADK/A2A SDK agent sends update_file through protected Unix IPC to that exact stager; the genuine TrustedAuthorityOnlyGatewayAdmissions and DurableAuthorityOnlyTaskFenceJournal persist the original session/root/Task/Child/request fingerprint before any simulated provider response. Fake success fields cannot mark the Task completed.

The lower-level SDK A2A Owner is no longer returned by startSdkA2AOwner. The original review session exposes only an immutable readiness descriptor, then guarded dispatchEnrolledTask / attestEnrolledTaskCompletion. Replay is denied and missing independent completion evidence triggers fail-closed operational root retirement.

**Limit:** Native Child response, mutation-intent preflight, VP transport and Gateway Execute/Gitea response are still **offline fixtures**, not native Rust/EVM/OPA or a real provider write. The existing R331 disposable E2E uses live Rust, Gitea, OPA and Docker in its separate session. The next gate must replace these fixtures with R331's real native ports and attested provider receipts under this exact R349→R350 session, followed by persistent crash reconciliation.

No paid Gemini inference, main modifications or merges.
