# Phase 1b, run 1 (latency run)

- Valid for LATENCY: all 600 `path=direct` rows (20 reps × 30 conditions), all successful.
- Valid for RPC COUNTS: `path=proxy` rows of `config=root` only.
- INVALID: 45 `path=proxy` rows of `child` / `child_dirscope` and the Child `control_valid_batch`
  negatives. Cause (benchmark design error): the benchmark Child credentials were issued with
  3600 s validity while the run lasted 4052 s, so they expired during the proxy phase
  ("Timestamp is greater than expiration time"). Not a framework defect.
- RPC counts and negative cases were re-measured on a fresh chain with 7200 s Child validity in
  `../real-evm-counts/`.
