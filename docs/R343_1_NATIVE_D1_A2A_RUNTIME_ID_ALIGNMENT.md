# R343.1 — Native D1 runtime Task ID matches protected ADK/A2A binder

R342 created a fresh Gateway Task with 32 random hex characters after
`dispatch_`, but the canonical `TrustedAuthorityOnlyA2AOwner` and
`TrustedAuthorityOnlyRemoteEffectOwner` binders require **exactly 22**
suffix characters. The Gateway-only stage accepted the longer ID, so
this defect was not visible in R342's isolated binding/Child tests.

Use 11 CSPRNG bytes → 22 hexadecimal characters, preserving a fresh
owner-selected ID and aligning the real D1 Gateway Task with the
existing ADK/A2A path, without widening either binder's validation.
The R342 positive fixture now asserts the canonical Task ID.

This does not expand a permission, issue a new root, or start
an agent. The R343 real native FAIL→D1 Child test at its previous SHA
remains an independent proof of Gateway enrollment only; the new ID
must be exercised by the next full ADK/A2A D1 edit test. No paid model,
`main` change or automatic merge.
