# R345.1 — Refresh new Test Child issue time after real Docker FAIL

The real native Docker FAIL+Backend repair can take longer than one
minute. R345's fresh Test Task was using `params()`, which reuses the
`issuedAt` timestamp captured *before* the initial three agent Tasks
and Docker FAIL. The existing native Rust Child issuer correctly
refuses such stale `valid_from` by its 60-second freshness guard.

R345.1 generates the new epoch-5 Test Child's valid_from at the moment
of actual issuance, retaining the **same Engineer operational root**,
distinct status-list entry, fixed Test branch permission and the
original approval ceiling. No freshness relaxation, additional trust
mechanism or new privilege is introduced.

This is a source-level prerequisite for the dedicated R345 native
FAIL→repair→retest workflow; Fast CI parser checks are not E2E proof.
The native R344 repair test remains separately running at its pinned
commit. No paid model usage, no main mutation or merge.
