# R350.8 — canonical Gateway Prepare and crash-durable Task flight under the R349 Engineer session

The same authenticated R349 Engineer review and independent operational root now drive an **actual** R350 Coordinator, Gateway admissions, native Child-issuer API, `prepareAuthorization`, owner-created `TrustedAuthorityOnlyEffectStager` and a durable `DurableAuthorityOnlyTaskFenceJournal` reservation in one offline regression.

The test rejects an out-of-grant `update_file` request *before* issuing a Gateway challenge; the valid request is prepared using the original runtime Task ID, signed grant subset, agent DID, pinned repository and branch. The owner-specific stager invokes a mocked mutation-intent reservation and then the genuine Gateway `stageTrustedTaskFlight`, proving that the real Gateway writes an immutable Task flight keyed to the same Engineer root, native Child ID, runtime Task ID and request fingerprint. Replay and independent completion are denied; zero completion receipts are written.

**Evidence boundary:** This is deliberately an offline native-class integration gate. The Child response is a scripted native-port fixture and the Gitea mutation preflight is a type-checked offline stub: no actual Rust signature, OPA decision or Gitea PUT occurs. The existing separate R331 native E2E still proves those operations in another session. This test does not claim a consolidated native R349→R331 provider success.

The next gate replaces the stub preflight with an actual native Gitea CAS provider and independent verified completion while preserving the original R349 Engineer session, then extends to Test Runner and persistent crash recovery. No paid model calls, main changes or merge.
