# R318: native effect-staging regression and ADK tool scope

## Confirmed cause (R315)
The native Docker run [#42075284441](https://github.com/DarkGh0st03/delegation/actions/runs/42075284441)
failed in `r305-native-backend-frontend-test-e2e.mjs` when a
duplicate mutation preflight expected `EEXIST` but the newly staged
Task flight denied it first: `update preflight has no exact signed Task or enrolled native Child`.
That is the stricter legitimate denial. No unauthorized Gitea write
was observed. The expected error and zero-effect assertion are fixed.

## Client guard
Only `update_file` and `run_tests` call the private owner effect
stager between Gateway prepare and VP. `read_file` retains the native
Gateway authorization without trying to reserve a mutation.
`create_file` fails closed when owner staging is installed because
no owner-bound native CAS create executor exists yet. The legacy
client with no stager keeps its historical behavior; this is NOT
a permission grant or runtime fallback.

## Validation
Fast CI covers constructor, staging order, replay, private error
redaction and the role of each supported tool. The single R318
checkpoint requests one real disposable native Rust/EVM/OPA/Gitea/
Docker run; no model calls. A success claim requires green CI on
this exact SHA. This does not attest live Gemini/ADK adaptive
dispatch, recovery D1 or an Engineer GUI.
