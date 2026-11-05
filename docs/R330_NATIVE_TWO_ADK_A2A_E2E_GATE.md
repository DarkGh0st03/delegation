# R330 — two native ADK/A2A roles, one signed Engineer root

This isolated native proof derives from R329.2 native SUCCESS
[#42100622540](https://github.com/DarkGh0st03/delegation/actions/runs/42100622540)
without modifying that successful script. Backend and Frontend now use
separate genuine Google ADK runners with scripted free BaseLlm models,
the actual A2A SDK transport, distinct role-pinned HMAC Unix Task bind
channels and one common owner-only stage listener. The original
Software Engineer root grants exact permissions: Frontend's trusted
stager pins its file update to the independently observed Backend
commit, NOT the original signed base revision. Each Child VP is
produced by local private MCP invoking real native Rust, checked by
Gateway/EVM/OPA; independent provider evidence from real Gitea CAS
is required before starting the next dependent Task.

Test remains the previously validated genuine native signed VP /
Gateway / Docker Runner flow, **not yet Google ADK**. This preserves
scope and lets us identify whether the Frontend ADK cutover breaks
native security or provider handling. The source fixture remains
owner-staged (`delegated_functional_edits:0`); green results do not
prove autonomously model-generated functional edits. Cryptographic
A2A HTTP peer identity, per-role owner stage signing, D1 recovery and
full ADK Test remain future gates.

The new R330 native workflow is isolated and starts only on manual
dispatch or a change to `.github/ci-checkpoints/r330-native-a2a-request.json`.
Fast CI only syntax-checks the new script. No paid AI or `main` updates.
