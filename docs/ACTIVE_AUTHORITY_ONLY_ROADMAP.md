# Delegation — roadmap operativa (authority-only)

**Aggiornamento:** 8 novembre 2026 · **Branch di sviluppo:** `refactor/post-prof-plan-contracts-20261021` · **GitHub PR:** [#38](https://github.com/DarkGh0st03/delegation/pull/38), Draft e non mergiata.

> Questa pagina è la **fonte operativa sintetica**: obiettivi, stato verificato e lavoro residuo. I resoconti R282–R345 di fase esplorativa sono stati rimossi dal **tree attivo** per ridurne la dimensione; rimangono recuperabili dalla cronologia Git fino alla SHA `8bf19fd59e042b7e4f189f9a543aa8933a169680`. I documenti recenti di architettura e sicurezza restano tracciati. La riduzione del tree **non** riscrive la storia Git né dimostra che le dipendenze legacy siano tutte eliminate.

## Mandato architetturale

- **Software Engineer → Rust diretto** per approvazione/Root/revoca; il perimetro dei permessi firmato Ed25519 è immutabile. Il DAG operativo **non** costituisce l'autorità firmata.
- **Gateway → Rust diretto** per DC/VP, con controlli indipendenti OPA e Gitea. L'Adapter HTTP storico **non** deve essere un fallback dell'architettura authority-only.
- **Orchestrator** con Planner ed Executor distinti; Task e dipendenze sono scelti e adattati dall'ADK, sotto Root/Child e limiti del Gateway; nessuna espansione automatica dei privilegi dopo un errore.
- **Agenti A2A:** Backend, Frontend, Test per lo scenario Account Suspension. Il crypto MCP **privato/stdio** per Child DC e VP deve essere mantenuto; Shared MCP Server e worker privati storici **non** devono essere reintrodotti.
- File Gitea modificati tramite HEAD/CAS attestati; Docker Runner e researcher acceptance indipendenti. La Draft PR viene prodotta solo da revisioni testate; nessun merge automatico.
- Nessun workflow Gemini **a pagamento** senza consenso esplicito. La prova scripted non dimostra autonomia generativa.

## Stato confermato

| Area | Evidenza / stato | Limite ancora aperto |
| --- | --- | --- |
| Rust, Root preliminare, revoca, Root operativa, Child DC/VP | Implementati e validati in E2E native | Non riprogettare Core Rust; proteggere interfacce e regressioni |
| Engineer e Gateway in modalità authority-only | Rust diretto, scope/OPA/Gitea e controlli anti-fallback | Verificare permanentemente il percorso legacy HTTP e i caller residui |
| Planner/Executor ADK con agenti A2A | Esecuzione e recovery multi-task scripted con 10 read firmate e 10 CAS | Generalizzare capacità e decisioni **con Gemini reale**, solo dopo il gate economico |
| Docker FAIL → recovery → PASS e Draft PR Gitea | [Security CI #42477209043](https://github.com/DarkGh0st03/delegation/actions/runs/42477209043): SUCCESS 2/2 sulla SHA `bbb60fa0` | Run native scripted e ambienti disposable; non è una PR di produzione |
| Contratti, autorizzazioni, Docker failure evidence | [Fast CI #42477209047](https://github.com/DarkGh0st03/delegation/actions/runs/42477209047): SUCCESS 2/2 sulla **stessa SHA** `bbb60fa0` | Ripetere la doppia validazione **dopo ogni cleanup** |
| Engineer HTTP legacy con opt-in | Rifiuto predefinito salvo `DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE=1`; modalità native/authority-only vincono sempre | Mantenere solo le fixture autorizzate e migrare i caller rimasti |
| Engineer due Root, test offline | [Run #42478682804](https://github.com/DarkGh0st03/delegation/actions/runs/42478682804): SUCCESS sulla SHA `f2964da3` | Validare ancora dopo la pulizia finale |
| Test Agent `create_file` nativo (R387/R388) | [CREATE A2A #42489115170](https://github.com/DarkGh0st03/delegation/actions/runs/42489115170) e [CREATE + Docker #42489115176](https://github.com/DarkGh0st03/delegation/actions/runs/42489115176): SUCCESS stessa SHA `17f3da9e` | CREATE solo `tests/backend/**.test.ts` o `tests/frontend/**.test.ts(x)`, con Child/Gateway/OPA/CAS/MAC; Docker qui è una prova indipendente, non un secondo Runner Child |
| Test Runner Child separato (R393/R394) | [R393 #42491911634](https://github.com/DarkGh0st03/delegation/actions/runs/42491911634) e [R394 #42491911642](https://github.com/DarkGh0st03/delegation/actions/runs/42491911642): SUCCESS stessa SHA `2d2ff0be` | R394 prova Gateway Runner PASS e researcher acceptance mediante invocazione dell'harness, non la FunctionTool A2A; R395 è la verifica dedicata |
| R385.19 Rust native completa | [Run #42478904754](https://github.com/DarkGh0st03/delegation/actions/runs/42478904754): SUCCESS sulla SHA `8bf19fd5`; [Fast CI #42478904760](https://github.com/DarkGh0st03/delegation/actions/runs/42478904760): SUCCESS stessa SHA | Nessuna inferenza Gemini reale; è una regressione scripted |
| Security CI positiva | Due job separati: Runner storico e Rust/Child/VP/MCP nativo | Non scambiare il Runner via Gateway HTTP per prova di Child/VP; attestare lo status della **stessa PR prodotta** dal test nativo |
| Human Gate | Regole di merge e test negativi offline, workflow `workflow_dispatch` | Configurazione reale dei required reviewers e collegamento Security CI → PR → verifica merge **non ancora attestati** |
| Pulizia legacy | R385.17/R385.18 inventario per-caller e allowlist, 117 indirezioni runtime irrisolte | Rimuovere fisicamente solo moduli, workflow e test con copertura sostitutiva verificata |

## Lavoro residuo — ordine di esecuzione

1. **Capacità Test Agent (A — completata e verificata).** R387/R388 hanno chiuso `create_file` nativo, con Agent Card, FunctionTool, A2A, MCP privato, Child Rust, OPA, Gateway e CAS/MAC Gitea, senza scrittura su `main`. R393/R394 hanno aggiunto un Child distinto per `run_tests` e provato il Runner via Gateway con Docker e researcher acceptance. **R395 deve ancora attestare `run_tests` tramite FunctionTool A2A**, non soltanto tramite l'harness; mantenere regressioni e limiti per-Task.
2. **Generalità dell'Execution Loop (B/C — parziale).** Completare R395 e consolidare le prove dei Task sequenziali con Child distinti e completamento indipendente. Rendere dichiarativa la selezione di ruoli/capacità dove possibile: il PoC conserva Backend/Frontend/Test, senza imporli tutti per ogni requisito. Un requisito multi-file usa Task/CAS successive; **l'Engineer firma il solo scope, mai il DAG**.
3. **Security CI → Human Gate (D).** Collegare la Draft PR Gitea nativa allo status Security CI **sulla stessa HEAD**, con identità di CI separata e verifica read-only del Human Gate. Non invocare il vero merge. Verificare con un amministratore required reviewers e protezioni dell'ambiente GitHub.
4. **Cleanup effettivo (E).** Il primo batch elimina dal tree 69 report R282–R345 ormai assorbiti nelle E2E successive; mantiene tutti i sorgenti, workflow, checkpoint CI e test. Il seguito deve classificare ciascun runner, workflow e file di test prima di eliminarlo: non basta contare import statici. Rimuovere o migrare `authority-client`, `authority-adapter-transport`, vecchi Signed DAG e script soltanto quando non esistono caller operativi e la copertura negativa è conservata. Non eliminare i quattro moduli `poc/mcp-shared/src/owner-private-*`.
5. **Gate post-cleanup (D/E).** Fast CI, Engineer Authority, Security CI positiva e E2E Rust/OPA/Gitea/MCP/A2A/Docker FAIL→PASS/Draft PR **sulla stessa SHA finale**. Nessuna cancellazione di moduli prima di questi controlli sullo specifico batch.
6. **Pilot generativo (F).** Solo dopo il completamento dei gate e il **consenso esplicito al costo**: provare Google ADK/Gemini reale su Account Suspension, osservando decisioni, read-first repair, Test Agent, token e costo. Non presentare un PASS scripted come generativo.
7. **GUI e flessibilità repository (G).** Ultimo blocco; non deve ritardare il cleanup e la validazione dell'autorità.

## Regole di sicurezza e non-regressione

- **Mai** modificare automaticamente `main`, invocare un merge Gitea/GitHub o introdurre credenziali di merge negli agenti.
- Il Test FAIL resta registrato come errore, **non** Task completato; i Task successivi dipendono solo da completamenti autenticati.
- Il Test Agent può eseguire `create_file` **solo** con Child/Task esatto per il nuovo sorgente `tests/backend/**.test.ts` o `tests/frontend/**.test.ts(x)`. `run_tests` richiede **un altro Child/Task**; nessun privilegio implicito per sorgenti applicativi, Runner config, acceptance, traversal o dopo un FAIL.
- Una lettura diagnostica è accettata solo con ricevuta Gateway firmata, ruolo/risorsa/HEAD correnti e scope originale. Ogni modifica impiega una nuova CAS.
- Nessun `Shared MCP`/worker legacy mascherato da modulo nuovo; conservare invece il Child/VP crypto MCP privato/stdio.
- Le pipeline positive storiche (Gateway HTTP) possono restare regression fixtures, **non** sono evidenza equivalente al percorso nativo.
- Il Human Gate rimane esterno all'Orchestrator; qualsiasi verifica statica dei workflow non attesta i revisori GitHub effettivamente configurati.

## Riferimenti canonici da mantenere

- [Decisioni architetturali](ARCHITECTURE_DECISIONS.md), [stato implementativo](IMPLEMENTATION_STATE.md), [riproducibilità](REPRODUCIBILITY.md).
- [Security CI / Human Gate — audit](R38516_HUMAN_GATE_AND_LEGACY_REACHABILITY.md).
- [Migrazione workflow e caller legacy](R38517_WORKFLOW_AND_CALLER_MIGRATION.md).
- [E2E native riutilizzabile e caller pinning](R38518_NATIVE_SECURITY_CI_AND_LEGACY_CALLER_GATES.md).
- [Owner bootstrap canonico](../poc/apps/orchestrator/src/trusted-authority-only-owner-bootstrap.mjs).
- [Engineer crypto selector](../poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts).
- [ADK decision proposer](../poc/packages/orchestrator-runtime/src/trusted-authority-only-adk-decision-proposer.mjs).
- [Security CI positiva](../.github/workflows/isolated-positive-security-ci.yml) e [Human merge manuale](../.github/workflows/human-approved-gitea-merge.yml).

## Cleanup: rapporto iniziale e confine della prova

- **Baseline di confronto:** SHA `8bf19fd59e042b7e4f189f9a543aa8933a169680`: **1.357** file tracciati, di cui 69 documenti milestone R282–R345 ora consolidati nella roadmap e nei report recenti.
- **Batch 1 (validato):** 69 report storici R282–R345 eliminati nella SHA [`c97bf3ef`](https://github.com/DarkGh0st03/delegation/commit/c97bf3ef7d6506d419287464ad6cd687b103c9b3); **1.357 → 1.288** file, roadmap **2.120 → 69 righe**. [Fast CI #42479660224](https://github.com/DarkGh0st03/delegation/actions/runs/42479660224): **SUCCESS 2/2**.
- **Batch 2 (presente commit):** eliminati **7 workflow nativi di milestone R296/R300/R301/R302-update/R303/R304/R305**, insieme ai **7 payload JSON utilizzati esclusivamente per attivarli**; riduzione **1.288 → 1.274** file e **95 → 88 workflow**; checkpoint **57 → 50**. Questi workflow erano `workflow_dispatch` più `push` filtrato solo sul relativo JSON e non erano workflow riutilizzabili (`workflow_call` assente). Il source di **tutti e 7 i test E2E** che invocavano rimane tracciato.
- **Non toccati:** i workflow delle **negazioni specifiche** R292 (Rust/EVM/OPA denial) e R302 Gitea-CAS stale/concurrent writer, la E2E authority-only completa R385.13, la Security CI positiva, il Human Gate, tutti i sorgenti, tutti i test e i 4 moduli MCP crittografici privati.
- **Limiti:** i due batch riducono realmente il tree e non spostano i file in `legacy/`; i contenuti storici sono recuperabili dalla cronologia Git. I **50 checkpoint e 88 workflow residui richiedono un audit dei consumer** prima di ulteriori eliminazioni. Le 117 indirezioni runtime e le dipendenze esterne non sono risolte; nessun modulo runtime è stato dichiarato cancellabile automaticamente.
- **Gate successivo:** Fast CI sulla SHA del batch 2, poi classificazione dei workflow/test rimasti, integrazione Security CI → Draft PR → Human Gate read-only e doppia E2E su SHA post-cleanup.
