# Delegation Adapter service

Reserved for Phase 2 of the thesis PoC.

This service will expose a narrow internal HTTP interface over the existing Rust delegation framework for child Delegation Credential issuance, selective signed Verifiable Presentation creation, and DelegationVerifier execution.

The service will enforce caller-to-identity binding so a caller cannot select an arbitrary holder or issuer identity in a request body.

No service implementation is added in Phase 0B.
