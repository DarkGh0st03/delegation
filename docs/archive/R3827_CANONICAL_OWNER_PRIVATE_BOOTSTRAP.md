# R382.7 — canonical owner-only bootstrap (no paid execution)

This is a **live-runtime preparation** contract, not a second planner,
Engineer grant, generic MCP server or model tool. It connects the original
`TrustedAuthorityOnlyReviewHost` to the ORIGINAL Rust Engineer Core,
authenticated Gateway Planning IPC, signed Backend checkpoint store and
persistent activation/session/Task/recovery journals.

## Owner-protected manifest

The owner writes a single JSON manifest, using a real private directory
(`0700`) and a regular file (`0600`, no symlink, owner UID and a single
hard link). The schema is exact: extra keys are rejected. The file records:

- `schema`: `r3827-original-authority-only-v1`
- `source_sha`: exact 40-character Git checkout SHA pinned independently
  by the protected operator before any model/API operation
- `snapshot`, `requirement`, `workBranch`, `preliminaryRoot`,
  `planner.planId`: the same **immutable** Planning source pins that
  must also appear in the separate 0600 Gemini owner input
- `trustedAgentRegistry`: **backend, frontend, test, orchestrator**,
  each with `did`, `card_ref`, `capabilities`. Every DID must equal
  the provisioned `ADAPTER_ID_<ROLE>`; only the original role's
  approved operation catalog is accepted
- `gateway.gatewayBaseUrl` and `gateway.adapterBaseUrl`: explicit
  loopback `http://127.0.0.1:<port>` endpoints
- `checkpoint.backendKeyId`, `checkpoint.backendPublicKeyFile`:
  original Backend Ed25519 checkpoint signer
- `approval.engineerDid`, `keyId`, `publicKeyFile`,
  `privateKeyFile`, `passwordSaltHexFile`,
  `passwordScryptHexFile`: the independently bound Engineer
  Ed25519 review identity and authentication material; private files
  remain on disk, not in the Planning/model input
- `directories`: *six distinct*, existing, absolute, real, owner-only
  directories named `checkpoint`, `activation`, `tasks`,
  `recovery`, `operationalSessions`, `receipts`
- `native.gatewaySocketPath`, `gatewaySecretFile`,
  `engineerRustTokenFile`, `gatewayAdapterTokenFile`: paths to
  the original private Gateway IPC and Rust Core bearer material.
  Do not put bearer values in JSON.

Every 0600 file is opened with `O_NOFOLLOW`, checked for owner,
mode, link count and size; directories are verified against
`realpath`. The Engineer private key is compared to the pinned
Engineer **public** key before the Gateway is contacted.

## Native mode and authenticated Gateway

These four environment pins are required at owner startup:

```sh
DELEGATION_GATEWAY_ARCHITECTURE=authority-only
APPROVED_RUNNER_NATIVE_MCP=1
ENGINEER_CORE_NATIVE_MODE=1
ADAPTER_ENGINEER_NATIVE_SOCKET=/owner-only/real-rust.sock
```

The owner session must **not** run inside GitHub Actions. The authentic
Gateway `TrustedPlanIpcClient.connect()` first reattests its durable
Planning retirement, leases, and operational-session persistence. Only
then can `createTrustedEngineerCredentialPort()` instantiate the
**direct original Rust Core** Engineer issue/revoke port. There is no
fallback to a shared MCP, legacy HTTP Adapter or new Root issuer.

The configuration loader is consumed once using a private WeakSet
token. An assembly failure cannot be retried with the same token.

## Authorized caller

```js
import {startProtectedCanonicalGeminiOwnerFromPrivateConfig}
 from "./poc/apps/orchestrator/src/run-trusted-gemini-owner.mjs";

// This invocation MAY call a paid Gemini Planning model.
// It is intentionally NOT invoked by Fast CI or by this document.
const owner = await startProtectedCanonicalGeminiOwnerFromPrivateConfig({
 configPath: "/owner-only/authority.json",
 expectedSourceSha: "<EXACT_LOCAL_GIT_SHA>",
 inputFile: "/owner-only/gemini-planning.json",
 chargeAuthorization: "I AUTHORIZE GEMINI API CHARGES",
 provision: trustedPrivateOperationalProvision
});
```

`trustedPrivateOperationalProvision` must be implemented **in the
owner process**, never loaded as JavaScript from JSON, from a model or
an A2A Task. It provides the actual original, durably reserved
operational Root, original native Child signer, Gateway journals,
Branch-first SDK/ADK/A2A adaptive workflow and independent Runner/Gitea
completion observer; it may not extend the reviewed permission ceiling.

The callback returns `{root, dependencies, workflow, prepareNativeEffects}`.
`prepareNativeEffects(gateway)` runs after the original Review Host
activates the signed Root and admits the Gateway. Construct the Gitea and
Runner dependencies for that Gateway and return the input required by
`bindNativeGatewayEffects`. The Host verifies this binding before Branch
creation or adaptive execution. Binding failure retires the original Host.


`reviewReadiness()` is read-only and checks the original Engineer
Ed25519 signature; `runApprovedCanonical()` is the sole one-shot
approved operational entry. Neither runs automatically. If shutdown or
Rust retirement is ambiguous, do not repeat the Root/Task effects.

## Built-in operational provision

Pass an in-process `operational` object in place of `provision`. Supply
`journalDirectory` with existing private subdirectories `gateway-tasks`,
`issuer-children`, `gateway-children`, `effect-fences`, and `sequences`,
plus an owner-private `orchestratorTokenFile`. The bootstrap reuses the
original operational session store and builds the five journals and native
MCP Child port. It calls the trusted `reserveRoot` capability once, after
signature verification. The trusted process still supplies the
`completionObserver`, `workflow`, and `prepareNativeEffects` capabilities.

To use the built-in provider assembly, replace `prepareNativeEffects`
with `nativeEffects`. Supply the original request `store`, the pinned
`giteaClient` and `independentGiteaClient`, the authenticated
`runnerClient`, `runnerPassObserver`, optional `readObserver`, and a
32-byte `evidenceKey`. Provide separate private `directories` for
`mutationIntent`, `giteaReceipts`, `runnerIntent`,
`runnerFailureReceipts`, and `runnerPassReceipts`.
The bootstrap derives repository and branch from the Review Host pins.
After the Review Host accepts the binding, the trusted
`installAuthorization` callback receives the authorization dependencies
with the same request store and Gateway admissions. R375 uses the same
provider assembly.

For built-in Branch and Draft PR transport, also pass `rootGateway`
with the trusted `audit`, `verifier`, `policy`, and `executor` ports.
Omit `prepare` and `execute` from the Branch and optional Draft PR
workflow entries. The bootstrap binds both effects to the reserved Root,
the original repository and the installed Gateway authorization. Each
effect can sign its prepared challenge once. Keep SDK A2A configuration
and the Root reservation capability in the trusted owner process.

To use built-in operational Root reservation, pass `rootReservation`
instead of `reserveRoot`. Provide `directory`, a preallocated `index`
as a decimal string, and `validitySeconds` (1–7200). Use the same
private reservation directory for all allocations on that Status List,
with indices provisioned by the operator. The list URI comes from the
preliminary Root. After signed review, the bootstrap reserves the index
durably and generates a fresh credential ID. The original Engineer host
still issues the Root through Rust.

For local A2A, provide `localWorkers` with a private `directory` and
`workers` entries for Backend, Frontend and Test. Each entry supplies a
distinct loopback port and trusted ADK configuration. Omit `workflow.sdk`
in this mode. After Gateway binding, the owner starts the role-pinned
workers and hands their private channel pins to the existing SDK launcher.
The handoff closes the local listeners on completion or failure.

## Canonical executable

Run `poc/apps/orchestrator/src/run-trusted-gemini-owner.mjs` with Node's
TypeScript stripping enabled in a local terminal. In addition to the native
mode pins above, set `DELEGATION_ENGINEER_SERVICE_CONFIG`,
`DELEGATION_GEMINI_EXPECTED_SOURCE_SHA`,
`DELEGATION_GEMINI_OWNER_INPUT_FILE`, and
`DELEGATION_GEMINI_CHARGE_CONFIRMATION`. Set
`DELEGATION_CANONICAL_OPERATIONAL_MODULE` to a tracked `poc/…/*.mjs`
deployment module in the pinned checkout. Its `prepareOperational()`
export supplies the trusted `operational` object described above.
The executable checks the source pin and billing confirmation before
loading that module. After Planning, sign the Engineer review through
the loopback Review Host and enter `execute` in the owner terminal.
Entering `quit`, closing input, or interrupting retires the session.

Use the repository's composition module at
`poc/apps/orchestrator/src/canonical-owner-deployment.mjs`. Set
`DELEGATION_CANONICAL_DEPLOYMENT_CONFIG` to a private JSON file with
exactly these fields:

- `directory`, an existing private directory containing `journals`
  (with the five journal subdirectories above), `status-reservations`,
  `mutationIntent`, `giteaReceipts`, `runnerIntent`,
  `runnerFailureReceipts` and `runnerPassReceipts`.
- `giteaUrl`, `runnerUrl`, `opaUrl` and private file paths
  `giteaWriterFile`, `giteaReaderFile`, `runnerTokenFile`,
  `orchestratorTokenFile`, and `evidenceKeyFile`. The evidence key is
  32 bytes encoded as 64 lowercase hex digits. Writer and reader
  credentials must differ.
- `workerTokens` and `workerPorts` keyed by `backend`, `frontend` and
  `test`. Tokens are private file paths and ports are distinct integers.
- `rootIndex` and `childIndices` as distinct preallocated decimal strings
  for the same Status List, excluding the preliminary Root index.
- `draftTitle` and `draftBody` for the signed Draft PR operation.

The module composes the provider and agent dependencies in-process. The
deployment must already provide Rust, authenticated Gateway planning IPC,
OPA, Gitea and Runner. The full deployment still requires a free native
validation on the same source SHA before a paid pilot.
