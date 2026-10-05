# Phase 7 — A2A SDK verification

Verified on 2026-10-05 before implementing the deterministic A2A runtime.

## Official JavaScript SDK

- Package: `@a2a-js/sdk`
- Version pinned by the PoC: `1.3.0`
- Protocol target: A2A Protocol Specification v1.0
- Server surface used by the PoC:
  - `DefaultRequestHandler`
  - `InMemoryTaskStore`
  - `AgentExecutor`
  - `agentCardHandler`
  - `restHandler`
- Client surface used by the PoC:
  - `ClientFactory`
  - `ClientFactoryOptions`
  - `sendMessage`
  - `ServiceParameters`
  - `withA2AExtensions`

The PoC intentionally uses the HTTP+JSON binding. The three specialized Agent
Cards expose `supportedInterfaces[]` with `protocolBinding: "HTTP+JSON"` and
`protocolVersion: "1.0"`.

## Delegated-authorization extension

Frozen URI:

`urn:thesis:a2a:delegated-authorization:v1`

The Agent Card declares the extension as required. The client activates it
through the A2A `A2A-Extensions` service parameter via the official SDK helper.
The `Message.extensions` field declares the same URI and
`Message.metadata.delegation_evidence` carries the serialized child
Delegation Credential plus minimal identifiers.

The remote Agent copies Delegation Evidence into an internal Task Context.
Artifacts are result-only and must not contain the authority object.

## Authority boundary

A2A does not replace delegated authorization. Phase 7 transports task context
and Delegation Evidence only. Repository authority remains enforced through the
existing Delegation Credential -> Cloud Access Gateway -> DelegationVerifier ->
OPA -> provider path.
