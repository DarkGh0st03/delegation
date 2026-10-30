# R121 — One-use verified remote Test FAIL → new signed repair epoch

Branch: `refactor/post-prof-plan-contracts-20261021`. Date: 30 October 2026.

## Gap closed
R120 prevents a retry on the original signed Test Task. R115/R117
authenticate Gateway Docker FAIL via a **one-use** HMAC Unix-socket
command, but R106's planner previously assumed an in-process Gateway
getter and consulted the receipt twice. That is incompatible with IPC.

The R121 owner-only repair planner now optionally accepts a real
`TrustedPlanIpcClient`, the SAME Coordinator as the signed Rust-root
epoch intake, and a durable Gateway lease/session. Its first validation
uses `prepareTrustedRemoteRepairFeedback`, then checks the live
Gitea feature HEAD against the Runner SHA. A single untrusted proposal
callback can propose only bounded Tasks and exact parent-root grants.

After the proposal, the intake independently revalidates signed Engineer
approval, actual issued Rust parent and all durable epochs, **without
replaying** the one-use IPC confirmation. The pinned feature HEAD is
checked again. Only then can a new, immutable, anti-replay DAG epoch be
reserved. The result has `execution_authorized:false` and
`child_credential_issued:false`.

## Regression boundaries
Six new tests use real signed Engineer fixture, actual Gateway registry
and HMAC IPC, durable session journal, and a stubbed Gitea metadata
reader. They check one-use reservation, root revocation, branch SHA
drift before/after the model, out-of-root proposal and wrong owner.
There are **NO** paid model, Docker, GitHub main, or PR side effects.

## Still missing
This is the R121 bridge from verified FAIL to new immutable plan,
NOT a complete repair. The true Engineer Host still needs to wire its
owner-only callback to the Gateway R109 discovery port, admit the
new plan, issue child DCs and execute authorized Gitea/Docker repairs
before a review-only PR can be accepted. The existing Functional Signed
DAG fixture remains invalid (same-Task retry) and must not be greenwashed.

No Gemini billing or merging to main.
