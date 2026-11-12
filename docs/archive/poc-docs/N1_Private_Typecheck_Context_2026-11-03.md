# N1: private compiler feedback to repair editor

Parent: 63c0d8a5. Its Fast CI #41617992922 is SUCCESS on pinned Node 22.15.0.

A separate owner-private compiler context now reads only the retained typecheck
phase. It matches the host Runner effect's log reference, repository, branch,
SHA, first failed phase, and hash-verified log. Locations must match the
existing source-free Runner diagnostics. Original role read grants AND root
read grants filter disclosure; the newly admitted Task read grants filter it
again. Update alone does not disclose a message. Unknown/malformed contexts,
stale SHA and changed logs fail closed. Long messages signal truncation.

The public Runner schema remains source-free. Compiler text is untrusted data,
not authorization, instructions or proof of blame. No keys or full logs are
added to the model. Existing signed epoch, child issuance, Gateway readiness,
provider effects and exact-SHA Runner requirements are unchanged.

The native owner wires its private loader through the existing repair DAG and
admitted A2A dispatcher to approvedTaskInstruction. The context is serialized
as diagnostic_typecheck only for repair-editor Tasks. No new model or tool.
The repair proposer remains source-free; the editor receives the evidence.

Validation:
- 65 focused tests passed locally on Node 22.15.0, including actual Backend
  ADK generateContentAsync capture and the existing proposer/preflight suites.
- Static import check passed; native host syntax checked.
- Protected IPC dispatch tests could not run locally: sandbox denies listen
  on Unix sockets (EPERM), including pre-existing R135 cases. A new focused
  Fast CI step runs the existing assertion and new compiler dispatch tests.
- The dispatch fixture uses independently admitted Test-editor grants and
  scripted issuance; the separate model-boundary test uses Backend. This is
  not a combined native Rust/Gitea/Docker or generative recovery proof.

Next: inspect Fast CI, then run the targeted free TS2724 integration when the
patch is stable. Require captured Backend feedback in the native path before
closing the full N1/N2 end-to-end gate. No paid pilot is authorized here.
