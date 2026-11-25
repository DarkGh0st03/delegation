# Summary — default

- reps: 30 (warm-up 3 discarded), seed 104372539625765, credential with 128 permissions, parallel_verification=False, elapsed 325 s

## child

| k | single verify ms (median [p5–p95]) | multi verify ms (median [p5–p95]) | ratio single/multi (95% CI) | multi ms/permission | single VPs bytes | multi VP bytes | trust queries single / multi |
|---:|---|---|---|---:|---:|---:|---|
| 1 | 8.21 [8.14–11.01] | 8.17 [8.14–10.20] | 1.00 (0.99–1.02) | 8.17 | 2362 | 2362 | 16 / 16 |
| 2 | 16.50 [16.26–20.02] | 11.86 [11.72–18.72] | 1.39 (1.37–1.40) | 5.93 | 4724 | 2788 | 32 / 16 |
| 5 | 41.30 [40.83–43.72] | 22.67 [22.51–26.00] | 1.82 (1.80–1.84) | 4.53 | 11810 | 4068 | 80 / 16 |
| 10 | 82.48 [81.74–100.81] | 40.94 [40.47–60.90] | 2.01 (1.97–2.04) | 4.09 | 23620 | 6202 | 160 / 16 |
| 15 | 124.73 [122.43–168.29] | 59.63 [58.63–73.74] | 2.09 (2.05–2.13) | 3.98 | 35430 | 8335 | 240 / 16 |
| 32 | 266.65 [261.52–307.99] | 120.93 [119.75–128.56] | 2.21 (2.18–2.24) | 3.78 | 75584 | 15588 | 512 / 16 |
| 64 | 534.64 [523.44–581.00] | 239.38 [235.73–285.89] | 2.23 (2.20–2.28) | 3.74 | 151168 | 29242 | 1024 / 16 |
| 128 | 1073.93 [1046.50–1193.54] | 487.15 [469.98–564.26] | 2.20 (2.15–2.26) | 3.81 | 302336 | 56548 | 2048 / 16 |

| k | single presentation ms | multi presentation ms | single total ms | multi total ms | ratio total (95% CI) |
|---:|---:|---:|---:|---:|---|
| 1 | 0.55 | 0.53 | 8.76 | 8.71 | 1.01 (0.99–1.02) |
| 2 | 1.09 | 0.55 | 17.60 | 12.43 | 1.42 (1.40–1.43) |
| 5 | 2.72 | 0.56 | 44.05 | 23.23 | 1.90 (1.87–1.91) |
| 10 | 5.46 | 0.57 | 87.94 | 41.53 | 2.12 (2.07–2.14) |
| 15 | 8.23 | 0.59 | 132.97 | 60.25 | 2.21 (2.17–2.25) |
| 32 | 17.55 | 0.64 | 284.19 | 121.59 | 2.34 (2.31–2.37) |
| 64 | 35.34 | 0.73 | 570.62 | 240.11 | 2.38 (2.34–2.42) |
| 128 | 70.95 | 0.88 | 1145.34 | 488.08 | 2.35 (2.29–2.41) |

- OLS on medians, single: verify_ms ≈ -1.00 + 8.391·k (R² = 1.0000)
- OLS on medians, multi: verify_ms ≈ 3.00 + 3.761·k (R² = 0.9998)

## child_dirscope

| k | single verify ms (median [p5–p95]) | multi verify ms (median [p5–p95]) | ratio single/multi (95% CI) | multi ms/permission | single VPs bytes | multi VP bytes | trust queries single / multi |
|---:|---|---|---|---:|---:|---:|---|
| 1 | 8.18 [7.98–8.87] | 8.20 [8.14–9.22] | 1.00 (0.98–1.00) | 8.20 | 2351 | 2351 | 16 / 16 |
| 2 | 16.45 [16.26–22.24] | 11.74 [11.63–12.12] | 1.40 (1.39–1.41) | 5.87 | 4702 | 2767 | 32 / 16 |
| 5 | 40.99 [40.35–52.51] | 22.56 [22.38–25.09] | 1.82 (1.80–1.83) | 4.51 | 11755 | 4015 | 80 / 16 |
| 10 | 82.06 [81.38–97.98] | 40.37 [40.03–57.67] | 2.03 (2.02–2.08) | 4.04 | 23510 | 6095 | 160 / 16 |
| 15 | 123.65 [121.95–148.54] | 58.36 [57.86–73.31] | 2.12 (2.10–2.16) | 3.89 | 35265 | 8175 | 240 / 16 |
| 32 | 263.77 [260.56–326.03] | 120.31 [118.59–137.43] | 2.19 (2.16–2.24) | 3.76 | 75232 | 15247 | 512 / 16 |
| 64 | 529.67 [521.26–590.93] | 235.82 [233.28–280.14] | 2.25 (2.22–2.28) | 3.68 | 150464 | 28559 | 1024 / 16 |
| 128 | 1075.12 [1044.29–1118.96] | 469.58 [464.46–510.61] | 2.29 (2.25–2.31) | 3.67 | 300928 | 55183 | 2048 / 16 |

| k | single presentation ms | multi presentation ms | single total ms | multi total ms | ratio total (95% CI) |
|---:|---:|---:|---:|---:|---|
| 1 | 0.55 | 0.55 | 8.74 | 8.76 | 1.00 (0.98–1.00) |
| 2 | 1.09 | 0.55 | 17.56 | 12.30 | 1.43 (1.42–1.44) |
| 5 | 2.73 | 0.56 | 43.78 | 23.12 | 1.89 (1.87–1.91) |
| 10 | 5.43 | 0.57 | 87.59 | 40.96 | 2.14 (2.12–2.19) |
| 15 | 8.22 | 0.61 | 131.82 | 58.96 | 2.24 (2.21–2.28) |
| 32 | 17.38 | 0.63 | 280.94 | 120.93 | 2.32 (2.29–2.38) |
| 64 | 34.95 | 0.72 | 564.64 | 236.53 | 2.39 (2.36–2.43) |
| 128 | 71.13 | 0.86 | 1146.15 | 470.44 | 2.44 (2.39–2.46) |

- OLS on medians, single: verify_ms ≈ -2.05 + 8.390·k (R² = 0.9999)
- OLS on medians, multi: verify_ms ≈ 4.18 + 3.632·k (R² = 1.0000)

## root

| k | single verify ms (median [p5–p95]) | multi verify ms (median [p5–p95]) | ratio single/multi (95% CI) | multi ms/permission | single VPs bytes | multi VP bytes | trust queries single / multi |
|---:|---|---|---|---:|---:|---:|---|
| 1 | 4.20 [4.17–4.29] | 4.20 [4.17–4.25] | 1.00 (1.00–1.00) | 4.20 | 1424 | 1424 | 10 / 10 |
| 2 | 8.37 [8.32–9.27] | 5.99 [5.94–6.15] | 1.40 (1.39–1.40) | 3.00 | 2848 | 1638 | 20 / 10 |
| 5 | 20.94 [20.87–21.31] | 11.39 [11.34–12.07] | 1.84 (1.83–1.85) | 2.28 | 7120 | 2278 | 50 / 10 |
| 10 | 41.97 [41.77–43.19] | 20.42 [20.36–20.70] | 2.06 (2.05–2.06) | 2.04 | 14240 | 3344 | 100 / 10 |
| 15 | 62.81 [62.64–65.41] | 29.42 [29.30–30.04] | 2.14 (2.13–2.14) | 1.96 | 21360 | 4411 | 150 / 10 |
| 32 | 134.52 [133.73–142.69] | 60.35 [60.03–67.11] | 2.23 (2.22–2.24) | 1.89 | 45568 | 8038 | 320 / 10 |
| 64 | 269.36 [267.53–291.28] | 119.00 [118.43–132.62] | 2.26 (2.25–2.28) | 1.86 | 91136 | 14864 | 640 / 10 |
| 128 | 538.01 [535.58–588.20] | 237.38 [236.64–242.38] | 2.27 (2.26–2.28) | 1.85 | 182272 | 28518 | 1280 / 10 |

| k | single presentation ms | multi presentation ms | single total ms | multi total ms | ratio total (95% CI) |
|---:|---:|---:|---:|---:|---|
| 1 | 0.52 | 0.52 | 4.72 | 4.72 | 1.00 (0.99–1.00) |
| 2 | 1.04 | 0.53 | 9.41 | 6.51 | 1.44 (1.43–1.45) |
| 5 | 2.57 | 0.52 | 23.53 | 11.92 | 1.97 (1.97–1.98) |
| 10 | 5.17 | 0.53 | 47.13 | 20.96 | 2.25 (2.24–2.26) |
| 15 | 7.71 | 0.55 | 70.53 | 29.96 | 2.35 (2.35–2.36) |
| 32 | 16.48 | 0.57 | 151.03 | 60.93 | 2.48 (2.47–2.49) |
| 64 | 33.01 | 0.62 | 302.46 | 119.62 | 2.53 (2.52–2.54) |
| 128 | 65.86 | 0.69 | 603.54 | 238.09 | 2.53 (2.53–2.55) |

- OLS on medians, single: verify_ms ≈ -0.05 + 4.205·k (R² = 1.0000)
- OLS on medians, multi: verify_ms ≈ 2.05 + 1.836·k (R² = 1.0000)

## Negative cases

| config | case | k | n | rejected | as expected | median ms to decision | reason (first) |
|---|---|---:|---:|---:|---|---:|---|
| child | batch_over_128 | 128 | 10 | 10 | yes | 0.00 | context: Authorization context exceeds 128 required permissions |
| child | control_valid_batch | 1 | 10 | 0 | yes | 8.22 |  |
| child | control_valid_batch | 10 | 10 | 0 | yes | 40.95 |  |
| child | control_valid_batch | 128 | 10 | 0 | yes | 485.17 |  |
| child | forged_permission_reused_witness | 1 | 10 | 10 | yes | 5.78 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| child | forged_permission_reused_witness | 10 | 10 | 10 | yes | 22.14 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| child | forged_permission_reused_witness | 128 | 10 | 10 | yes | 238.16 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| child | operation_escalation | 1 | 10 | 10 | yes | 0.22 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | operation_escalation | 10 | 10 | 10 | yes | 0.28 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | operation_escalation | 128 | 10 | 10 | yes | 4.77 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | required_not_delegated | 1 | 10 | 10 | yes | 0.24 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | required_not_delegated | 10 | 10 | 10 | yes | 0.30 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | required_not_delegated | 128 | 10 | 10 | yes | 4.80 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | required_not_disclosed | 10 | 10 | 10 | yes | 0.29 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | required_not_disclosed | 128 | 10 | 10 | yes | 4.80 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | revoked_child | 1 | 10 | 10 | yes | 8.19 | Credential urn:delegation:bench:child is revoked |
| child | revoked_child | 10 | 10 | 10 | yes | 40.60 | Credential urn:delegation:bench:child is revoked |
| child | revoked_child | 128 | 10 | 10 | yes | 476.40 | Credential urn:delegation:bench:child is revoked |
| child | revoked_root | 1 | 10 | 10 | yes | 4.23 | Credential urn:delegation:bench:root is revoked |
| child | revoked_root | 10 | 10 | 10 | yes | 20.52 | Credential urn:delegation:bench:root is revoked |
| child | revoked_root | 128 | 10 | 10 | yes | 238.53 | Credential urn:delegation:bench:root is revoked |
| child | unheld_permission_requested | 1 | 10 | 10 | yes | 0.23 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | unheld_permission_requested | 10 | 10 | 10 | yes | 0.28 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | unheld_permission_requested | 128 | 10 | 10 | yes | 4.79 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child | witness_swap | 10 | 10 | 10 | yes | 24.25 | Could not verify membership for element v1:74:gitea://gitea.local/team/app/branches/featur |
| child | witness_swap | 128 | 10 | 10 | yes | 243.31 | Could not verify membership for element v1:74:gitea://gitea.local/team/app/branches/featur |
| child | wrong_challenge | 1 | 10 | 10 | yes | 0.23 | VP challenge does not match the authorization context challenge |
| child | wrong_challenge | 10 | 10 | 10 | yes | 0.27 | VP challenge does not match the authorization context challenge |
| child | wrong_challenge | 128 | 10 | 10 | yes | 0.60 | VP challenge does not match the authorization context challenge |
| child_dirscope | batch_over_128 | 128 | 10 | 10 | yes | 0.00 | context: Authorization context exceeds 128 required permissions |
| child_dirscope | control_valid_batch | 1 | 10 | 0 | yes | 8.20 |  |
| child_dirscope | control_valid_batch | 10 | 10 | 0 | yes | 40.38 |  |
| child_dirscope | control_valid_batch | 128 | 10 | 0 | yes | 471.81 |  |
| child_dirscope | forged_permission_reused_witness | 1 | 10 | 10 | yes | 5.79 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| child_dirscope | forged_permission_reused_witness | 10 | 10 | 10 | yes | 21.92 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| child_dirscope | forged_permission_reused_witness | 128 | 10 | 10 | yes | 233.47 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| child_dirscope | operation_escalation | 1 | 10 | 10 | yes | 0.23 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | operation_escalation | 10 | 10 | 10 | yes | 0.27 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | operation_escalation | 128 | 10 | 10 | yes | 4.67 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | required_not_delegated | 1 | 10 | 10 | yes | 0.24 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | required_not_delegated | 10 | 10 | 10 | yes | 0.30 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | required_not_delegated | 128 | 10 | 10 | yes | 4.76 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | required_not_disclosed | 10 | 10 | 10 | yes | 0.29 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | required_not_disclosed | 128 | 10 | 10 | yes | 4.75 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | revoked_child | 1 | 10 | 10 | yes | 8.24 | Credential urn:delegation:bench:child is revoked |
| child_dirscope | revoked_child | 10 | 10 | 10 | yes | 40.31 | Credential urn:delegation:bench:child is revoked |
| child_dirscope | revoked_child | 128 | 10 | 10 | yes | 466.81 | Credential urn:delegation:bench:child is revoked |
| child_dirscope | revoked_root | 1 | 10 | 10 | yes | 4.25 | Credential urn:delegation:bench:root is revoked |
| child_dirscope | revoked_root | 10 | 10 | 10 | yes | 20.15 | Credential urn:delegation:bench:root is revoked |
| child_dirscope | revoked_root | 128 | 10 | 10 | yes | 235.68 | Credential urn:delegation:bench:root is revoked |
| child_dirscope | unheld_permission_requested | 1 | 10 | 10 | yes | 0.22 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | unheld_permission_requested | 10 | 10 | 10 | yes | 0.28 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | unheld_permission_requested | 128 | 10 | 10 | yes | 4.72 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| child_dirscope | witness_swap | 10 | 10 | 10 | yes | 24.08 | Could not verify membership for element v1:74:gitea://gitea.local/team/app/branches/featur |
| child_dirscope | witness_swap | 128 | 10 | 10 | yes | 237.50 | Could not verify membership for element v1:74:gitea://gitea.local/team/app/branches/featur |
| child_dirscope | wrong_challenge | 1 | 10 | 10 | yes | 0.23 | VP challenge does not match the authorization context challenge |
| child_dirscope | wrong_challenge | 10 | 10 | 10 | yes | 0.26 | VP challenge does not match the authorization context challenge |
| child_dirscope | wrong_challenge | 128 | 10 | 10 | yes | 0.58 | VP challenge does not match the authorization context challenge |
| root | batch_over_128 | 128 | 10 | 10 | yes | 0.00 | context: Authorization context exceeds 128 required permissions |
| root | control_valid_batch | 1 | 10 | 0 | yes | 4.22 |  |
| root | control_valid_batch | 10 | 10 | 0 | yes | 20.50 |  |
| root | control_valid_batch | 128 | 10 | 0 | yes | 241.72 |  |
| root | forged_permission_reused_witness | 1 | 10 | 10 | yes | 5.77 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| root | forged_permission_reused_witness | 10 | 10 | 10 | yes | 22.06 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| root | forged_permission_reused_witness | 128 | 10 | 10 | yes | 238.46 | Could not verify membership for element v1:79:gitea://gitea.local/team/app/branches/featur |
| root | operation_escalation | 1 | 10 | 10 | yes | 0.21 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | operation_escalation | 10 | 10 | 10 | yes | 0.24 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | operation_escalation | 128 | 10 | 10 | yes | 4.50 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | required_not_delegated | 1 | 10 | 10 | yes | 0.23 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | required_not_delegated | 10 | 10 | 10 | yes | 0.26 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | required_not_delegated | 128 | 10 | 10 | yes | 4.62 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | required_not_disclosed | 10 | 10 | 10 | yes | 0.25 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | required_not_disclosed | 128 | 10 | 10 | yes | 4.59 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | revoked_root | 1 | 10 | 10 | yes | 4.21 | Credential urn:delegation:bench:root is revoked |
| root | revoked_root | 10 | 10 | 10 | yes | 20.45 | Credential urn:delegation:bench:root is revoked |
| root | revoked_root | 128 | 10 | 10 | yes | 239.87 | Credential urn:delegation:bench:root is revoked |
| root | unheld_permission_requested | 1 | 10 | 10 | yes | 0.21 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | unheld_permission_requested | 10 | 10 | 10 | yes | 0.25 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | unheld_permission_requested | 128 | 10 | 10 | yes | 4.60 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branches/featur |
| root | witness_swap | 10 | 10 | 10 | yes | 3.99 | Could not verify membership for element v1:74:gitea://gitea.local/team/app/branches/featur |
| root | witness_swap | 128 | 10 | 10 | yes | 8.45 | Could not verify membership for element v1:74:gitea://gitea.local/team/app/branches/featur |
| root | wrong_challenge | 1 | 10 | 10 | yes | 0.21 | VP challenge does not match the authorization context challenge |
| root | wrong_challenge | 10 | 10 | 10 | yes | 0.23 | VP challenge does not match the authorization context challenge |
| root | wrong_challenge | 128 | 10 | 10 | yes | 0.40 | VP challenge does not match the authorization context challenge |
