# R333 — role-isolated ADK → owner Unix staging channels

## Motivation
R328 introduced separate role-specific authenticated owner→agent Task
binding sockets, but the actual agent→owner staging messages still shared
one HMAC key. An agent with access to that key could submit a staging
request for another role's runtime Task ID. R332 added a trusted-role
check to each staging server and to the original owner-side registry;
R333 wires **three physically distinct sockets and secrets** into the
canonical authority-only owner bootstrap instead of relying on a
single shared staging route.

## Implementation
`TrustedAuthorityOnlyRemoteEffectBootstrap` accepts either historical
`stageSocketPath`/`stageSecretFile` or exactly three
`stageChannels`: Backend, Frontend, Test. The multirole stage option
requires multirole bind channels, and the bootstrap rejects duplicated
absolute paths, shared keys (across *all six HMAC secrets*), missing
roles, and attempts to configure both legacy and multirole stage modes.

Each stage listener fixes its `expectedRole` in its privileged owner
configuration; a remote A2A payload never selects this role. All
listeners use the **same** in-process
`TrustedOwnerEffectStagingRegistry`, the same immutable Engineer
approval and the same native Gateway request store. A wrong-role
authenticated request receives a generic rejection without consuming
the legitimate Task's one-use reserved effect. An ambiguous actual
stage remains one-shot and cannot be retried. Closing any of the three
listeners retires the shared registry, failing closed.

## Validation
The new free offline test creates three independent agent bind servers,
three owner stage listeners, six HMAC secret files and a trusted
Coordinator/Child/Gateway fixture. It verifies:
- a Backend Task is staged exactly once on its Backend socket;
- correctly authenticated Frontend and Test stage messages cannot
  submit the Backend request, even knowing both IDs;
- the wrong HMAC key cannot stage on the Backend socket;
- an invalid/reused stage request is denied;
- a reused HMAC stage secret is denied **before any listener opens**;
- mixed legacy/per-role modes or incomplete role sets are rejected.

The Coordinator, Rust Child, Gateway and provider in this test are
fixtures; **it does not prove a fresh native EVM/OPA/Gitea/Docker E2E**.
R331 remains the last independently successful native three-ADK run.
To validate deployment, migrate the disposable native scenario and
the production bootstrap to the new three-role staging configuration,
then perform one native validation. D1 recovery remains separate work.

No paid Gemini, merge or `main` mutation.
