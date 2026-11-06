# R350.1 — same-session Gateway admission after authenticated review

## Implemented

The owner-private R349 review host now provides a one-shot `admitOperationalExecution` method, available only after the same authenticated Engineer session has issued its independent operational root and activated the original dynamic Coordinator.

The host constructs a real `TrustedAuthorityOnlyGatewayAdmissions` instance using its **original** `SignedAuthorityOnlyFileStore`, original Coordinator, pinned repository, Engineer DID, session and base revision. It constructs a `TrustedAuthorityOnlyChildIssuer` from that same Coordinator, requiring an explicitly provisioned Rust-native crypto port and an independent private Child-issuance ledger. Gateway operational/task/Child ledgers must be distinct from the Coordinator/issuer ledger instances.

The Gateway independently validates the signed Engineer receipt and issued root, reserving its own durable session activation before reporting `gateway_authority_admitted_preflight_only`. A failed or ambiguous admission is one-shot, triggers operational-root retirement, and cannot silently fall back to signed-DAG. Close waits for any in-flight admission before retiring the Engineer root.

## Test and limits

Targeted offline regressions extend the original R349 test suite: the Gateway cannot activate before the operational transition; the same session is admitted only once; no Task or Child exists at admission; shared Child journals are refused and root retirement is observed. Native issuance and the Planning Gateway transport remain explicit offline fixtures in these tests.

**This increment does not yet issue a Child DC, bind a runtime Task, start an A2A agent, execute Gitea/Docker, or authorize a paid Gemini run.** Next R350 increment: owner-driven Task registration → independent Gateway Task binding → native Child issuance → Gateway Child enrollment → protected A2A owner bootstrap, retaining the R345.1 scripted E2E gates and crash-recovery requirements.

No modification to `main` or merge is intended.
