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
