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
| R385.19 Rust native completa | [Run #42478904754](https://github.com/DarkGh0st03/delegation/actions/runs/42478904754): SUCCESS sulla SHA `8bf19fd5`; [Fast CI #42478904760](https://github.com/DarkGh0st03/delegation/actions/runs/42478904760): SUCCESS stessa SHA | Nessuna inferenza Gemini reale; è una regressione scripted |
| Security CI positiva | Due job separati: Runner storico e Rust/Child/VP/MCP nativo | Non scambiare il Runner via Gateway HTTP per prova di Child/VP; attestare lo status della **stessa PR prodotta** dal test nativo |
| Human Gate | Regole di merge e test negativi offline, workflow `workflow_dispatch` | Configurazione reale dei required reviewers e collegamento Security CI → PR → verifica merge **non ancora attestati** |
| Pulizia legacy | R385.17/R385.18 inventario per-caller e allowlist, 117 indirezioni runtime irrisolte | Rimuovere fisicamente solo moduli, workflow e test con copertura sostitutiva verificata |

## Lavoro residuo — ordine di esecuzione

1. **Capacità e gestione agenti (A/B/C).** Concordare e implementare il `create_file` del Test Agent **solo** per sorgenti di test, con Root/Child/Gateway, file non esistente e CAS coerenti. Oggi la Card nativa non lo pubblicizza perché l'Owner non lo esegue. Mantenere l'ammissione degli strumenti coerente con Agent Card ed Executor; conservare vincoli per-Task e prove indipendenti.
2. **Generalità dell'Execution Loop (A/C).** Valutare Task multipli e sequenziali senza costringere ogni requisito a un DAG predeterminato. Rendere dichiarativa la selezione dei ruoli/capacità dove possibile; il PoC può usare ancora Backend/Frontend/Test senza obbligarne sempre l'impiego. **L'Engineer firma il solo scope**.
3. **Security CI → Human Gate (D).** Collegare la Draft PR Gitea nativa allo status Security CI **sulla stessa HEAD**, con identità di CI separata e verifica read-only del Human Gate. Non invocare il vero merge. Verificare con un amministratore required reviewers e protezioni dell'ambiente GitHub.
4. **Cleanup effettivo (E).** Il primo batch elimina dal tree 69 report R282–R345 ormai assorbiti nelle E2E successive; mantiene tutti i sorgenti, workflow, checkpoint CI e test. Il seguito deve classificare ciascun runner, workflow e file di test prima di eliminarlo: non basta contare import statici. Rimuovere o migrare `authority-client`, `authority-adapter-transport`, vecchi Signed DAG e script soltanto quando non esistono caller operativi e la copertura negativa è conservata. Non eliminare i quattro moduli `poc/mcp-shared/src/owner-private-*`.
5. **Gate post-cleanup (D/E).** Fast CI, Engineer Authority, Security CI positiva e E2E Rust/OPA/Gitea/MCP/A2A/Docker FAIL→PASS/Draft PR **sulla stessa SHA finale**. Nessuna cancellazione di moduli prima di questi controlli sullo specifico batch.
6. **Pilot generativo (F).** Solo dopo il completamento dei gate e il **consenso esplicito al costo**: provare Google ADK/Gemini reale su Account Suspension, osservando decisioni, read-first repair, Test Agent, token e costo. Non presentare un PASS scripted come generativo.
7. **GUI e flessibilità repository (G).** Ultimo blocco; non deve ritardare il cleanup e la validazione dell'autorità.

## Regole di sicurezza e non-regressione

- **Mai** modificare automaticamente `main`, invocare un merge Gitea/GitHub o introdurre credenziali di merge negli agenti.
- Il Test FAIL resta registrato come errore, **non** Task completato; i Task successivi dipendono solo da completamenti autenticati.
- Il Test Agent nativo non ha `create_file` né Runner in Task di edit finché la capacità non è implementata e attestata; no privilegi per path di Runner, acceptance o traversal.
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
- **Atteso dopo questo batch:** **1.288** file tracciati; i documenti rimossi sono recuperabili attraverso il parent commit. È una **riduzione reale del tree**, non una semplice ricollocazione in `legacy/`.
- La cronologia della PR ha molte commit e resta intatta. Questa operazione non dimostra dead-code reachability, né autorizza la cancellazione dei 57 payload checkpoint, dei 95 workflow o dei moduli di sicurezza senza verifica dei loro consumer.
- **Stato del batch:** nessun sorgente applicativo, script, test, checkpoint CI, workflow o modulo Rust è stato rimosso. Eseguire e registrare Fast CI sulla SHA di questa modifica prima di avviare il batch successivo.
