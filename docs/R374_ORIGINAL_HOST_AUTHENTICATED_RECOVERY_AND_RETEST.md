# R374.0 — Original branch-first authentic FAIL → scripted recovery → authentic FAIL

R373.1 proved the **original** Software Engineer Review Host could create
and independently verify the feature branch on protected unresolved Gitea
`main`, delegate Backend and Frontend native Child credentials, execute
two authenticated read→CAS updates and a real Docker Test FAIL, publish
MAC-authenticated failure evidence, then correctly block.

R374 extends that **same canonical launcher**. It does not add a second
Coordinator or a second Engineering approval and does not introduce a
new alternate provider admission path.

The bounded adaptive ADK model now acts **after** the authenticated first
Runner FAIL, which must include `researcher_acceptance`,
`source_evidence_sha256` and original independently verified failure
history. Only then does it choose a *new* Frontend Task (not a pre-registered
D1 graph), depending on the last successfully completed Frontend Task.
This Task inherits only the exact signed Frontend `read_file` +
`update_file` permissions, gets a new native Rust Child credential,
re-reads the actual Gitea source at the new HEAD, and CAS-commits a
new revision. The original failed Test remains registered but incomplete.

The free scripted ADK model next selects a second Test Task depending on
the completed Frontend recovery Task. The original Gateway executes
the real Docker Runner again at the new HEAD. Because the scripted
source revision only appends a benign comment, **the application remains
unresolved; the second acceptance is expected to FAIL too**.
The original owner must verify a *second*, distinct private signed failure
receipt before its sixth ADK decision. Only then does the model choose
`blocked`. The root is retired; no PR permission is signed and no
pull request can be created.

Expected metrics: 6 registered Tasks, 4 independently completed
Gateway Tasks (Branch, Backend, Frontend D0, Frontend D1), 5 true
native Rust Children, 3 Gitea CAS commits, 2 real Docker Test FAILs,
2 independent failure receipts and 0 PASS receipts. Both failed Test
Tasks must never enter the success ledger.

**Evidence limitation:** All models are deterministic scripted fixtures,
including the corrective comment. This tests guarded adaptive recovery,
not genuine application repair or Gemini autonomy. A future checkpoint
must require a real authenticated Docker PASS before proceeding to
Draft PR and then demonstrate actual model-generated source improvements.
No billed Gemini test is authorized in this checkpoint. GitHub PR #38
must remain Draft/unmerged; production `main` unchanged.

Do not claim success until native R374 and Fast CI both pass on the
same SHA.

## R374.1 CI trigger correction

The first R374.0 commit incorrectly configured the new native workflow to watch a checkpoint JSON filename that did not exist. Only Fast CI started; **native validation had not run**. R374.1 corrects that trigger path and refreshes the request checkpoint. No runtime or signing/Runner code is changed. Native SUCCESS remains unproven until the new CI completes.

## R374.2 — fresh Child timestamps at each original epoch

The native R374.1 attempt [#42348061028](https://github.com/DarkGh0st03/delegation/actions/runs/42348061028) produced the **first authenticated real Docker FAIL** but subsequently refused a new Frontend repair Child with the native issuer guard `Child cannot outlive current Engineer operational root`. The original issuer also correctly requires `abs(Child.valid_from - now) <= 60 seconds`; the fixture incorrectly reused the root-approval timestamp for Child issuances after a Docker run lasting more than a minute. R374.2 refreshes **only per-Child dynamic valid_from at the moment the original Review Host asks for a new Child**, preserving the signed Engineer grant, root expiry, original 600–1200 second Child durations, Rust issuance checks, OPA, Runner evidence and fail-closed behavior. The new native checkpoint must verify whether recovery and retest can progress, and is not yet SUCCESS.
