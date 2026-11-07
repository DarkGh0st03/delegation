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

For `prepareNativeEffects(gateway)`, reuse
`assembleTrustedAuthorityOnlyNativeEffects` with the original request store,
the pinned writer and independent reader, the authenticated Runner client,
and the protected receipt paths and key. Return its `binding` to the
Review Host and use its `authorization` with the same request store and
admissions in the Gateway execution path. R375 uses this same assembly.

**Not yet complete:** the executable owner process needs its
trusted operational `provision` implementation and a newly validated
same-SHA full native E2E after the CLI/bootstrap migration. R381.8
SUCCESS was a scripted proof on an earlier SHA, not a live Gemini pilot.
No paid Gemini workflow is authorized by R382.7.
