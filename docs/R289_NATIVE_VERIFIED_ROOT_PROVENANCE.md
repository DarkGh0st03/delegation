# R289 — native-verified root ancestry for staged authority-only Gateway

Date: 2026-11-05. Parent: R288 `3665590c7063944d9610f33db61441c09c17d253`.

## Security gap fixed

Previously the native Rust verifier authenticated the complete delegation
hierarchy and EVM/status material but the Gateway received only the leaf
credential/issuer identity. It could not distinguish a VP delegated from the
Engineer operational root of *this session* versus a VP independently issued
under some other trusted root.

The verifier now includes `root_credential_id` in its verified result:
the oldest verified chain entry's `credentialId`; for a direct-root VP,
the presented credential ID. This value is derived **after** each Rust chain
entry's metadata, witnesses, status and trust-anchor validation. It is not
an A2A/model/HTTP-supplied field. The Node-API wrapper forwards and validates
the field without inventing a value for older results.

The opt-in authority-only Gateway checks this root provenance equals the
currently active, independently issued Engineer operational root credential
and requires a nonzero chain depth. Missing, foreign-root or root-only VP
results fail closed before provider effects. It still verifies the bound
Task/agent, current canonical permission and trusted Coordinator session.

## Evidence and limitations

- Rust result serialization unit test for optional explicit root provenance.
- Node-API wrapper tests for forwarding, malformed provenance rejection and
  historical fixture behavior.
- Authority-only Gateway test rejects missing root, mismatched root and
  nondelegated depth; a correct root reaches the **intentional terminal deny**.
- No successful provider effect is possible: R288 `authority_only_execution_not_enabled`
  remains mandatory; the legacy path is unchanged.
- This **does not** prove live Child DC issuance for Task/epoch, authenticated
  Gateway admission, completion attestations, or hierarchical permission
  containment. In particular, a child under the operational root is not yet
  automatically bound to a specific Coordinator Task.

Next: trusted owner-private Child DC issuance, independent native VP evidence
and Task/epoch enrollment with one-use durable fencing, then OPA/Gitea/Docker
E2E and negative replay/foreign-root tests. No Gemini paid pilot authorized.
