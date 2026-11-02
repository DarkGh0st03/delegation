# Private failure evidence

Set `TEST_RUNNER_FAILURE_EVIDENCE_DIR` on the Runner controller to retain failed
runs as private bundles. Default: disabled. Successful runs create no bundle.
Each bundle contains the exact downloaded source archive, full phase log, and a
manifest binding both SHA-256 digests to the requested tested commit and phase
statuses. The hashes check consistency; they do not independently attest Gitea.
The archive is never extracted on the host. Bundle directories use mode 0700 and
files 0600. Failed writes remove the incomplete bundle and fail the run.

These files contain repository source and untrusted test output. They are not
included in Runner responses, agent context, or public GitHub artifacts. Configure
an operator-controlled persistent volume or restricted collection mechanism and
retention policy before enabling this on disposable CI. The public pilot uploads only an AES-256-GCM encrypted envelope when the
repository secret `RUNNER_EVIDENCE_KEY_HEX` is configured (32 random bytes, 64 hex
characters). Keep a separate secure copy of this key to decrypt downloaded files.
The key is passed only to configuration and sealing steps, not to agent processes.
Without the secret, retention remains disabled. Encrypted artifacts expire after
7 days. The envelope can be decrypted with `unseal` exported by
`poc/scripts/seal-runner-evidence.mjs`; its JSON contains base64 file contents.
Do not publish the key or decrypted output. This code does not configure the
repository secret or initiate a paid pilot. No historical failed source can be recovered by
this feature. Tests use injected Docker commands, not a real Docker replay.

Fast CI includes a separate free Docker round-trip test. It injects a Gitea-shaped
archive response, runs the real isolated Docker executor with a missing-lockfile
fixture, expects dependency_install FAIL, seals the retained bundle, deletes the
plaintext directory and verifies recovered archive bytes, log hash and tested SHA.
The encryption key is ephemeral and no artifact is uploaded by this test. This
checks real Docker evidence retention, not live Gitea, Gemini or application D1.
Locally opt in with `RUNNER_EVIDENCE_REAL_DOCKER=1` after pulling the fixed image.


When private retention is enabled, project test phases additionally use Vitest
JSON reporting at fixed container-local paths while preserving default terminal
reporting. On a failed phase, the Runner captures up to 16 failed assertion IDs
and their bounded failure messages into the private manifest. Messages may include
expected/actual values and stack text; these are test-controlled, untrusted,
private data. Missing, oversized or malformed reports yield `unavailable` rather
than invented assertions. They do not change Runner PASS/FAIL or causal attribution.
The existing encrypted manifest carries these fields; public Runner responses and
the public Runner response does not. The scoped host disclosure path described
below controls which bounded headers may enter D1 model reasoning. This is not a complete
VerifiedFailureContext or an autonomous diagnosis implementation.


The free Docker evidence job also runs the real Vitest 3.2.7 JSON reporter (the
version in immutable IAM baseline 405748b1), captures a synthetic 200-versus-409
assertion using the production phase command plus private reporter flags, seals
the private manifest and checks the recovered assertion. This isolates reporter
compatibility; it injects fixture repository metadata and is not a full IAM
application or live Gitea validation. npm fetches the pinned version in disposable
Docker; no model key is used. npm transitive resolution for this compatibility
fixture is not the IAM lockfile install.


The native approved DAG has its own Runner constructor. It explicitly receives
`TEST_RUNNER_FAILURE_EVIDENCE_DIR`; configuring only the outer positive-smoke
executor does not enable retention on native D0/D1. Functional CI checks both
Backend and Frontend native FAIL bundles for captured Vitest assertion diagnostics
before publishing its counts-only recovery receipt. Assertions remain private.


The native host now exposes a private loader to the D1 proposer. It matches the
exact Runner log reference, tested revision, repository and branch, verifies the
retained log hash, and restricts assertion files to Runner-reported failures with
original read grants for the selected role in both the signed plan and issued
root. It discloses only a bounded test ID and the first AssertionError line,
never stack text or raw logs. The in-process context is branded and immutable;
serialized or model-supplied copies are rejected before inference. The initial
route chooser may receive up to two such bounded headers under the union of the
verified candidate roles; the selected proposer reloads under only its roles.
A failed assertion remains untrusted evidence and does not establish culpability.

This uses the original authorized Runner effect and host-private retained files;
it does not perform a new Gateway source read or issue a read credential. With no
private retention or no exact original read grant, no assertion text is disclosed.
Existing bundles without the Runner reference cannot supply model context.
