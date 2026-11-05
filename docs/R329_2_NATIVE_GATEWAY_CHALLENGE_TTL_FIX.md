# R329.2 — native Gateway challenge TTL aligned with task-local MCP

## Evidence
The exact native diagnostic run
[#42098747990](https://github.com/DarkGh0st03/delegation/actions/runs/42098747990)
FAILED during Backend ADK update_file. Sanitized evidence:
- Gateway Prepare succeeded with HTTP 201.
- Owner authenticated staging was reached and reserved the mutation intent.
- No signed VP was submitted, no Gateway Execute was attempted, no Gitea
  provider write occurred.

The new canonical Gateway HTTP host inherited from R305 uses a 1,200,000 ms
(20-minute) prepared challenge TTL, allowing lengthy controlled Test Runner
operations. `PrivateMcpTaskRegistry.stageGatewayChallenge` rejected every
challenge that expires more than 120,000 ms (2 minutes) from the agent clock.
This caused the failure after a valid owner staging request, before private
Task-local MCP could issue a real VP. This mismatch affects production
authority-only ADK initialization when a common Gateway is used.

## Fix
Align the task-local holder *upper bound* to **1,200,000 ms**. This does not
change the Gateway-issued deadline, sign a VP without the active task-local
bearer, grant a different Child, or permit replay: the holder still checks
the exact `expires_at` during `invokeCrypto`, consumes the pending
challenge prior to the signer, and retains one-use tombstones.

A new Fast CI test exercises the exact production `req_<UUIDv4>` challenge
with the 20-minute TTL, verifies one successful private VP signing, denies
repeated signing and rejects expired and beyond-limit challenges.

The native EVM/Gitea/Docker gate MUST be re-run on the next checkpoint
before any native PASS or proof of project acceptance is claimed.
No paid Gemini, no `main` changes.
