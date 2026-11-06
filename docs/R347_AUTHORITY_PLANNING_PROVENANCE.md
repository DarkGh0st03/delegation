# R347 — permission-only Planning provenance and active persistence

The new TrustedActiveAuthorityPlanning bridge requires the actual existing
read-only Planning Coordinator, its identity-bound Gateway read port and the
R346 Planner. It calls proposeAuthority once, rechecks active preliminary
read authority around model and persistence operations, signs a separate
backend provenance envelope, verifies it with independently pinned keys and
context, persists with O_EXCL and reloads before returning. Wrong signer
or store context fails before invoking the model. Legacy operational DAG
activation/review gates are not invoked.

The dedicated Ed25519 domain/protocol contains the permission-only proposal,
trusted snapshot, grounding count and bounded times. Task/DAG fields cannot
enter the proposal. Backend provenance is NOT Engineer approval and cannot
issue a root or execute effects. The loaded proposal feeds the existing
selectAuthorityOnlyGrant decision; Engineer signing remains independent.

Storage requires canonical owner-private directory/files, no symlink or
hardlink file, bounded payload, fsync and no overwrite. Session filenames
are separate from legacy plan checkpoints. A late or retired Planning result
cannot be returned as a valid active handoff. An ambiguous persisted result
is terminal and requires owner reconciliation.

Local tests exercise actual Ed25519 provenance, independent context pins,
protected persistence, tamper/expiry/replay denial, and lifecycle ordering.
The active Coordinator/port outputs are controlled test doubles in lifecycle
tests, not proof of native Planning roots or live Gitea. R346 separately
exercises the actual ADK Runner with a free scripted model.

Integration boundary: this is an explicit trusted owner API. The canonical
Engineer GUI approval server and production launcher still need to consume
this protocol, sign only the Engineer permission decision and transition to
the authority-only operational session. No paid inference or native suite
is triggered by this change.
