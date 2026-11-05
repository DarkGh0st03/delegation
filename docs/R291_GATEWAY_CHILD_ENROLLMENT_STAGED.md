# R291 — separately journalled Gateway Child enrollment (terminal deny)

Parent `38e34c5d2a43d88341c5c47d3810e4ff85054b76`, same protected migration branch.

Gateway now optionally accepts a distinct, private
`DurableAuthorityOnlyChildJournal`. An owner-only
`enrollTrustedIssuedChild(taskId,runtimeTaskId,issuer)` call is allowed only
after Coordinator Task admission. It receives the real issuer class instance,
not a JSON Child claim; the issuer independently verifies that it shares the
identical Coordinator, operational Engineer root, signed authority digest,
agent DID and exact Task permissions.

Enrollment persists a second crash-durable marker before returning a Child
credential ID for that runtime Task. Separate issuer/Gateway journals are
mandatory. A verified Rust VP must match the **specific enrolled Child ID**
in addition to R289 root provenance and the canonical requested permission.
Foreign Task Child IDs, foreign roots and mismatched presenter DIDs are denied.

**Not enabled:** Provider I/O remains denied by R288 even when the native
verifier and independent OPA permit an enrolled Child. This phase exercises
offline child-port fixtures, not yet a real Rust-issued VP and EVM status
verification tied to a dynamic Task. No HTTP public enrollment handler,
Gemini call, new issuer/keys or signed-DAG fallback has been added.

Next gates: actual Rust IPC-issued Child → signed Task VP → independent Rust
EVM/accumulator/status verification, durable completion/task flight fencing,
OPA, Gitea/Docker real scripted E2E, and only then provider enablement.
