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
retention policy before enabling this on disposable CI. The current public pilot
workflow does not upload them. No historical failed source can be recovered by
this feature. Tests use injected Docker commands, not a real Docker replay.
