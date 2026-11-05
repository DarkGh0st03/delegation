# R327 — canonical live A2A SDK owner path, authenticated Unix and ADK

## Change
The owner-facing `startTrustedAuthorityOnlySdkA2AOwner` factory
constructs the existing `DeterministicA2AOrchestrator` using the
pinned `@a2a-js/sdk`, instead of accepting an arbitrary A2A transport
from outside the privileged owner assembly. It checks three distinct
loopback role endpoints and reads the live Agent Cards through
`assertTrustedApprovedA2AStartup` (expected role name, DID, skill,
delegated-authorization extension and exact HTTP+JSON endpoint)
**before opening the owner private staging listener**.

The rest of the execution remains the original R323–R326 chain:
active Coordinator approval / native Child issuance and Gateway
enrollment → R324 HMAC Unix Task binding → actual protected A2A SDK
send/poll → ADK Runner's controlled tools → owner-private HMAC Unix
staging → Gateway challenge/VP/execute → nonauthorizing A2A report →
a separately requested independent Gateway provider attestation.

## Offline integrated proof
A new free Node test starts three actual SDK A2A HTTP role servers.
The Backend is a genuine Google ADK LlmAgent/Runner, with a **scripted
offline model**; Frontend/Test expose their live Agent Cards but are
not exercised as independent effect producers. Two *real* HMAC
Unix control channels bind one exact Backend Task and stage one effect
in the trusted owner, followed by a prepared Gateway challenge and
response. The Gateway Prepare, VP signer, Gitea update, signed
Coordinator/Child and independent Gateway completion receipt are
explicit fixtures, NOT live native services.

Negative tests reject an incorrect role Card before bootstrap,
injection of an arbitrary A2A client, and an unbound A2A HTTP Task
before the model can run. The test explicitly proves that a completed
A2A artifact is not independent provider evidence; the separate
attestation method is invoked afterward. Replays are denied and the
model sees no Child DC/signing key or Gateway request nonce.

## Still required for the thesis
This is a genuine A2A/ADK transport and cross-process-style socket
test, **not an authenticated external HTTP peer**: loopback role cards
are not cryptographic identity, and a local hostile caller remains
possible. Authority is enforced separately by the native Rust
credential, verified VP, revocation status, OPA and private Gateway
effect ledger, all of which must be tested in disposable native E2E
without fixture substitutions. Operational deployment startup,
three Task sequencing with verified Gitea HEAD, failure/recovery D1
under the permission ceiling, independent native acceptance and PR
readiness remain outstanding. No Gemini API or main merge allowed by
this change.
