# Phase 1b summary — real-evm

- positive rows: 690 (direct 600, proxy 90); failed: 45
- negative cases as expected: False
- latency: path=direct only; RPC counts: path=proxy only

## child

| k | separate VPs total s (median [p5–p95]) | single VP total s (median [p5–p95]) | speedup total (paired 95% CI) | speedup verify (paired 95% CI) | time saved s |
|---:|---|---|---|---|---:|
| 1 | 1.549 [1.488–1.644] | 1.516 [1.473–1.590] | 1.02 (0.99–1.05) | 1.02 (0.99–1.05) | 0.03 |
| 2 | 3.047 [2.980–3.231] | 1.535 [1.486–1.604] | 1.98 (1.95–2.03) | 1.98 (1.95–2.03) | 1.51 |
| 5 | 7.645 [7.474–7.853] | 1.546 [1.488–1.645] | 4.94 (4.81–5.04) | 4.94 (4.81–5.04) | 6.10 |
| 10 | 15.293 [14.982–15.840] | 1.555 [1.504–1.620] | 9.84 (9.68–9.98) | 9.83 (9.68–9.98) | 13.74 |
| 15 | 23.025 [22.535–23.766] | 1.593 [1.526–1.748] | 14.45 (14.24–14.71) | 14.45 (14.24–14.71) | 21.43 |

Breakdown of ONE verification (single VP, multi mode), medians:

| k | verify ms | DID resolutions (n / ms) | registry reads (n / ms) | file reads (n / ms) | crypto+parsing residual ms | VP bytes |
|---:|---:|---|---|---|---:|---:|
| 1 | 1515.7 | 3 / 1496.1 | 10 / 6.6 | 4 / 1.8 | 10.6 | varies:[2354, 2355] |
| 2 | 1534.2 | 3 / 1511.7 | 10 / 6.4 | 4 / 2.1 | 15.6 | varies:[2780, 2782] |
| 5 | 1545.3 | 3 / 1511.6 | 10 / 6.4 | 4 / 2.0 | 27.3 | varies:[4060, 4062] |
| 10 | 1554.3 | 3 / 1495.9 | 10 / 6.5 | 4 / 1.8 | 51.1 | varies:[6194, 6195] |
| 15 | 1592.4 | 3 / 1513.1 | 10 / 7.0 | 4 / 1.8 | 65.3 | varies:[8327, 8328] |

JSON-RPC traffic per authorization (proxy rows; requests / calls: eth_call, eth_getLogs, eth_chainId, other):

| k | separate VPs | single VP |
|---:|---|---|
| 1 | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) |
| 2 | varies:[34, 56] / varies:[50, 80] (varies:[12, 24], varies:[4, 6], varies:[26, 38], varies:[8, 12]) | 17 / 25 (6, 2, 13, 4) |
| 5 | varies:[85, 140] / varies:[125, 200] (varies:[30, 60], varies:[10, 15], varies:[65, 95], varies:[20, 30]) | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) |
| 10 | varies:[170, 280] / varies:[250, 400] (varies:[60, 120], varies:[20, 30], varies:[130, 190], varies:[40, 60]) | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) |
| 15 | varies:[255, 420] / varies:[375, 600] (varies:[90, 180], varies:[30, 45], varies:[195, 285], varies:[60, 90]) | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) |

## child_dirscope

| k | separate VPs total s (median [p5–p95]) | single VP total s (median [p5–p95]) | speedup total (paired 95% CI) | speedup verify (paired 95% CI) | time saved s |
|---:|---|---|---|---|---:|
| 1 | 1.531 [1.467–1.625] | 1.509 [1.486–1.648] | 1.01 (0.98–1.04) | 1.01 (0.98–1.04) | 0.02 |
| 2 | 3.046 [2.973–3.271] | 1.526 [1.483–1.695] | 2.00 (1.93–2.04) | 2.00 (1.93–2.04) | 1.52 |
| 5 | 7.645 [7.437–8.113] | 1.535 [1.497–1.677] | 4.98 (4.95–5.06) | 4.98 (4.95–5.06) | 6.11 |
| 10 | 15.244 [14.904–15.875] | 1.561 [1.522–1.694] | 9.77 (9.60–9.89) | 9.77 (9.60–9.89) | 13.68 |
| 15 | 22.810 [22.441–24.115] | 1.599 [1.534–1.687] | 14.27 (14.12–14.60) | 14.27 (14.12–14.59) | 21.21 |

Breakdown of ONE verification (single VP, multi mode), medians:

| k | verify ms | DID resolutions (n / ms) | registry reads (n / ms) | file reads (n / ms) | crypto+parsing residual ms | VP bytes |
|---:|---:|---|---|---|---:|---:|
| 1 | 1507.9 | 3 / 1488.9 | 10 / 6.6 | 4 / 2.1 | 11.1 | varies:[2354, 2355] |
| 2 | 1525.6 | 3 / 1504.9 | 10 / 6.3 | 4 / 1.7 | 15.1 | varies:[2770, 2771] |
| 5 | 1534.6 | 3 / 1496.8 | 10 / 6.3 | 4 / 1.8 | 25.0 | varies:[4018, 4019] |
| 10 | 1559.8 | 3 / 1504.1 | 10 / 6.4 | 4 / 2.1 | 51.2 | varies:[6098, 6099] |
| 15 | 1598.1 | 3 / 1494.9 | 10 / 6.8 | 4 / 2.0 | 65.1 | varies:[8178, 8179] |

JSON-RPC traffic per authorization (proxy rows; requests / calls: eth_call, eth_getLogs, eth_chainId, other):

| k | separate VPs | single VP |
|---:|---|---|
| 1 | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) |
| 2 | varies:[34, 56] / varies:[50, 80] (varies:[12, 24], varies:[4, 6], varies:[26, 38], varies:[8, 12]) | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) |
| 5 | 85 / 125 (30, 10, 65, 20) | varies:[17, 28] / varies:[25, 40] (varies:[6, 12], varies:[2, 3], varies:[13, 19], varies:[4, 6]) |
| 10 | varies:[170, 192] / varies:[250, 280] (varies:[60, 72], varies:[20, 22], varies:[130, 142], varies:[40, 44]) | 17 / 25 (6, 2, 13, 4) |
| 15 | varies:[255, 420] / varies:[375, 600] (varies:[90, 180], varies:[30, 45], varies:[195, 285], varies:[60, 90]) | 17 / 25 (6, 2, 13, 4) |

## root

| k | separate VPs total s (median [p5–p95]) | single VP total s (median [p5–p95]) | speedup total (paired 95% CI) | speedup verify (paired 95% CI) | time saved s |
|---:|---|---|---|---|---:|
| 1 | 1.010 [0.981–1.079] | 1.015 [0.973–1.076] | 1.00 (0.97–1.03) | 1.00 (0.97–1.03) | -0.00 |
| 2 | 2.025 [1.973–2.209] | 1.023 [0.997–1.080] | 1.98 (1.95–2.02) | 1.98 (1.95–2.02) | 1.00 |
| 5 | 5.104 [4.962–5.246] | 1.029 [0.984–1.132] | 4.96 (4.82–5.06) | 4.96 (4.82–5.06) | 4.07 |
| 10 | 10.228 [9.959–10.811] | 1.040 [1.009–1.125] | 9.83 (9.71–10.02) | 9.83 (9.71–10.02) | 9.19 |
| 15 | 15.250 [14.916–16.018] | 1.026 [1.008–1.132] | 14.86 (14.76–14.99) | 14.86 (14.76–14.99) | 14.22 |

Breakdown of ONE verification (single VP, multi mode), medians:

| k | verify ms | DID resolutions (n / ms) | registry reads (n / ms) | file reads (n / ms) | crypto+parsing residual ms | VP bytes |
|---:|---:|---|---|---|---:|---:|
| 1 | 1014.1 | 2 / 1002.3 | 7 / 4.8 | 2 / 0.9 | 5.1 | varies:[1415, 1416] |
| 2 | 1022.8 | 2 / 1008.6 | 7 / 5.1 | 2 / 0.9 | 7.2 | varies:[1628, 1630] |
| 5 | 1028.6 | 2 / 1010.1 | 7 / 4.7 | 2 / 0.8 | 12.6 | varies:[2268, 2270] |
| 10 | 1039.4 | 2 / 1006.6 | 7 / 4.9 | 2 / 0.8 | 22.6 | varies:[3335, 3336] |
| 15 | 1025.8 | 2 / 986.8 | 7 / 4.9 | 2 / 0.9 | 32.0 | varies:[4402, 4403] |

JSON-RPC traffic per authorization (proxy rows; requests / calls: eth_call, eth_getLogs, eth_chainId, other):

| k | separate VPs | single VP |
|---:|---|---|
| 1 | 19 / 27 (8, 2, 13, 4) | 19 / 27 (8, 2, 13, 4) |
| 2 | 38 / 54 (16, 4, 26, 8) | 19 / 27 (8, 2, 13, 4) |
| 5 | 95 / 135 (40, 10, 65, 20) | 19 / 27 (8, 2, 13, 4) |
| 10 | 190 / 270 (80, 20, 130, 40) | 19 / 27 (8, 2, 13, 4) |
| 15 | 285 / 405 (120, 30, 195, 60) | 19 / 27 (8, 2, 13, 4) |

## Negative cases (real trust layer)

| config | case | n | rejected | median s | reason |
|---|---|---:|---:|---:|---|
| child | control_valid_batch | 5 | 5 | 1.435 | Timestamp is greater than expiration time 1795596439887391759 |
| child | required_not_delegated | 5 | 5 | 0.721 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branc |
| child | revoked_root_onchain | 5 | 5 | 1.459 | Credential urn:delegation:bench1b:root is revoked |
| child | wrong_challenge | 5 | 5 | 0.698 | VP challenge does not match the authorization context challenge |
| child_dirscope | control_valid_batch | 5 | 5 | 1.444 | Timestamp is greater than expiration time 1795596439896126085 |
| child_dirscope | required_not_delegated | 5 | 5 | 0.689 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branc |
| child_dirscope | revoked_root_onchain | 5 | 5 | 1.439 | Credential urn:delegation:bench1b:root-dir is revoked |
| child_dirscope | wrong_challenge | 5 | 5 | 0.694 | VP challenge does not match the authorization context challenge |
| root | control_valid_batch | 5 | 0 | 1.518 |  |
| root | required_not_delegated | 5 | 5 | 0.706 | Required permissions not disclosed in the VP: gitea://gitea.local/team/app/branc |
| root | revoked_root_onchain | 5 | 5 | 1.471 | Credential urn:delegation:bench1b:root is revoked |
| root | wrong_challenge | 5 | 5 | 0.680 | VP challenge does not match the authorization context challenge |
