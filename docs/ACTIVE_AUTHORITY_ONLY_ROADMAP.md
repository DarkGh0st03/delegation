# Delegation — roadmap operativa (authority-only)

**Aggiornamento:** 8 novembre 2026 · **Branch di sviluppo:** `refactor/post-prof-plan-contracts-20261021` · **GitHub PR:** [#38](https://github.com/DarkGh0st03/delegation/pull/38), Draft e non mergiata.

> Questa pagina è la **fonte operativa sintetica**: obiettivi, stato verificato e lavoro residuo. I resoconti R282–R345 di fase esplorativa sono stati rimossi dal **tree attivo** per ridurne la dimensione; rimangono recuperabili dalla cronologia Git fino alla SHA `8bf19fd59e042b7e4f189f9a543aa8933a169680`. I documenti recenti di architettura e sicurezza restano tracciati. La riduzione del tree **non** riscrive la storia Git né dimostra che le dipendenze legacy siano tutte eliminate.

**Checkpoint R403.1 — 8 novembre 2026.** La [Fast CI R403 #42507357533](https://github.com/DarkGh0st03/delegation/actions/runs/42507357533) ha validato la classificazione di 50 report storici R350–R375 senza riferimenti interni testuali osservati. In un commit successivo di cleanup documentale sono ritirati dal tree 46 resoconti incrementali; sono mantenuti R351.0, R355, R370 e R375 come evidenze architetturali. Tutti i 46 file rimangono recuperabili dal commit `6b84c4bb`; non sono state toccate sorgenti, test, workflow o componenti MCP privati. La Fast CI **post-rimozione** deve ancora essere verificata: nessuna dichiarazione anticipata di gate finale. L'analisi R402 continua a censire 226 indizi di indirezione non risolti, quindi il cleanup runtime resta bloccato fino alla review dei caller.

**Checkpoint R409.3 — 8 novembre 2026.** La [Fast CI #42515924937](https://github.com/DarkGh0st03/delegation/actions/runs/42515924937) è **SUCCESS 2/2** su SHA `c0afc055`. La migrazione R407–R409 ha isolato l'import eseguibile del Runner HTTP storico e portato tre handoff reviewed-DAG più i due loader Owner per Planner/DAG ai core owner-private, mantenendo wrapper compatibili e invariati i guard Root/Gateway/Child/VP/OPA. R385.4 e R385.17 rilevano zero runtime caller dei tre vecchi moduli DAG, ma **non autorizzano cancellazioni** finché restano test, fixture native o consumer esterni/computati non verificati. R410 collega le superfici R407–R409 ai trigger della **Security CI nativa senza AI**, che deve riuscire sulla nuova SHA insieme alla Fast CI prima di considerare conclusa questa tornata. Non eseguire Gemini a pagamento né merge senza consenso.

**Checkpoint R410 confermato — 8 novembre 2026.** [Fast CI #42516352824](https://github.com/DarkGh0st03/delegation/actions/runs/42516352824) **SUCCESS 2/2** e [Security CI #42516352991](https://github.com/DarkGh0st03/delegation/actions/runs/42516352991) **SUCCESS 2/2** sulla medesima SHA `21bd1725`. La Security CI ha attestato Root/Child/VP via Rust diretto, MCP privato, OPA, 10 letture firmate e 10 task di riparazione, Docker FAIL→PASS, researcher acceptance e Draft PR Gitea senza merge. È una prova **scripted**, non inferenza autonoma di Gemini; `paid_model_calls=0`.

**R411 — Verifica wrapper e consumer.** Dal log R410: i tre vecchi moduli DAG hanno **3+2+2 import test/nativetest** e zero caller runtime nel grafo letterale. I due storici HTTP conservano 5+1 riferimenti (inclusi fixture EVM e caller esplicitamente gated). R411 migra anche l'import DAG dell'harness native EVM al vero Owner core e aggiunge test di identità effettiva ESM fra wrapper e core per preservare i consumer diretti. L'inventario resta non esaustivo (`118` indirection irrisolte): **non cancellare** i cinque moduli né i quattro MCP privati. La Fast CI e la Security CI nativa devono essere entrambe SUCCESS sulla nuova SHA R411.

**R411.2 — correzione temporale fail-closed del fixture nativo.** Il primo tentativo Security CI R411 ha bloccato l'emissione dell'ultimo Child: Root 1800 s, retest Child 1500 s lasciavano solo 300 s per 25 task firmati e Docker FAIL; un `run_tests` reale di circa 202 s ha consumato il margine. Il **solo Child finale nel fixture** è ridotto a 900 s; Root, perimetro Ed25519, Gate Rust `Child<=Root`, test negativi e protocollo restano invariati. R411 non si dichiara validato prima di nuova Fast CI + Security CI native sulla stessa SHA.

**Checkpoint R411.2 validato — 8 novembre 2026.** [Fast CI #42519208693](https://github.com/DarkGh0st03/delegation/actions/runs/42519208693) e [Security CI nativa #42519208790](https://github.com/DarkGh0st03/delegation/actions/runs/42519208790) sono **entrambe SUCCESS 2/2** sulla SHA `00ba57c3`. L'ultimo Child del fixture E2E ha validità 900 s sotto Root invariata 1800 s, senza espansione permessi o fallback, con `paid_model_calls=0`. R412 rimuove l'import **statico** di `authority-client.ts` nel modulo Engineer MCP/HTTP storico. Rimangono due import dinamici da fixture selezionate (Engineer e Runner), senza cancellazioni. Le due CI native/fast sulla SHA R412 devono essere ancora validate.

**R413 — Primo ritiro fisico dei wrapper Signed DAG/recovery (8 novembre 2026).**
Dopo R412, tre wrapper senza caller runtime osservati sono ritirati dal tree in un solo commit:
`trusted-reviewed-approved-dag.ts`, `trusted-operational-repair-planner.ts`,
`trusted-repair-dag-controller.ts`. Le implementazioni Owner effettive
(`trusted-owner-reviewed-dag-execution.ts`,
`trusted-owner-repair-planning-core.ts` e
`trusted-owner-repair-dag-execution.ts`) restano intatte. I test diretti
importano i core; R385.4/R385.17 e R6 rifiutano la reintroduzione dei
wrapper o nuovi import/configured caller. La copertura Rust/OPA/Child/VP,
i test negativi, la PR Draft e il divieto di merge/Gemini senza consenso
restano vincolanti. Questo checkpoint va validato con Fast CI e Security CI
nativa sulla **stessa SHA**: nessun PASS viene dichiarato prima del risultato.
Il vecchio transport HTTP e i suoi due caller dinamici gated restano per
il batch Adapter successivo; la migrazione non autorizza cancellazioni di
implementazioni Owner, private crypto MCP o attivazioni a pagamento.

**R413 validato — 8 novembre 2026.** La [Fast CI #42524272610](https://github.com/DarkGh0st03/delegation/actions/runs/42524272610) e la [Security CI nativa #42524272605](https://github.com/DarkGh0st03/delegation/actions/runs/42524272605) sono entrambe **SUCCESS 2/2** sulla stessa SHA `7e60ce948cadb13aa7ded2f6e56bdb315f9687b2`. La rimozione fisica dei tre shim Signed DAG/Planner/repair ha conservato i core Owner, la Rust EVM, le diagnosi firmate e la Draft PR disposable. Le prime due CI fallite durante la migrazione sono state riparate senza reintrodurre gli shim; `main` e' invariato.

**R414 — separazione dei tipi Engineer dall'HTTP legacy.** `trusted-engineer-crypto-port.ts` importa ora `TrustedEngineerCoreConfig` dal contratto neutro e definisce localmente la sola shape HTTP per la fixture: nessun import nemmeno di tipo da `authority-adapter-transport.ts` nel selector canonico. R412 aggiunge il test di assenza, la Security CI nativa osserva ora selector e trasporto storico. Non vengono cancellati i due issuer HTTP: restano 3 test storici + 2 import dinamici protetti e una dipendenza di `authority-adapter-transport.ts` da `authority-client.ts`. La loro rimozione richiede una migrazione attestata del Runner EVM legacy e della fixture Engineer, con conservazione dei test di revoca/permessi, prima di ogni cancellazione. Anche questo batch deve passare Fast + Security CI **sulla propria SHA**, senza Gemini pagato e senza merge.

**R414 validato.** [Fast CI #42526819606](https://github.com/DarkGh0st03/delegation/actions/runs/42526819606) **SUCCESS 2/2**, [Engineer Authority #42526819591](https://github.com/DarkGh0st03/delegation/actions/runs/42526819591) **SUCCESS**, [Security CI #42526819616](https://github.com/DarkGh0st03/delegation/actions/runs/42526819616) **SUCCESS 2/2** sulla SHA `a167f65add65d39f4db02726f4cce0603bceeee4`. Nessuna esecuzione Gemini a pagamento, PR #38 ancora Draft, `main` non mergiato.

**R415 — selettore Engineer nativo senza fallback (8 novembre 2026).**
La firma del selector canonico `createTrustedEngineerCredentialPort` accetta ora soltanto il contratto nativo `TrustedEngineerCoreConfig`. Senza `ENGINEER_CORE_NATIVE_MODE=1` con l'issuer Rust diretto, oppure un socket Rust locale esplicitamente presente, il selector fallisce sempre: né `DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE=1` né un URL Adapter possono abilitarne una scelta HTTP. L'API `createOwnerPrivateMcpEngineerCredentialPort` resta esplicitamente separata e gating-only per le regressioni legacy. I test R385.0/R385.19/R415 controllano questo rifiuto e l'assenza di effetti HTTP. Non sono ancora cancellati `authority-client.ts` o `authority-adapter-transport.ts` perché le fixture Engineer/Runner conservano caller specifici; i gate Fast, Engineer e Security CI **sulla SHA R415** restano obbligatori. Nessuna inferenza pagata, nessun merge.

**R415.1 — chiusura dei caller residui dopo il gate Fast/Engineer.** La prima SHA R415 (`6fb665bf`) ha fatto emergere un'asserzione R240 obsoleta e il cold-recovery fixture R49, che utilizzava ancora il fallback canonico. La correzione conserva la prova R49 spostando la selezione **esplicita** dell'HTTP storico in `strictRecoveringHost` soltanto con `DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE=1` e con tutti i segnali di modalità Rust/authority-only disattivati; per qualsiasi altro contesto la selezione e' nativa e fallisce senza issuer Rust. R385.0 aggiunge il gate negativo contro un bypass accidentale. Il vecchio HTTP non e' stato cancellato e la compatibilita' R49 non e' stata disabilitata. Validazione Fast + Engineer + Security sulla nuova SHA ancora da confermare, zero Gemini e nessun merge.

**R415.1 — gate aggiornato (8 novembre 2026).** [Fast CI #42528225003](https://github.com/DarkGh0st03/delegation/actions/runs/42528225003) **SUCCESS 2/2** e [Authenticated Engineer Approval #42528224982](https://github.com/DarkGh0st03/delegation/actions/runs/42528224982) **SUCCESS** sul commit `004b27c`. [Security CI #42528225000](https://github.com/DarkGh0st03/delegation/actions/runs/42528225000) richiede conferma del job Rust/Gitea/Docker completo prima del gate conclusivo.

**R416 — Cold recovery Engineer nativo senza obbligo di URL Adapter (8 novembre 2026).** La scelta della fixture HTTP resta un opt-in esplicito e precede il controllo della configurazione di recovery. L'URL Adapter e' obbligatorio e validato (HTTPS o loopback HTTP) **solo** per quella fixture; nei profili nativi non e' necessario e non alimenta il selettore canonico, che richiede sempre Rust e fallisce senza socket valido. La lettura della configurazione protetta da file permette l'assenza dell'URL solo come dato opzionale, demandando l'obbligo legacy al recovering host: nessuna operazione Root/revoca diventa implicitamente disponibile. Il regression test in `trusted-engineer-host.test.mjs` controlla l'assenza di chiamate HTTP, il blocco del Root senza socket Rust, il journal immutato e il requisito URL per la fixture; R385.0 protegge il confine source e la Security CI osserva host, loader e test. I moduli HTTP storici rimangono in attesa di audit dei caller e non si eseguono Gemini pagati o merge. Fast, Engineer e Security CI devono essere validate sulla SHA R416, non anticipate.

**R416 verificato — 8 novembre 2026.** [Fast CI #42528828881](https://github.com/DarkGh0st03/delegation/actions/runs/42528828881) **SUCCESS 2/2**, [Engineer Approval #42528828874](https://github.com/DarkGh0st03/delegation/actions/runs/42528828874) **SUCCESS**, [Security CI #42528828922](https://github.com/DarkGh0st03/delegation/actions/runs/42528828922) **SUCCESS 2/2** sulla medesima SHA `8931adb318f7c5e26af73f50005c6b1254d86bfb`. Native Engineer cold recovery non richiede URL Adapter, ma non emette senza Rust; storica fixture HTTP resta gated e validata.

**R417 — selettore canonico completamente separato dal bridge HTTP.** Eliminata la funzione `createOwnerPrivateMcpEngineerCredentialPort` e i relativi import/contratti legacy da `trusted-engineer-crypto-port.ts`. Il modulo canonico esporta soltanto `createTrustedEngineerCredentialPort` su Core Rust diretto/socket, senza import statici, type-only o dinamici della fixture HTTP. I consumer storici legittimi usano la factory gia' presente in `trusted-engineer-legacy-mcp-http-port.ts`: host recovering con import **dinamico solo nel ramo opt-in**, test HTTP espliciti in module alias. I test R240/R3850/R406/R412 verificano indipendenza nativa, fail-closed, import lazy e assenza di fallback; Security CI controlla i file modificati. Non eliminare ancora `authority-client.ts` e `authority-adapter-transport.ts` finche' le fixture Runner EVM/Engineer li richiedono. Fast, Engineer e Security CI **sulla SHA R417** ancora da verificare; no paid Gemini e no merge.

**R417 validato (8 novembre 2026).** Quattro CI gratuite **SUCCESS sulla stessa SHA**
`85d9c0276703c7e1cb5b1bd894bdc6b4f1166133`:
[Fast #42529948702](https://github.com/DarkGh0st03/delegation/actions/runs/42529948702) 2/2,
[Engineer Approval #42529948700](https://github.com/DarkGh0st03/delegation/actions/runs/42529948700),
[Two-Root #42529948630](https://github.com/DarkGh0st03/delegation/actions/runs/42529948630),
[Security Rust/Gitea/Docker #42529948626](https://github.com/DarkGh0st03/delegation/actions/runs/42529948626) 2/2.
Il selector Rust canonico non contiene più il bridge HTTP; le fixture
storiche opt-in rimangono separate.

**R418 — Isolamento test-only degli import HTTP EVM storici (8 novembre 2026).**
Le due fixture non pagate `native-approved-three-adk-evm-e2e.mjs` e
`native-r110-repair-discovery-evm-e2e.mjs` non caricano più
`SoftwareEngineerAuthorityBootstrap` mediante import statico: l'import
e' ora dinamico nel corpo dell'esecuzione, **dopo** il controllo del profilo
`ADAPTER_TRUST_PROFILE=evm` e dei bearer Engineer/Agent. Rimangono
test storici di emissione Root/Child e VP con Adapter, **non** la
rotta canonica authority-only Rust e non una ragione sufficiente a cancellare
`authority-client.ts`. R3850 protegge le due frontiere;
R412 mantiene esattamente due consumer dinamici di runtime già autorizzati
(Engineer fixture e Runner), più le due fixture EVM ora dinamiche,
e respinge la reintroduzione degli import statici. Security CI verifica
anche la sintassi dei due script; la loro esecuzione EVM completa richiede
il relativo setup Anvil/Adapter e **non** viene sostituita dal controllo sintattico.
La revoca, i contratti Ed25519, OPA, Gateway e test E2E nativi restano protetti.
Nessun Gemini a pagamento, nessun merge, nessuna cancellazione prematura:
Fast + Security CI devono avere esito positivo **sulla SHA R418**.

**R418 — validation concluded (8 novembre 2026).**
[Fast CI #42530732152](https://github.com/DarkGh0st03/delegation/actions/runs/42530732152) **SUCCESS 2/2**,
[Native Gateway/Core Rust #42530732240](https://github.com/DarkGh0st03/delegation/actions/runs/42530732240) **SUCCESS**,
[Operation Catalog #42530732179](https://github.com/DarkGh0st03/delegation/actions/runs/42530732179) **SUCCESS**,
[Security CI #42530732233](https://github.com/DarkGh0st03/delegation/actions/runs/42530732233) **SUCCESS 2/2** sulla stessa SHA
`62086567fb58b977e36764ef987064c67025be33`.
Nota di copertura: questi gate non equivalgono alla Full CI manuale EVM/Anvil/Adapter della `cumulative-refactoring-offline.yml`, che resta separata.

**R419 — retirement fisico del transport HTTP duplicato.**
Il solo consumatore eseguibile osservato di
`authority-adapter-transport.ts` era `authority-client.ts`.
Le funzioni originali `postCredential`/`validateCommon`, la forma
`AdapterClientConfig` e tutte le validazioni credential-status/HTTP sono
**consolidate senza riscriverne la semantica** nel client storico
`authority-client.ts`, ora unico modulo per la parte HTTP root issue/revoke.
`authority-adapter-transport.ts` e' cancellato dal tree; R6 e R385.17
provano assenza e zero static/dynamic/configured caller. La fixture MCP
storica importa solo il **tipo** neutrale di configurazione dal client
HTTP, non dal selettore Rust. I test esistenti
`authority-client.test.ts` (grant exact, no escalation, revoca
con ricevuta terminale) rimangono intatti; R3850 registra l'assenza
dello split. Il client HTTP restante conserva due consumer dinamici
Engineer's legacy fixture e historical Runner, piu' due fixture EVM
test-only. Non cancellarlo senza aver sostituito la copertura e
ottenuto Full CI EVM. Non si puo' dichiarare R419 validato prima di
Fast + Security CI sulla nuova SHA; divieto merge e Gemini a pagamento
invariato.

**R419 fully validated — 8 novembre 2026.**
[Fast CI #42533150790](https://github.com/DarkGh0st03/delegation/actions/runs/42533150790) **SUCCESS 2/2** and
[Security CI #42533150792](https://github.com/DarkGh0st03/delegation/actions/runs/42533150792) **SUCCESS 2/2** on the same
`e3990e8c32d8cd9a7d542f2cfeaa9f10b5a20448` SHA.
The former `authority-adapter-transport.ts` is absent; `authority-client.ts`
retains credential status validation, the exact permission response check,
and checked root revocation with all original unit tests. Security CI also
covers the updated R384.9 public-index negative test. No change to `main`,
no paid inference.

**R420 — remove three already-unrunnable paid entrypoint workflows as one batch.**
The following historical launchers are removed from this **feature branch**:
`.github/workflows/gemini-real-gitea-planning-only.yml`,
`.github/workflows/gemini-planner-manual-feasibility.yml`,
`.github/workflows/f1-paid-real-gitea-once.yml`.
Their billable jobs were already unconditional `if: ${{ false }}`; no
working operational or paid execution route is lost. The existing
`trusted-authority-only-legacy-retirement.test.mjs` now fails if any
launcher is reintroduced, and the R6 tracked-reachability inventory keeps
the three as negative retirement targets. The offline Account Suspension
D0 workflow no longer watches the removed Planner YAML. The main
historical `gemini-paid-shared-mcp-final.yml` is intentionally **not**
removed in this batch because multiple current negative safety/regression
tests require its disabled contents; Git history still preserves all
deleted launcher records. Full R420 validation depends on Fast CI and
Security CI on the new SHA; no Gemini, manual human approval bypass, or
merge are authorized.

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
| Test Agent A2A `run_tests` (R395) | [R395 #42494459579](https://github.com/DarkGh0st03/delegation/actions/runs/42494459579): **SUCCESS**; tre Task/Child distinti, A2A FunctionTool, Rust/OPA, Docker project PASS, researcher acceptance PASS e ricevuta autenticata | E2E scripted gratuita, non capacità generativa Gemini né auto-merge |
| Security CI → Human Gate su Gitea reale disposable (R396/R397) | [Fast CI R396.1 #42494655202](https://github.com/DarkGh0st03/delegation/actions/runs/42494655202): SUCCESS; job Gitea reale [R397 #42495864871](https://github.com/DarkGh0st03/delegation/actions/runs/42495864871): **SUCCESS** per PR/stato sulla stessa SHA, identity CI e reviewer distinte, protection e Gate read-only | R397 usa PR fixture e Gateway storico; R399.2 chiude separatamente il collegamento sulla PR **nativa**. Configurazione GitHub reale/revisore umano ancora non attestati |
| Security CI su medesima **Draft PR nativa** (R399.2) | [Fast CI #42498295504](https://github.com/DarkGh0st03/delegation/actions/runs/42498295504) e [Security CI + E2E nativa #42498295569](https://github.com/DarkGh0st03/delegation/actions/runs/42498295569): **SUCCESS 2/2+2/2**, SHA `2b033091`. R385.13 FAIL → 10 diagnosi firmate → 10 CAS → PASS, Draft PR autentica, nuova CI indipendente `pending→success` sulla medesima HEAD, Human Gate **nega** la PR Draft. | Gitea disposable, ADK scripted e CI fixture; non è un'approvazione umana reale. GitHub branch protection e required reviewers non verificabili con le attuali autorizzazioni del connettore (403) |
| R385.19 Rust native completa | [Run #42478904754](https://github.com/DarkGh0st03/delegation/actions/runs/42478904754): SUCCESS sulla SHA `8bf19fd5`; [Fast CI #42478904760](https://github.com/DarkGh0st03/delegation/actions/runs/42478904760): SUCCESS stessa SHA | Nessuna inferenza Gemini reale; è una regressione scripted |
| Security CI positiva | Due job separati: Runner storico e Rust/Child/VP/MCP nativo | Non scambiare il Runner via Gateway HTTP per prova di Child/VP; attestare lo status della **stessa PR prodotta** dal test nativo |
| Human Gate | Regole e test negativi offline; R397 conferma approvazione fixture in Gitea reale; R399.2 conferma **rifiuto di Draft** dopo status CI sulla PR nativa; workflow manuale `workflow_dispatch` | Configurazione effettiva dei required reviewers GitHub (API 403) e approvazione umana reale **non attestati** |
| Pulizia legacy | R385.17/R385.18 inventario per-caller e allowlist, 117 indirezioni runtime irrisolte | Rimuovere fisicamente solo moduli, workflow e test con copertura sostitutiva verificata |

**Checkpoint R404 — 8 novembre 2026.** [Fast CI R404 #42508588421](https://github.com/DarkGh0st03/delegation/actions/runs/42508588421) **SUCCESS 2/2** sulla SHA `1525bc4b`. L'audit dei comandi CI (non delle esecuzioni reali) ha censito 353 file di test: 346 con invocazioni `node --test` configurate, 2 soltanto `node --check`, 5 senza invocazione test osservata. R402/R404 mantengono intatti i dodici gruppi di test di sicurezza; zero gruppi duplicati byte-per-byte. Il prossimo passaggio è analizzare singolarmente i sette candidati residui tramite i riferimenti dei test, gli entry point indiretti e il contratto R385.17, **prima di qualsiasi rimozione di test o script**. Il pilot pagato resta escluso.

**Checkpoint R404.4 — 8 novembre 2026.** [Fast CI #42509494405](https://github.com/DarkGh0st03/delegation/actions/runs/42509494405): **SUCCESS 2/2** sulla SHA `1f1445fe`, inclusi i cinque test offline prima esclusi e la prova Docker gratuita. Il nuovo audit conta **351 test con invocazione configurata su 353**, **due solo sintattici** (`engineer-approval-server.test.mjs` e `trusted-engineer-host.test.mjs`), **zero** file senza invocazione o controllo sintattico e nessun test di sicurezza R402 mancante. **Correzione R405:** i due test Engineer erano già eseguiti nella workflow dedicata (run #42505735385 SUCCESS); l'inventario R404 aveva erroneamente fuso `node --check A && node --test B` in un controllo sintattico. R405 separa i due step e corregge lo scanner, senza duplicare le suite. Nessuna cancellazione di runtime o test; la Security CI nativa sulla SHA finale rimane un gate distinto.

**R405 — Chiarimento dell'evidenza Engineer.** La [run dedicata #42505735385](https://github.com/DarkGh0st03/delegation/actions/runs/42505735385) ha già eseguito con esito positivo le due suite Engineer su una SHA precedente. La Fast CI e la Engineer CI **sul commit R405** devono ancora convalidare lo scanner che separa `&&`, `||` e `;` e i due step esecutivi. La Security CI Rust/Gitea/Docker completa è un gate separato; non eseguire Gemini a pagamento né merge senza consenso.

## Lavoro residuo — ordine di esecuzione

1. **Capacità Test Agent (A — completata e verificata).** R387/R388 hanno chiuso `create_file` nativo, con Agent Card, FunctionTool, A2A, MCP privato, Child Rust, OPA, Gateway e CAS/MAC Gitea, senza scrittura su `main`. R393/R394 hanno aggiunto un Child distinto per `run_tests` e provato il Runner via Gateway con Docker e researcher acceptance. **R395 ha attestato anche `run_tests` tramite FunctionTool A2A** con terzo Child distinto, native Rust, OPA, MAC, Docker PASS e researcher acceptance. Mantenere regressioni e limiti per-Task; nessuna inferenza Gemini reale.
2. **Generalità dell'Execution Loop (B/C — parziale).** R395 conferma i Task sequenziali con Child distinti e completamento indipendente; la generalizzazione dichiarativa è ancora da completare. Rendere dichiarativa la selezione di ruoli/capacità dove possibile: il PoC conserva Backend/Frontend/Test, senza imporli tutti per ogni requisito. Un requisito multi-file usa Task/CAS successive; **l'Engineer firma il solo scope, mai il DAG**.
3. **Security CI → Human Gate (D — E2E completata, deployment reale aperto).** R396/R397 hanno attestato la catena con attori distinti e Gitea reale disposable; **R399.2 ha collegato la Draft PR prodotta dalla E2E nativa allo status della stessa HEAD**, tramite CI indipendente e Human Gate read-only che correttamente rifiuta la PR Draft. Non invocare il vero merge. Verificare con un amministratore required reviewers e protezioni dell'ambiente GitHub.
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
- **Batch 2 (storico):** eliminati **7 workflow nativi di milestone R296/R300/R301/R302-update/R303/R304/R305**, insieme ai **7 payload JSON utilizzati esclusivamente per attivarli**; riduzione **1.288 → 1.274** file e **95 → 88 workflow**; checkpoint **57 → 50**. Questi workflow erano `workflow_dispatch` più `push` filtrato solo sul relativo JSON e non erano workflow riutilizzabili (`workflow_call` assente). Il source di **tutti e 7 i test E2E** che invocavano rimane tracciato.
- **Batch 3 (R398, consolidamento milestone):** eliminati i soli launcher storici R329/R330/R331/R333 (**4 workflow** `workflow_dispatch`/checkpoint-only, nessun `workflow_call`) e i rispettivi **4 payload JSON** di trigger. I quattro sorgenti E2E e tutte le regressioni restano tracciati, come il workflow negativo R338. Inventario tree pre-batch **1.287 file, 93 workflow, 52 checkpoint**; post-batch **1.279 file, 89 workflow, 48 checkpoint**, verificato con [Fast CI #42496716238](https://github.com/DarkGh0st03/delegation/actions/runs/42496716238) e [Security CI + E2E nativa #42496716236](https://github.com/DarkGh0st03/delegation/actions/runs/42496716236): SUCCESS 2/2 ciascuna sulla SHA `1c7d2974`. Non si deduce dall'eliminazione che i caller runtime legacy siano tutti ritirati.
- **Batch 4 (R400, launcher D1 intermedi):** rimozione mirata dei workflow R343/R344/R345 (`workflow_dispatch`/checkpoint-only, **non** `workflow_call`) e dei loro 3 checkpoint; i tre step intermedi restano riproducibili dal source `r333-native-three-role-stage-adk-e2e.mjs`, non cancellato. Tutti gli 89 workflow del tree pre-batch sono stati ispezionati per riferimenti nominali ai launcher: non risultano consumer `uses:` di questi tre. Le E2E più complete R385.13 e R399.2 rimangono attive e restano da rivalidare sulla nuova SHA. Tree **1.280 → 1.274** file, workflow **89 → 86**, checkpoint **48 → 45** attesi dopo il commit. **Nessun modulo runtime o test sorgente eliminato**.
- **Non toccati:** i workflow delle **negazioni specifiche** R292 (Rust/EVM/OPA denial) e R302 Gitea-CAS stale/concurrent writer, la E2E authority-only completa R385.13, la Security CI positiva, il Human Gate, tutti i sorgenti, tutti i test e i 4 moduli MCP crittografici privati.
- **Limiti:** i due batch riducono realmente il tree e non spostano i file in `legacy/`; i contenuti storici sono recuperabili dalla cronologia Git. I **45 checkpoint e 86 workflow previsti post-batch 4 richiedono un audit dei consumer** prima di ulteriori eliminazioni. Le 117 indirezioni runtime e le dipendenze esterne non sono risolte; nessun modulo runtime è stato dichiarato cancellabile automaticamente.
- **Gate successivo:** Fast CI e Security CI positiva + E2E Rust/OPA/A2A/Docker/PR **sulla medesima SHA post-R400**, poi inventario per-caller degli ultimi componenti legacy prima di ogni rimozione runtime.
