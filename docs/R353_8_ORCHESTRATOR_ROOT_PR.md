# R353.8 — Original operational-root VP for the Orchestrator PR

R353.7 native run 42250882152 passed Backend, Frontend, a real failed Docker
Test, D1 repair and independently attested retest. It failed before PR execution:
the TypeScript issuer attempted an Orchestrator Child, while Rust deliberately
permits Child recipients Backend, Frontend and Test only.

This revision restores that specialist-only issuer contract. It does not change
Rust. The original Engineer owner registers the proposed Orchestrator PR Task
and binds it to the same operational root without issuing or enrolling a Child.
The native PR presentation uses that original root, with Rust-verified depth zero.

Gateway retains exact Task/session/root/presenter/permission checks, authenticated
latest Test and current Gitea HEAD checks, one durable flight, consumed Prepare,
Rust VP verification, independent OPA, one provider POST, independent provider
GET and separately attested PR Task completion. A dedicated root-PR journal path
uses an explicit authority marker; ordinary specialist flight and completion
methods still reject a root credential. Foreign credentials and depth-one PR
presentations fail before provider I/O. Root retirement must invalidate the VP.

Validation before source publication: 41 targeted Engineer/session tests PASS
locally, including signed PR self-delegation rejection and distinct root journal
flight/completion/replay checks. Native script syntax and diff whitespace pass.
Local Unix socket tests cannot run in this environment (listen EPERM); Actions
must validate owner integration and native Rust/EVM/OPA/Gitea/Docker execution.
No native PASS is claimed by this source revision.

Outstanding roadmap: real branch creation, autonomous Executor control loop,
model-visible safe recovery diagnostics, active Child MCP transport, dynamic
discovery, hierarchical/composite preliminary reads and canonical launcher
migration. The native scenario remains scripted, its application baseline is
fixture-generated, and its preliminary Gateway transport is a fixture. No paid
model calls or autonomous functional generation are claimed. PR #38 stays Draft;
merge remains human and separate.
