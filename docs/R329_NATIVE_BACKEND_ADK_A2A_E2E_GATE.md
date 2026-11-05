# R329 — disposable native ADK/A2A Backend cutover

This is a SEPARATE native gate based on the independently successful
R305 disposable native scenario. It keeps the pinned Rust Engineer
root, EVM chain trust and revocation, OPA checks, real Gateway
HTTP, independent Gitea CAS, authenticated provider receipts and
the controlled Docker Runner.

R329 **replaces the Backend's manually scripted HTTP
Prepare/Sign/Stage/Execute operations** with one actual
`DeterministicA2AOrchestrator` HTTP SDK request to a real Google
ADK `LlmAgent/Runner` with a scripted, non-billable `BaseLlm`.
The native signed Child is transferred once after the real Coordinator
and Gateway task enrollment and per-role HMAC Unix binding, and
`LocalCryptoMcpBridge` uses the existing ONE Rust Native
CryptoRuntime IPC socket for VP creation. The trusted owner stages
the original Backend Gateway prepared record under its original
Task/HEAD pins. The live Gateway executes, and the owner then
requests an independent Gitea mutation completion from the original
Gateway observer; A2A success cannot replace that receipt.

Frontend and Test still follow the previously-proven **native**
R305 HTTP path: they use genuine Frontend/Test Child VPs, real Gitea
CAS and Docker, but **they are not ADK-generated in R329**. All
native negative checks for unauthorized siblings, foreign Child,
revoked root, pinned HEAD and replay remain included where applicable.

This is not autonomous paid Gemini functionality. The model is local
and deterministic. The engineer approval is a disposable CI fixture,
not a production/human signature. The pre-staged Account Suspension
functional reference is owner-provisioned; delegated functional
edits remain zero. There is no new private HTTP Adapter, shared
repo-mutation MCP worker, `main` mutation, PR merge or paid API key.

## Validation plan
1. Commit the native script and isolated R329 workflow. Fast CI parses
   and checks imports without launching the large native gate.
2. If free Fast CI is green, trigger ONE isolated R329 workflow by
   creating `.github/ci-checkpoints/r329-native-a2a-request.json`.
3. Require native actual run SUCCESS on its exact SHA and evaluate
   independently observed provider write, signed VP, OPA, Docker
   acceptance and revocation before marking the proof green.
4. Extend Frontend/Test to native ADK A2A only in a later checkpoint.

No conclusions about the native R329 run are justified before
the dedicated CI returns a successful result.
