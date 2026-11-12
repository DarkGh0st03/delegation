# R385.17 — Workflow e caller: migrazione tracciata (senza cancellazione fisica)

**Data:** 8 novembre 2026. **SHA validata:** `cb2b18dba29418c7d94e050c57a034f3dd8a5ef8`.

**Esito verificato:** [Fast CI #42474653882](https://github.com/DarkGh0st03/delegation/actions/runs/42474653882) **SUCCESS, 2/2 job**; il log contiene `R38517_MIGRATION_GATE_PASS`, `issues:[]` e **7/7 test R385.17 PASS**.
[Security CI positiva isolata #42474258290](https://github.com/DarkGh0st03/delegation/actions/runs/42474258290) **SUCCESS** sulla SHA **precedente** `42435c7a`, dopo il precaricamento OPA necessario. Non attribuire questa run alla SHA dell'audit più recente.

## Modifiche realizzate

**1. Disabilitato il trigger `main` dell'Adapter HTTP storico.** La workflow [`phase11-security.yml`](../.github/workflows/phase11-security.yml) può ora avviarsi **soltanto tramite `workflow_dispatch`**, per preservare temporaneamente la copertura degli esperimenti di kill-switch, revoca e stale SHA. Non è stata lanciata, né è stata rimossa la relativa implementazione. Questo blocca l'avvio automatico di quell'Adapter su push a `main` quando il branch verrà integrato.

**2. Riagganciata la Security CI positiva al branch attuale.** [`isolated-positive-security-ci.yml`](../.github/workflows/isolated-positive-security-ci.yml) segue `refactor/post-prof-plan-contracts-20261021` per i file Runner/acceptance interessati. Il job prepara Gitea, OPA `openpolicyagent/opa:1.21.1` e Node pinned; esegue test indipendenti senza chiavi AI e senza toccare Gitea persistente.

**Precisazione architetturale:** nella run positiva il log attesta `real_docker_runner:true`, `project_tests:"pass"`, `researcher_acceptance:"pass"`, `real_opa_signed_plan_policy:true` e `merge_calls:0`, ma segnala **`native_rust_signed_child_and_vp:false`**, **`runner_via_gateway_http:true`** e **`pr_created:false`**. Questa rimane una *regressione positiva storica* del Runner/acceptance, **non una E2E native authority-only**. La E2E nativa completa precedentemente superata resta [#42471999178](https://github.com/DarkGh0st03/delegation/actions/runs/42471999178), SHA `f4106a88`. Non è stato ancora ripetuto il gate nativo integrale sull'ultima SHA R385.17.

**3. Inventario per-caller automatico, senza eseguire moduli.** La [`r38517-canonical-route-closure.mjs`](../poc/scripts/r38517-canonical-route-closure.mjs) riutilizza R6/R385.4/R385.16 per registrare import statici, import dinamici letterali e caller configurati. Fallisce se si reintroduce un trigger HTTP legacy automatico, se la Security CI torna al vecchio branch, se il runtime nativo importa un modulo legacy nel percorso canonico o se scompare il MCP privato. Conserva il **test negativo** che tenta appositamente l'avvio dell'Adapter e verifica che venga rifiutato: non lo confonde con un vero fallback HTTP.

## Mappa dei cinque candidati legacy

| Modulo | Riferimenti classificati | Dettaglio e decisione |
| --- | ---: | --- |
| `authority-client.ts` | 5 | 3 test; 1 script; 1 altro import runtime. Richiede migrazione/controllo del caller runtime |
| `authority-adapter-transport.ts` | 1 | Import runtime storico ancora da tracciare e isolare |
| `trusted-reviewed-approved-dag.ts` | 6 | 3 test; 3 import runtime storici; il gate R385.4 ne vincola esattamente le origini |
| `trusted-operational-repair-planner.ts` | 3 | 2 test; 1 import runtime storico gated |
| `trusted-repair-dag-controller.ts` | 3 | 2 test; 1 import runtime storico gated |

Totale: **18 riferimenti classificati**, con provenance per singolo file disponibile nell'oggetto `scanR38517().callers.modules[].callers`. I quattro moduli sotto `poc/mcp-shared/src/owner-private-*` rimangono **da conservare**, perché sono la superficie del MCP crittografico privato/stdio. La scansione continua a riportare **117 indirezioni runtime non risolte** a livello di repository. Il rapporto riporta `externalConsumersVerified:false` e **`deletionAuthorized:false`**. Le stime non dimostrano completa reachability di deployment, import computati o consumo esterno.

## Restrizioni ancora valide e prossimi gate

Il Human Gate rimane **manuale e separato dagli agenti**; R385.16 ne ha testato le invarianti offline, ma non può attestare i revisori dell'ambiente protetto GitHub né la reale configurazione amministrativa di Gitea.

**R385.18:** identificare e migrare gli ultimi caller runtime delle due classi `authority-*`; portare la copertura di Security CI che oggi usa Gateway HTTP verso il percorso **Engineer/Gateway diretto a Rust, Child DC e VP su MCP privato**; trasferire eventuali test unici Phase11 su fixture disposable canoniche prima della rimozione del relativo workflow. Eliminare fisicamente soltanto ciò che risulta senza caller non migrati, con regressioni e test negativi preservati. Eseguire **Fast CI, Security CI ed E2E Rust/OPA/Gitea/A2A/MCP/Docker FAIL→PASS/Draft PR sulla stessa SHA post-cleanup**. Nessuna riattivazione del workflow Shared MCP a pagamento e nessun Gemini senza consenso esplicito.

**Nessuna operazione di merge o modifica di `main`; PR GitHub #38 resta Draft.**
