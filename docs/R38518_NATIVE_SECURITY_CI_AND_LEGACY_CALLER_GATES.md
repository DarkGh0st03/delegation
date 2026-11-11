# R385.18 — Security CI con E2E nativa e gate sui caller legacy

**Data:** 8 novembre 2026. **Sviluppo:** `refactor/post-prof-plan-contracts-20261021`, GitHub PR #38 Draft. Nessun merge su `main`, nessuna inferenza Gemini a pagamento.

## Risultati verificati

- [**Security CI positiva #42476252134**](https://github.com/DarkGh0st03/delegation/actions/runs/42476252134) **SUCCESS in entrambi i job**, entrambi sulla SHA `e24cdba028edecbe7ca166b563cd5136c2b70207`. Uno resta la regressione positiva storica del Runner, uno richiama tramite `workflow_call` la E2E completa canonica `r38513-native-strict-full-recovery.yml`.
- Il job **storico** ha attestato `trusted_security_ci_real_docker_positive_acceptance.status:"PASS"`, `project_tests:"pass"`, `researcher_acceptance:"pass"` e `real_opa_signed_plan_policy:true`, ma **`native_rust_signed_child_and_vp:false`**, `runner_via_gateway_http:true`, `pr_created:false`. Quindi rimane una regressione supplementare, **non** la prova dell'architettura finale.
- Il job **Rust/Child/VP/MCP nativo** ha attestato `r38513_native_ten_signed_reads_ten_cas_docker_pass_draft_pr.status:"pass"`, un primo `r375_runner_sanitized_result.status:"fail"`, poi `"pass"`, **10 letture firmate indipendenti**, **10 repair CAS**, Root unica/24 Child/25 decisioni, researcher acceptance PASS, Draft PR Gitea nuova e non mergiata, `paid_model_calls:0`. I contributi applicativi sono **scripted**, `source_code_generated_autonomously_by_model:false`. Nessun merge reale.
- [**Fast CI #42476764541**](https://github.com/DarkGh0st03/delegation/actions/runs/42476764541) **SUCCESS 2/2** sulla SHA `d00896191367e25108b5cdebe2fd220489ed7fd8`. I log riportano `R38517_MIGRATION_GATE_PASS`, **10/10 test degli audit R385.17/R385.18** e Docker failure evidence SUCCESS. Le due run qui citate sono su **SHA differenti**; non dichiarare falsamente un gate finale stessa-SHA già raggiunto.

## Modifiche implementate

1. `.github/workflows/r38513-native-strict-full-recovery.yml` espone `workflow_call` oltre ai trigger manuale/push precedenti. Il percorso completo è riutilizzabile **sulla revisione del chiamante**, senza segreti AI né merge.
2. `.github/workflows/isolated-positive-security-ci.yml` conserva `real-positive-exact-sha` e aggiunge `authority-only-native-rust-positive` tramite `uses: ./.github/workflows/r38513-native-strict-full-recovery.yml`. Il trigger include anche le modifiche al workflow nativo riutilizzabile.
3. `trusted-repair-dag-controller.ts` importa il puro tipo `ChildIssuanceInput` da `trusted-credential-contracts.ts` anziché transitare dal client Engineer HTTP storico.
4. `poc/scripts/r38517-canonical-route-closure.mjs` ora pubblica l'origine degli import legacy per-caller e vincola **esattamente** i caller non-test ammessi dalla lista `R38518_ALLOWED_NONTEST_LEGACY_CALLERS`. Qualsiasi nuovo import di codice/script di questi moduli senza review comporta NO-GO; gli import dei test storici restano separati.
5. Test negativi proteggono la dipendenza della Security CI dalla E2E Rust, la capacità `workflow_call`, i moduli MCP privati, gli import runtime legacy e il tipo neutrale del controller recovery.

## Blocchi prima della rimozione fisica

I cinque target storici restano presenti. **Il gate non autorizza a eliminarli**:

| Modulo | Caller non-test censiti da migrare/revisionare |
| --- | --- |
| `authority-client.ts` | `approved-gateway-runner-session.mjs` (script storico Runner); `trusted-engineer-legacy-mcp-http-port.ts` (port storico esplicitamente gated) |
| `authority-adapter-transport.ts` | `authority-client.ts` |
| `trusted-reviewed-approved-dag.ts` | `trusted-admitted-github-handoff.ts`, `trusted-admitted-scripted-handoff.ts`, `trusted-fresh-repair-reviewed-dag.ts` (import dinamici storici) |
| `trusted-operational-repair-planner.ts`, `trusted-repair-dag-controller.ts` | `trusted-owner-operational-repair-handoff.ts` (import dinamici storici) |

Sono conservati anche gli **11 riferimenti di test** (18 riferimenti complessivi). Il vecchio R6 segnala **117 indirezioni runtime** non totalmente risolte. I quattro moduli `poc/mcp-shared/src/owner-private-*` sono **da preservare**: implementano il MCP crittografico privato/stdio, non lo Shared MCP Server da rimuovere. `deletionAuthorized:false`; consumer esterni e configurazione amministrativa della protezione non ancora verificati.

**Prossimo gate:** dopo la review dei caller e l'eventuale cleanup selettivo, Fast CI + Security CI positiva (inclusa la E2E nativa) devono essere verdi **sulla stessa SHA post-cleanup**. La validazione di autonomia generativa richiederà separatamente consenso esplicito ai costi Gemini; nessun test scripted deve essere presentato come autonomia reale.
