# Roadmap attiva — Delegation authority-only

Riferimento concordato: audit indipendente del 6 novembre 2026 (baseline R353.7),
riaffermato dall'utente con «Continua il lavoro seguendo questo sempre».
Questa roadmap guida le priorità: la presenza di componenti non dimostra ancora
un comportamento autonomo del sistema.

## Piano attivo — aggiornato all'8 novembre 2026 (R385.3 cleanup legacy in corso)

Questa sezione sostituisce le priorità dei checkpoint R353–R357 riportate sotto
a titolo **storico**, senza cancellare gli esiti di regressione. La nuova
sequenza concordata è **A → B → C → D → E → F → G**.
Per decidere se una fase è conclusa, controllare il codice *collegato*
all'entrypoint definitivo e un'evidenza verificabile, non il numero del commit.

| Fase | Priorità e gate verificabile | Stato |
| --- | --- | --- |
| **A. Autonomia Executor / recovery** | Ispezione read-only prima/dopo errori, Task Backend/Frontend/Test scelti dal modello; recovery multiplo da FAIL applicativi autentici. Errori di autorizzazione o effetti ambigui restano fail-closed | **R384.4 E2E scripted FAIL→CREATE D1→CAS→Docker PASS e Draft PR attestata: esecuzione e sicurezza provate. Autonomia del codice generato da Gemini NON dimostrata. Budget e recovery generale da consolidare.** |
| **B. Confini architetturali** | Child DC + VP attraverso MCP crittografico definitivo; Engineer e Gateway **diretti a Rust**; Agent Card trusted e FunctionTools disaccoppiati dai grant; Planning gerarchico e read composte | **MCP privato Child/VP e Rust attestati; Planning gerarchico e composite read già coperti R380; altri confini Agent Card / FunctionTools ancora da consolidare** |
| **C. Launcher unico** | Engineer permission-only → Planning → root indipendente → branch → ADK/A2A adaptive Executor → Runner → Draft PR, senza fallback Signed DAG | **R382.8 integra provision operativo, worker A2A, CLI locale e handoff firmato: E2E gratuito PASS stessa SHA 63a4414. Rimangono consolidamento, casi generici e cleanup legacy** |
| **D. Validazione gratuita** | Test positivi/negativi e un E2E Rust/EVM/OPA/Gitea/Docker/MCP dopo B e C, sulla stessa SHA del codice finale | **R384.4 native SUCCESS su `81ad3fdd` (run #42423327568); Fast CI SUCCESS sulla SHA successiva `f236a4dd` (run #42423579107). Non sono due gate verdi sulla stessa HEAD. Ripetere validazione completa dopo il cleanup.** |
| **E. Cleanup legacy** | Inventario reachability di codice, workflow, script e import dinamici; migrare gli entrypoint poi rimuovere solo moduli sostituiti; Fast CI mirate + E2E finale **post-cleanup** | **R384.6–R385.3: workflow Gemini storici disabilitati; consumer OIDC HMAC, contratti credenziali e preflight A2A separati dai legacy DAG/HTTP. R385.2 Fast CI PASS `fc182b94` (#42435700888). R385.3 carica il vecchio repair planner solo dopo Test FAIL autentico e il controller solo dopo Gateway epoch ammessa: Fast CI finale da verificare. Audit reachability e native E2E post-cleanup ancora aperti.** |
| **F. Pilot Gemini** | Solo sul launcher authority-only della repository ripulita, con i gate CI sulla SHA finale e consenso **esplicito** ai costi | **Non autorizzato / non avviato** |
| **G. GUI completa** | Repository dinamica, requisito, Engineer review firmata, execution osservabile, Draft PR, merge umano | **Da completare** |

### R385.3 — Repair planner e controller DAG storici non caricati dall'owner all'avvio

Il report [`R3853_OWNER_REPAIR_PLANNER_AND_DAG_LAZY_BOUNDARY.md`](./R3853_OWNER_REPAIR_PLANNER_AND_DAG_LAZY_BOUNDARY.md)
documenta la rimozione degli import runtime del vecchio
`TrustedOperationalRepairPlanner` e di
`executeTrustedAdmittedRepairDag` da
`trusted-owner-operational-repair-handoff.ts`.
Il planner si carica solo dopo **Test FAIL indipendentemente confermato
dal Gateway** e verifica della storia firmata. Il controller DAG si
carica solo quando richiesto esplicitamente dall'owner e **dopo**
`gateway_epoch_admitted`, senza mai attribuire PASS Docker o PR
dal risultato A2A. Ogni `await import()` è seguito dalla verifica
di liveness GitHub (quando disponibile) e dall'identità/digest
della stessa Root Rust originale, prima del successivo effetto.

Fast CI include il test mirato R385.3 e alcune regressioni
R123/R124/R138 su owner, Root revocata, Gitea SHA e scope.
**R385.3 richiede SUCCESS sulla SHA finale** prima di essere
considerato verificato. E2E native Rust/EVM/OPA/Gitea/Docker/MCP
post-cleanup resta obbligatorio; nessuna chiamata Gemini a pagamento.

### R385.2 — Preflight A2A separato e controller DAG storico caricato solo all'attivazione

Il report [`R3852_LEGACY_SIGNED_DAG_LAZY_BOUNDARY.md`](./R3852_LEGACY_SIGNED_DAG_LAZY_BOUNDARY.md)
documenta l'estrazione di `pinTrustedReviewedAgentEndpoints` dal vecchio
DAG in un modulo **puro**. Il controller storico conserva un re-export
compatibile, ma gli handoff GitHub, scripted e fresh repair non lo
importano più al caricamento: invocano un `import()` solo
dopo aver verificato la sessione owner. Ogni import asincrono è seguito
da un nuovo controllo GitHub; nel fresh repair la validazione dei
tre endpoint A2A precede la nuova Root operativa.

Fast CI include nuove regressioni offline su pinning, mancata
attivazione eager, ordine delle verifiche e lifecycle originario
del controller Signed DAG. **R385.2 Fast CI SUCCESS** sulla SHA `fc182b94` (run #42435700888). Moduli DAG e recovery storici
restano presenti per gli importatori diretti: questa non è
un'eliminazione di codice ancora necessario ai test.
L'E2E nativo completo post-cleanup resta obbligatorio prima di
qualsiasi autorizzazione a Gemini a pagamento.

### R385.1 — Guard di sicurezza: vecchio Root MCP/HTTP non utilizzabile sotto authority-only

Il report [`R3851_ENGINEER_LEGACY_HTTP_FAIL_CLOSED_GATE.md`](./R3851_ENGINEER_LEGACY_HTTP_FAIL_CLOSED_GATE.md)
descrive il guard `assertLegacyEngineerHttpFixtureAllowed` che
rifiuta il vecchio percorso HTTP anche a chi importi direttamente il
modulo storico. Un'architettura `authority-only`, una selezione
native Core, un socket Rust definito o il flag native MCP escludono
la fixture HTTP. Il controllo avviene sia alla creazione sia alla
richiesta/effetto di emissione o revoca, per impedire il riutilizzo
dopo una modifica di profilo.

La Fast CI gratuita include test negativi per il bypass e per il
cambio di modalità dopo la costruzione della porta. **R385.1 Fast CI SUCCESS sulla SHA `bcd874b` (run #42434190119)**. Resta la compatibilità
con le fixture storiche non native e non è ancora completato
l'audit degli handoff DAG né l'E2E nativo finale post-cleanup.

### R385.0 — Confine di caricamento: Root Engineer diretto a Rust, legacy MCP/HTTP lazy

Il report [`R3850_ENGINEER_ROOT_DIRECT_RUST_BOUNDARY.md`](./R3850_ENGINEER_ROOT_DIRECT_RUST_BOUNDARY.md)
documenta il modulo separato `trusted-engineer-legacy-mcp-http-port.ts`.
Il selettore originale `trusted-engineer-crypto-port.ts` non importa più
all'avvio il vecchio `SoftwareEngineerAuthorityBootstrap` o il trasporto
MCP in-process; li carica **soltanto durante un'operazione legacy**,
dopo aver selezionato il fallback consentito alle fixture.
La via authority-only `ENGINEER_CORE_NATIVE_MODE=1` continua a usare
direttamente il Node-API del Core Rust e non deve eseguire MCP/HTTP.
Resta la via socket Unix compatibile senza HTTP.
Sono stati aggiunti test per la precedenza, l'assenza di downgrade,
il pinning dei grant attraverso l'import asincrono e il fail-closed.

**R385.0 Fast CI SUCCESS** su `07c97554` (run #42433855451). Restano ulteriori
migrazioni handoff legacy e native E2E finale post-cleanup sulla SHA
definitiva. Nessuna chiamata Gemini a pagamento e nessun merge.

### R384.9 — Contratti di credenziale neutrali, vecchio HTTP Adapter non pubblico

Il rapporto [`R3849_LEGACY_ADAPTER_PUBLIC_API_ISOLATION.md`](./R3849_LEGACY_ADAPTER_PUBLIC_API_ISOLATION.md)
documenta il nuovo modulo `trusted-credential-contracts.ts` con tipi
senza richieste HTTP né dipendenze dall'Adapter. Il public index
`@thesis/orchestrator-runtime` esporta solo i tipi e **non più**
`SoftwareEngineerAuthorityBootstrap`. Il client storico sopravvive
solo come import diretto con regressioni di emissione limitata e
revoca: `authority-adapter-transport.ts` usa ora direttamente i tipi
neutrali, senza riferimento ciclico al client.

Fast CI comprende ora i test espliciti del vecchio client e un vincolo
statico sull'API. L'inventario R6 registra i suoi importatori diretti.
**R384.9 Fast CI SUCCESS `0de6c3c` (run #42432179360).**
Resta il lavoro di reachability sui caller dei handoff/recovery storici.
E2E completo post-cleanup obbligatorio prima di qualunque pilot Gemini.
Nessun costo Gemini né merge.

### R384.8 — Scissione API OIDC dal DAG legacy (cleanup in corso)

Il report [`R3848_OIDC_ADMISSION_API_ISOLATION.md`](./R3848_OIDC_ADMISSION_API_ISOLATION.md)
documenta lo spostamento del consumer HMAC one-shot in
`trusted-github-admission-consumer.ts`.
L'indice pubblico `@thesis/orchestrator-runtime` non espone piu'
l'handoff `startAdmittedGithubReviewedGeminiHandoff` del vecchio DAG:
esporta il solo consumo OIDC e i tipi associati dal modulo autonomo.
Il vecchio handoff diretto preserva la compatibilita' dei test storici,
ma non viene piu' caricato **attraverso questa re-export dell'index**.

Il contract HMAC, la verifica dei pin e l'unicita' di consumo non
sono stati indeboliti. Fast CI include ora test specifici per il
nuovo isolamento e per il consumo one-shot. **R384.8 ha Fast CI SUCCESS su `f3eaa683` (run #42430511297).** Restano da
migrare/ritirare i consumer legacy diretti, il trasporto Adapter
esportato tramite authority-client e altri workflow gratuiti storici.
Il native E2E completo post-cleanup e' ancora obbligatorio.

### R384.7 — Workflow storici e importer graph R6 (cleanup, ancora aperto)

Il report [`R3847_LEGACY_REACHABILITY_AND_RETIREMENT.md`](./R3847_LEGACY_REACHABILITY_AND_RETIREMENT.md)
registra la reachability sorgente degli importatori. Oltre ai due job
D0/F1 archiviati in R384.6 sono disabilitati anche il job real-planner
di `gemini-real-gitea-planning-only.yml` e l'unico job di
`gemini-planner-manual-feasibility.yml`: nessun percorso di questi
workflow storici e' piu' utilizzabile per inferenza Gemini.
La Fast CI gratuita
[run #42428657867](https://github.com/DarkGh0st03/delegation/actions/runs/42428657867)
e' **SUCCESS** su `311cda3387b7cffa652b33bfc46b2bdcc92b326e`.

L'inventario R6 ha rivelato importatori **source** del vecchio
`trusted-reviewed-approved-dag.ts`, del planner/controller di recovery
e del trasporto Adapter. In particolare, `authority-client.ts`
continua a usare `authority-adapter-transport.ts`, ed e' riesportato
dall'API pubblica del runtime. Pertanto una rimozione indiscriminata
romperebbe dipendenze ancora presenti.
Sono stati aggiunti controlli di regressione per vietare nuovi import
**diretti** legacy negli entrypoint authority-only critici: non sono
ancora un audit transitivo completo di package export e import dinamici.

**Prossimo gate:** migrare gli handoff storici ancora raggiungibili,
consolidare i workflow gratuiti, quindi ripetere Fast CI e un E2E
nativo completo post-cleanup sulla **stessa SHA**. PR #38 Draft,
`main` invariato; nessun Gemini a pagamento.

### R384.6 — Ritiro del vecchio Signed DAG billable (cleanup fase E, in corso)

L'inventario e la motivazione sono in
[`R3846_LEGACY_RETIREMENT_REGISTER.md`](./R3846_LEGACY_RETIREMENT_REGISTER.md).
Il vecchio launcher `startProtectedGeminiOwnerSession` è conservato
come API di compatibilità **solo-deny**; l'eseguibile canonico rifiuta
esplicitamente `legacy-signed-dag` senza fallback.
Nel workflow storico `gemini-paid-shared-mcp-final.yml` sono stati
disabilitati **entrambi** i job potenzialmente fatturabili, compreso
il Planning-only, mediante `if: ${{ false }}`.
Nuovi test offline verificano tali confini e vengono eseguiti da Fast CI.

**Gate R384.6 superato:** Fast CI #42427419495 SUCCESS su `c67233f2`;
non considerare il cleanup concluso: la reachability dei moduli
DAG/recovery storici e il consolidamento dei 91 workflow sono ancora da
completare. Core Rust, MCP crittografico, approvazione Ed25519, OPA,
CAS, MAC, Runner e Draft PR restano invarianti e NON devono essere
rimossi per mera somiglianza del nome.
Nessun Gemini a pagamento e nessun merge.

### R384.5 — Budget owner-only per Execution e recovery (8 novembre 2026; CI da verificare)

L'originale launcher authority-only supporta, nel **manifest privato 0600**
(e mai da modello, A2A, HTTP o MCP), l'oggetto opzionale
`executionBudget: {"maxDecisions":N,"maxVerifiedFailures":M}`.
Senza override, le decisioni sono limitate agli indici Child disponibili
e i FAIL verificati ammessi restano al massimo due (o meno se mancano Child).
Il budget esplicito ammette da 1 a 24 decisioni, mai superiori agli indici
Child effettivamente pre-riservati, e da 0 a 4 FAIL indipendentemente
verificati, senza superare il numero di decisioni. La stessa soglia
è applicata nel Review Host originale e nel Proposer ADK.

Una failure non diventa un Task completato; solo receipt autenticati e
Runner indipendente possono autorizzare un nuovo turno diagnostico.
Permangono il contenimento dentro Root Engineer, il controllo OPA/VP,
la policy fail-closed per provider write ambigue, il Test PASS sulla HEAD
corrente e l'obbligo di approvazione prima di spese Gemini.

Aggiunti test offline per tre FAIL verificati e retest conclusivo,
venti modifiche multi-Task con Test finale, limiti invalidi e default.
**Fast CI R384.5 e Authenticated Engineer Approval sono PASS sulla SHA `bf663547`**; sono test scripted, non un E2E generativo. Nessun E2E finale post-cleanup né pilot Gemini autorizzato.

### R384.4 — Esito nativo funzionale acquisito (8 novembre 2026; NO Gemini)

**Checkpoint di esecuzione scripted, non prova di autonomia generativa.**
Il workflow [R384.4 native #42423327568](https://github.com/DarkGh0st03/delegation/actions/runs/42423327568)
ha **conclusion: success** sulla SHA
`81ad3fdd2efa2426a507c6b1ff38286764e5a3b0`.
L'evidenza strutturata del checkpoint
`.github/ci-checkpoints/r3844-functional-create-d1-pass-request.json`
attesta un percorso offline con Root Engineer nuovamente firmata e limitata
ai file necessari, Backend/Frontend iniziali, Test Docker con FAIL autentico,
CREATE Backend D1, Task distinti di correzione con CAS,
nuovo Docker/acceptance PASS sulla HEAD corrente e Draft PR attestata
senza merge. Il codice correttivo è **scripted reference/fixture** e non
è stato scritto autonomamente da Gemini; `paid_model_calls=0`.

Secondo il report tecnico R384.4 risultano 15 Child Rust/MCP,
12 CAS, una CREATE D1, 17 Task registrati (16 completati) e
due chiamate al Runner. Le prove del Runner devono restare legate
alla SHA effettivamente testata e verificabili indipendentemente.

La [Fast CI #42423579107](https://github.com/DarkGh0st03/delegation/actions/runs/42423579107)
è **success** sulla HEAD successiva
`f236a4dd55a3525a9fd7d0df4cc612a423b32cea`.
**Non dichiarare** un gate E2E + Fast CI sulla stessa HEAD:
il native PASS appartiene a `81ad3fdd`, la Fast CI a `f236a4dd`.
Una nuova verifica sulla SHA finale sarà necessaria **dopo il cleanup**.

**Priorità operative successive (senza chiamate Gemini a pagamento):**
1. Consolidare la decisione adattiva e le prove di recovery senza introdurre
   repair hardcoded. I limiti del Work Loop sono `maxSteps<=16`,
   history di FAIL fino a 2 e osservazioni sorgente fino a 4:
   valutare budget configurabili **solo dal trusted owner**, preservando
   fail-closed per errori ambigui, revoca e permission insufficiente.
2. Confermare un singolo launcher authority-only, MCP nativo, card e
   FunctionTools, senza fallback al Signed DAG operativo.
3. Inventariare import statici/dinamici, workflow e test legacy;
   eliminare gradualmente solo ciò che non protegge più contratti attivi.
4. Validare dopo il cleanup Fast CI, security regressions ed E2E
   nativo sulla **medesima SHA**. Solo allora valutare il pilot
   generativo **previo consenso esplicito ai costi**.
5. GUI/dimostratore dopo il pilot; mantenere la PR #38 Draft e
   `main` invariato.

### R384.4 — Copertura minima della Root per un PASS funzionale (audit offline, NON autorizzante)

**Evidenza di partenza:** R384.3 native E2E
https://github.com/DarkGh0st03/delegation/actions/runs/42421634065
e Fast CI
https://github.com/DarkGh0st03/delegation/actions/runs/42421634061
sono entrambi SUCCESS sulla SHA `8edd5afec4a25b783f5692397454403fedfa0e5a`.
Cinque Child Rust/MCP, due CAS UPDATE, una CREATE D1,
due FAIL Runner autenticati, zero legacy e `main` invariato.
La seconda failure è attesa: **non esiste ancora un PASS di accettazione
per quel percorso di recovery**.

`scripts/r3844-functional-recovery-coverage.mjs` è un audit di
**proprietà del Test Runner e non accessibile al modello**: confronta
soltanto nel test-owner la baseline Account Suspension con la reference
già validata, e restituisce SOLO i nomi dei file e le coppie permission
mancanti; **mai** contenuti di riferimento o credenziali.
`tests/e2e/account-suspension.spec.ts` è escluso esplicitamente
perché appartiene ai controlli researcher/Runner e non deve essere
scritto da un agente. Il controllo richiede per ogni file esistente
cambiato le coppie `read_file` e `update_file`, e per un nuovo
file approvato la sola `create_file`, usando la stessa semantica
conservativa di containment dei contratti Gitea.

La Root concreta dell'E2E R384.3 autorizza solo due file
Backend/Frontend in UPDATE, più una CREATE su un file distinto:
**non copre** le altre modifiche richieste dal percorso
funzionale di riferimento R375. Il recupero non deve
inferire automaticamente un'estensione di scope dopo il FAIL.
Una nuova Root Engineer autonoma **e separatamente firmata**,
come nel test R375, può coprire le altre operazioni,
ma nessuna prova positiva del solo audit autorizza scritture,
sostituisce Rust/OPA o attesta un PASS.
Le regressioni gratuite testano insufficienza della Root R384.3,
copertura completa della Root reference R375, branch/ruoli errati
e isolamento dell'accettazione researcher.
Fast CI sulla SHA definitiva da verificare.

**Passo successivo:** test nativo disposable R384.4 con una **nuova**
Root Engineer firmata per gli esatti file necessari,
Task/Child distinti per ogni modifica, recovery dopo
FAIL autentico, nuovo Runner su HEAD corrente
con researcher acceptance **PASS**, e infine solo Draft PR
verificata indipendentemente. Non confondere questo
scripted reference test con generazione autonoma Gemini:
il pilot a pagamento richiede consenso esplicito.

### R384.3 — Incremento 1: CREATE come Task adattivo e candidato D1 (preflight only)

L'evidenza R384.2 su SHA `fcfcc67635684462b21f9e2364e9a875679b3ea5`
è disponibile nelle run:
- https://github.com/DarkGh0st03/delegation/actions/runs/42417275100
- https://github.com/DarkGh0st03/delegation/actions/runs/42417275078

Il log nativo conferma un'unica chiamata atomica Gitea
`gateway_atomic_create_calls=1`, `legacy_writes=0`,
`real_opa=true`, `independently_verified_rust_evm=true`,
`remote_a2a_transport=true`, `task_local_crypto_mcp=true`,
`independent_create_receipt_attested=true`,
`task_finalized=true`, `revoked_root_denied=true`,
`paid_model_calls=0`. Non dimostra ancora recovery multi-Task.

R384.3 elimina un blocco ormai obsoleto nel
`TrustedAuthorityOnlyAdkDecisionProposer` che vietava al
modello ogni `create_file` in modalità adattiva. Il nuovo
Task deve avere una **sola** permission `create_file`,
presentarsi come Backend/Frontend e rientrare sia nella
Agent Card sia nella Root firmata; niente create+read,
create+update, due create, Runner o Test come side effect
accorpato. L'effettiva assenza alla HEAD, Child nativo,
Prepare, MAC e completamento sono verificati altrove dal
Gateway originale, non dalla decisione ADK.

La `preflightNativeD1FailureCandidate` applica gli stessi
limiti a una proposta di primo recovery dopo **Runner FAIL
autenticato e indipendente**: richiede l'operazione create
firmata nell'Engineer Root originale, file/branch canonici,
un solo effetto e ruolo Backend/Frontend. La prova FAIL
è ricalcolata contro il Child, Gateway flight, receipt HMAC
e HEAD originale. La preflight di per sé **non**
crea un file, un Child, un Task o una prova di PASS.
`admitFirstNativeD1RepairTask` continua ad esigere un
marker persistente `O_EXCL` prima della registrazione
del nuovo Task D1 e non amplia i permessi.

Regressioni gratuite aggiunte per CREATE→Test→readiness
con progresso owner simulato, tentativi illegittimi
prima del dispatch, FAIL autentico/forgiato, root
estranea, scope non canonico, operazioni multiple
e ammissione monouso del nuovo Task. Fast CI della
SHA finale da verificare prima di segnare PASS.

**Ancora aperto in R384.3:** integrare un caso reale
multi-Task Backend/Frontend/Test con FAIL applicativo
del Runner, scelta D1 del modello, Child/VP nuovo
su Root originale, eventuale CREATE eseguito con
CAS/MAC reale, Test nuovo su HEAD corretta e
attestazione indipendente. Nessuna chiamata Gemini
pagata senza consenso, nessun merge, `main` invariato.

### R384.1 — FunctionTool CREATE owner-verified e ADK/MCP controllati

**Evidenza precedente:** R384.0 native Rust/EVM/OPA/Gitea
`create_file` PASS su SHA `f2b4fead`, run
https://github.com/DarkGh0st03/delegation/actions/runs/42412181760;
`provider_calls=1`, `legacy_writes=0`,
`completion_attested=true`, `revoked_root_denied=true`,
`concurrent_head_race_denied=true`, `paid_model_calls=0`.
Il test native è stato eseguito nel Gitea temporaneo con
Engineer Root/Child veri; NON comprende il modello ADK o il trasporto
A2A completo.

`GatewayControlledToolClient.invoke("create_file")` è ora
ammesso per Backend e Frontend SOLO se l'agent ha ricevuto
il port privato `stagedTool:"create_file"` dal registro HMAC
con Task/Child/ruolo/file approvati, modalità
`DELEGATION_GATEWAY_ARCHITECTURE=authority-only`,
`APPROVED_RUNNER_NATIVE_MCP=1`, e presenter crittografico
Task-local MCP già installato. Se manca anche una sola condizione,
si rifiuta la richiesta **prima di Prepare e di qualunque provider
write**. Il CREATE-only Task non può invocare in alternativa
read, update o run_tests. Dopo `Prepare`, il client attende
la prenotazione monouso `stage` prima di emettere il VP,
quindi invoca soltanto il Gateway `Execute`. Il risultato deve
contenere l'esatto `request_id`/ALLOW, provider Gitea,
`tool=create_file`, branch/path originari, `revision=commit_sha`,
`blob_sha` e SHA a 40 caratteri. Campi non documentati
sono rifiutati e non finiscono nell'output del modello.
Una risposta HTTP 200 non completa il Task autonomamente:
l'originale owner attestato deve **ancora** controllare
il MAC, l'assenza sul parent, HEAD e la flight nativa
attraverso la propria completion path.

Test gratuiti mirati:
- Gateway client: ordine Prepare → stage owner → VP privato →
  Execute, Test/role/Tool non autorizzati, no MCP, permessi
  mancanti, contenuto CAS falso o campo segreto extra, replay.
- Integrazione vera `@google/adk` con modello scripted
  offline, registro Task A2A, `PrivateMcpTaskRegistry`,
  `LocalCryptoMcpBridge` e Gateway controllato;
  il solo servizio Rust crypto è simulato esplicitamente.
  Il modello non riceve credenziali, VP o request_id.
  Nessuna chiamata Gemini/API, nessuna scrittura del provider.

**Gate aperto prima di dichiarare A completata:**
ricollegare e verificare il **trasporto A2A vero con un
owner/agent IPC HMAC e Gateway Rust/EVM/OPA/Gitea reali nella
medesima esecuzione**, oltre al completamento indipendente.
Occorrono successivamente prove gratuite multi-task e
recovery su FAIL applicativi, cleanup legacy e un pilot Gemini
**solo dietro consenso esplicito**. PR #38 resta Draft, main
immutato. La Fast CI sulla SHA finale R384.1 resta da verificare.

### R383.9 — Owner deployment CREATE opt-in, receipt distinta, original Review Host

Il modulo `trusted-authority-only-native-create-effects.mjs`
assembla `TrustedAuthorityOnlyGiteaCreatePreflight`, journal
CREATE, `TrustedAuthorityOnlyGiteaCreateExecutor`, publisher e
observer MAC con stesso Gateway owner, repository/branch, writer Gitea
e read-only client indipendente. **La costruzione non emette una
chiamata al provider e non abilita il modello**.

Il bootstrap originale accetta 7 directory soltanto se entrambe le
nuove `createIntent` e `createReceipts` sono presenti, distinte dalle
5 vecchie; devono essere directory pre-provisioned, owner-only,
`0700`, senza symlink. Qualsiasi configurazione parziale o con
permessi impropri fallisce prima della Root operativa. Il
`canonical-owner-deployment.mjs` richiede **opt-in esplicito**
`enableNativeCreateFile:true` nel manifest 0600 e usa directory
`<directory>/createIntent` e `<directory>/createReceipts`.
Se il campo manca, il codice nuovo rimane disabilitato.

L'Original Review Host ammette la coppia create preflight/observer
solo se corrisponde all'originale Gateway, Task, owner Gitea,
repository e branch. Dopo l'enrollment del Child può costruire
`TrustedAuthorityOnlyCreateEffectStager` con HEAD stabilita
dall'owner; non acquisisce source, signer, grant o path da una
richiesta A2A. Il risultato di una CREATE può essere osservato
**solo** da `AuthenticatedGiteaCreateCompletionObserver`,
che verifica il receipt MAC con precedente file assente: la
precedente associazione al mutation UPDATE observer viene rimossa.
L'adaptive loop non può completare un Task sulla base di un
report A2A non autenticato.

Nuove regressioni gratuite verificano l'assembler senza I/O,
il rifiuto di writer/reader non indipendenti e repository errate,
la mancanza di intent originale, le directory incomplete/condivise
o `0755`. Fast CI della SHA finale da confermare per R383.9.

**Gate aperto:** non è ancora stata eseguita una vera CREATE
su Gitea con VP Rust/EVM e OPA reali. Il FunctionTool
`GatewayControlledToolClient.invoke("create_file")` continua a
rispondere DENY. Prima di abilitarlo occorre una prova end-to-end
gratuita con Root/Child veri, branch HEAD/assenza e race/revoca,
receipt indipendente, completamento Task e recovery fail-closed.
Per aprire l'opt-in reale vanno precreate entrambe le directory
su un owner host già autorizzato; nessuna credenziale, chiave
o permesso deve essere aggiunto da un model tool. Non eseguire
un pilot Gemini a pagamento senza consenso esplicito.
La PR resta Draft e `main` non viene toccato.

### R383.8 — Preflight CREATE e flight monouso nel binding owner/A2A (NO-WRITE)

`TrustedAuthorityOnlyCreateEffectStager` è il nuovo port concreto
owner-private collegato allo stesso `InMemoryRequestStore`,
`TrustedAuthorityOnlyGatewayAdmissions`,
`TrustedAuthorityOnlyGiteaCreatePreflight` e `GiteaClient`
originali. Riceve soltanto un request ID da IPC: il suo
`planTaskId`, `runtimeTaskId`, HEAD, repository e branch
sono vincoli fissati in costruzione dall'owner. Prima di una
chiamata Gitea GET o a un journal brucia lo slot in memoria,
verifica Prepare non consumato, crea l'intent persistente
`create_file` (assenza esatta al pinned HEAD) e riserva
`stageTrustedTaskFlight` del Child originale. Un errore o
un tentativo ambiguo è terminale, senza retry e senza
prenotare `create-attempt` o fare provider write.

L'owner `TrustedAuthorityOnlyRemoteEffectOwner` riconosce
soltanto una singola permission esatta `create_file` per
Backend/Frontend, ne decodifica il file canonico, confronta
Coordinator, Child, Gateway, repository e branch e richiede
lo stager originale con brand privato. Impedisce che una
capability CREATE sostituisca un Task UPDATE o di Test.
Il registro `TrustedEffectStagingTaskRegistry` e l'IPC
HMAC accettano il pin `create_file` solo con percorso,
ruolo e Task firmati; l'ack IPC non vale come permesso di
scrittura. Sono state aggiunte regressioni per Task,
HEAD, owner, stager contraffatti, Gitea 503, doppio
tentativo e bind di Test.

**Confine deliberato:** il client `GatewayControlledToolClient`
continua a **negare sempre** `create_file` in modalità
authority-only. La presenza del pin privato non attiva il
FunctionTool e non attesta una scrittura. Prima di aprire
l'effetto modello servono bootstrap reale dell'owner,
evidenza nativa Rust/EVM/OPA/Gitea, prove HEAD/race/revoca
e completion A2A indipendente. Aggiornare la Fast CI della
SHA finale; nessuna AI a pagamento o merge.

### R383.7 — Dispatch CREATE_FILE nel Gateway canonico con native guard

Il `executeAuthorization` ha un ramo dedicato `create_file`,
distinto dal writer Gitea legacy: è raggiungibile solo con
`authorityOnlyCreateEnabled:true`, stesso originale
`TrustedAuthorityOnlyGiteaCreateExecutor` e
`TrustedAuthorityOnlyGatewayAdmissions`, role Backend/Frontend,
`DirectCoreRustVerifier`, `OpaPolicyClient` e `GiteaExecutor`
concreti, senza `approvedPlans` o `planningRevisions` legacy.
Dopo la VP Rust e la decisione OPA allow viene riesaminata la
flight Task/Child firmata. L'executor viene chiamato mediante
il metodo originale della classe: l'implementazione conserva
`reserveAttempt`, CAS e doppia receipt MAC già introdotti in
R383.6. Il risultato `create_file` può passare la provenance
check finale solo nello stesso ramo opt-in, senza fallback legacy.

Il `GatewayRuntime` accetta una coppia coerente
`authorityOnlyCreateEnabled` / `authorityOnlyCreateExecutor`,
verifica l'identità owner e inoltra i riferimenti privati
all'esecuzione. `createTrustedAuthorityOnlyGatewayServer`
riceve facoltativamente `owner.createExecutor`: se assente
la create rimane negata, se presente deve appartenere alle
stesse Admissions già attive. L'owner HTTP non accetta
signer né queste capabilities da una route pubblica.

Test offline aggiunti: dispatch con vere classi wrapper
`DirectCoreRustVerifier` / `OpaPolicyClient` ma
risposte simulated, deny Rust, deny OPA, owner estraneo,
opt-in mancante, verifier e policy generici falsificati,
controllo della singola execution e zero legacy Gitea call.
Questo non è una prova crittografica Rust/EVM reale.
Le nuove verifiche restano in Fast CI gratuita; un PASS
sulla **SHA finale** è necessario prima di considerare
R383.7 validato.

**Ancora aperto:** l'owner operativo deve assemblare una
istanza `createExecutor` a partire da manifest privato 0600,
con staged preflight + flight originale prima di esporre
la capability agli agenti. Servono nuovi E2E nativi gratuiti
Rust/OPA/Gitea (incluso revoca/HEAD race) e un percorso di
completion A2A attestato, prima di abilitare il Tool Gemini.
Nessuna chiamata AI a pagamento e nessun merge.

### R383.6 — Executor CREATE CAS e ricevuta MAC indipendente (non attivato)

Nuovo `TrustedAuthorityOnlyGiteaCreateExecutor` owner-private, costruito
con il medesimo Gateway Admissions, preflight R383.5, GiteaClient
pinned, journal R383.4 e due porte indipendenti di evidence.
Non ammette client Gitea di una repository differente, un host
senza originale Task/Child o un observer che condivide l'istanza
writer. L'esecuzione richiede `PreparedRequestRecord` consumato,
`VerifiedDelegation` Rust nativa, OPA `allow` originale, flight
durable e intent preflight identico per Task, Child, Root, branch,
path, HEAD e SHA-256 del contenuto.

Il journal `reserveAttempt` O_EXCL/fsync deve completare PRIMA di
qualsiasi I/O Gitea. L'executor invoca solo
`GiteaClient.createFileWithHeadCas`: branch staging privata da
HEAD esatta, assenza verificata, commit parent unico e CAS
`old_commit_id -> new_commit_id` con `force:false`.
Risposte perse, CAS conflict, fallimenti I/O o crash sono
terminali per quel Task: nessun retry.

`TrustedGatewayGiteaCreateEvidencePublisher` usa un **diverso**
GiteaClient read-only per verificare HEAD, singolo parent,
assenza del vecchio path sulla SHA originale e contenuto/blob
nuovo; soltanto dopo scrive un receipt `0600` con HMAC-SHA256.
`AuthenticatedGiteaCreateCompletionObserver` riapre il receipt,
valida firma MAC e contesto del Task, poi ripete indipendentemente
la stessa osservazione Gitea e restituisce il digest di evidenza.
Solo allora il journal registra la prova di completamento con
marker O_EXCL/fsync. I marker di intent e attempt restano
distinti dalla receipt.

Sono stati aggiunti test gratuiti per MAC tampering, parent
falsificato, HEAD mutata, file precedentemente esistente,
contenuto alterato, CAS ambiguo, doppio tentativo e assenza
di fallback sul provider legacy. La suite evidence usa il
vero verificatore read-only `GiteaClient.verifyCreatedFileHeadCas`;
l'executor viene testato con Rust/OPA e trasporto mutativo
**simulati**, quindi non è prova nativa end-to-end.
I nuovi test sono collegati alla Fast CI; verificare il
risultato sulla SHA definitiva prima di dichiarare PASS.

**Limite operativo essenziale:** `executeAuthorization`, il
Gateway owner deployment e gli Agent FunctionTools NON
selezionano ancora questo nuovo executor. Il percorso
`create_file` del runtime resta fail-closed, senza nuove
scritture né cambi di permessi. Il prossimo gate deve abilitare
l'executor **solo** nel ramo `DirectCoreRustVerifier` +
`OpaPolicyClient` + `TrustedAuthorityOnlyGatewayAdmissions`
originali e aggiornare il trusted owner staging. Segue una prova
nativa Rust/EVM/OPA/Gitea e controlli di revoca/race, prima di
sbloccare il Tool agente, cleanup e pilot Gemini. Nessun modello
a pagamento, merge o modifica a main.

### R383.5 — Bound Create admission post-VP/OPA (NO-WRITE)

Nel registro originale `TrustedAuthorityOnlyGatewayAdmissions` è
presente `assertTrustedCreateNativeAdmissionBinding(record,verified)`:
per il solo `create_file` richiede Task Backend/Frontend con una sola
permission exact-file, original Prepare già consumato, Child nativa
enrolled e firmata, Root attiva, DID, epoch e flight Task durable
corrispondenti. Verifica il presenter, credential, Root e profondità
non-zero della VP native e impone **un'unica permission verificata**
esattamente uguale a quella del Task, senza estendere lo scope.

Il `TrustedAuthorityOnlyGiteaCreatePreflight` dispone ora di
`assertNativeCreateAdmissionAfterVerification(record,verified,policy)`,
che ricontrolla l'intent `0600` già riservato (path, branch,
content SHA-256/bytes, HEAD, Task/Child, fingerprint) dopo OPA allow
e produce solo `provider_write_authorized:false`.
Sono stati aggiunti test offline positivi/negativi con admission
controllata, tampering dell'intent, deny OPA, stato request consumed
e un test di `executeAuthorization` che garantisce **zero chiamate al
legacy Gitea executor** perfino quando i mock VP e OPA consentono
`create_file`.

**Confine NON superato:** questi metodi non sono ancora invocati
dal Gateway native execute nel ramo abilitato `create_file`;
i risultati VP/OPA dei test sono mock, non Rust/EVM/OPA reali.
La chiamata di esecuzione per `create_file` rimane fail-closed
anche dopo un VP valido, e nessun Task viene completato.
Non dichiarare PASS prima di osservare Fast CI sul commit finale
di questo checkpoint. Nessuna API Gemini a pagamento.

**Prossimo confine R383.6:** integrare un executor owner-private
con `createFileWithHeadCas` e marker attempt R383.4, solamente
dopo native Rust VP/OPA + binding R383.5. Prima di abilitarlo,
progettare una receipt MAC indipendente con prova dell'assenza
del vecchio file, commit parent, HEAD, blob e byte nuovi; negare
risposte ambigue senza retry. Poi cablare il Gateway e test
E2E nativi gratuiti, senza toccare main.

### R383.4 — Marker durevole di esecuzione single-attempt (NO-WRITE)

Il journal owner-private originale `DurableAuthorityOnlyGiteaCreateIntentJournal`
dispone ora di `reserveAttempt(intent)`, con un file
`*.create-attempt.json` distinto dalla preflight `*.create-intent.json`.
Prima del marker richiede l'intent originale già persistito e identico,
con Child/Task/request fingerprint/HEAD/contenuto invariati.
Il marker nasce con `O_CREAT|O_EXCL|O_NOFOLLOW`, permessi `0600`,
proprietario originale, `fsync` del file e della directory `0700`.
Reinvocazioni in-process, concorrenti o dopo un riavvio falliscono:
un effetto ambiguo non può essere ritentato. Il record preserva
`provider_write_authorized:false`.

Sono state aggiunte tre regressioni gratuite per marker valido,
replay dopo restart, due journal concorrenti e preflight senza 404
attendibile. **Il nuovo marker non è collegato al vero
`executeAuthorization`**: non autorizza una POST Gitea, non attesta
Rust VP/OPA e non completa un Task. `create_file` resta vietato
dall'Executor authority-only. Verificare Fast CI della SHA R383.4
prima di considerare superato questo checkpoint.

**Prossimo confine:** dopo VP Rust nativa e decisione OPA reale,
l'originale Gateway deve attestare il `PreparedRequestRecord` già
consumato e la stessa flight Task/Child persistita, usare il marker
single-attempt e soltanto allora chiamare il writer Gitea
`createFileWithHeadCas`. Servono receipt MAC/observer indipendenti,
riconciliazione fail-closed e test negativi prima del FunctionTool.
Nessuna chiamata AI a pagamento, nessun Full E2E avviato, PR Draft.

### R383.3 — Create intent durable, signed Task binding e preflight senza provider write

Il Gateway originale ora dispone del metodo **owner-private**
`assertTrustedGiteaCreateIntentBinding(record)`: accetta soltanto un
Prepare originale, **non consumato**, per `create_file`, con stesso
session/grant digest, DID Backend o Frontend, Root Engineer valida,
Child DC nativa iscritta, dipendenze Task completate, Task a
**una permission esatta create_file** e fingerprint immutabile.
Rifiuta il Test Agent per questo primo scope, i grant aggiuntivi,
i Task già completati/in flight e le scadenze. Il metodo resta
di **sola lettura**: non verifica una VP Rust esecutiva, non
interroga OPA e non dichiara il Gateway autorizzato a scrivere.

`TrustedAuthorityOnlyGiteaCreatePreflight.stageCreate` vincola
tale record alla HEAD fornita dal **trusted owner**, controlla
Gitea HEAD → GET file `?ref=<SHA>` → HEAD: soltanto HTTP 404
reale sullo snapshot originale dimostra assenza. 503, file già
presente, HEAD avanzata e nome non canonico negano tutto prima
della prenotazione. Il record viene consumato nell'istanza
`WeakSet` **prima** del GET, dunque una lettura incerta non
può essere ripetuta con il medesimo Prepare in memoria.
`DurableAuthorityOnlyGiteaCreateIntentJournal` crea un marker
`O_EXCL|O_NOFOLLOW` proprietario `0600`, fa `fsync` sul
file e sulla directory `0700`, ed evita il replay anche dopo
restart. I campi comprendono sessione, Root, Task/Child, epoch,
DID, request/fingerprint, repository/Branch/path, HEAD originaria,
`old_path_absent_at_pinned_head:true`, SHA-256 e bytes del
contenuto nuovo. **Nessun blob preesistente viene inventato.**
Il marker ha `provider_write_authorized:false` e non costituisce
una ricevuta di Task completato.

I test offline (Fast CI da verificare su SHA R383.3) coprono
marker valido e persistente, processo riavviato/record duplicato,
Root/Child/fingerprint alterati, directory condivisa, file già
presente, errore 503, stale/racing HEAD, scadenza e rigetto
della preflight prima di qualunque write. Il nuovo preflight
non viene registrato come Tool ADK/A2A, EffectStager esecutivo
o provider executor; pertanto non modifica il percorso R383.2
né le autorizzazioni che l'agente già possiede.

**Per la fase A restano necessari:** consumo single-attempt del
marker nel Gateway con VP Rust e decisione OPA autentiche;
create HEAD CAS R383.2; MAC receipt del Gateway con seconda
rilettura indipendente; attestazione Task; regressioni integrate
e infine abilitazione del FunctionTool `create_file` negli
agenti. Fino a questi gate l'Executor deve continuare a
rifiutare `create_file`. Nessun pilot Gemini a pagamento.

### R383.2 — `create_file` con HEAD-CAS Gitea, ancora senza admission

L'operazione Gitea storica `createFile(branch,path,content)` può creare
un file con una semplice POST, **senza** atomicità sul puntatore della
Branch. R383.2 introduce in `GiteaClient` due metodi separati:

- `createFileWithHeadCas`: verifica prima che la HEAD coincida con la
  sorgente approvata e che il file **non esista in quel commit**; rifiuta
  gli errori del provider diversi da un vero HTTP 404. Crea una Branch
  di staging owner-private `feature/r3832-create-<digest>` dalla SHA
  originale, controlla ancora l'assenza, crea il file **solo nello staging**,
  verifica l'unico parent Git, HEAD staging, blob, contenuto UTF-8 e SHA
  della Branch iniziale. Effettua poi **una sola** PUT
  `old_commit_id → new_commit_id, force:false` sulla Branch di lavoro,
  seguita dalla lettura del vero commit e dei byte. La staging ref resta
  disponibile per riconciliazione in caso di risposta ambigua: nessun
  retry automatico.
- `verifyCreatedFileHeadCas`: porta **solo di osservazione**; quando
  il trusted Gateway le fornirà un client Gitea indipendente, rileggerà
  la HEAD, il parent del commit, l'assenza sul commit precedente e il
  contenuto/blob/digest esatti sulla nuova SHA. Il suo risultato
  contiene esplicitamente `provider_write_authorized:false`.

Nuovi test offline Gitea con client writer e observer **distinti**
coprono create positivo, file già esistente, errore HTTP 503 non
scambiato per assenza, ref staging contraffatta, parent errato,
contenuto alterato, HEAD concorrente, acknowledgment ambiguo,
sorgente e branch non canonici, prove indipendenti su blob, vecchio
file e digest. Aggiunti alla Fast CI, da confermare sulla SHA pubblicata.

**Importante:** questi due metodi **non** sono un nuovo FunctionTool,
una autorizzazione e nemmeno una completion Gateway autenticata.
L'Executor ADK e l'Owner A2A continuano a rifiutare
`create_file` finché non saranno cablati: prenotazione durable
owner-only dell'intent/assenza, Task e Child DC nativi,
Rust/OPA post-Prepare, writer a tentativo unico, receipt MAC
indipendente e test E2E prima di registrare il Task completato.
Non dichiarare ancora conclusa l'estensione `create_file` nella
fase A. Nessuna chiamata Gemini a pagamento, nessuna modifica a main.

### R383.1 — modello multi-file attraverso Child/Task distinti, fail-closed

La suite ADK gratuita simula tre modifiche a tre file diversi in
sequenza: due Backend, una Frontend, poi una Test run indipendente
sull'ultima SHA. Ogni file richiede un Task separato e un Child DC
entro il medesimo grant firmato, con completamento Gateway distinto.
Questo non equivale a un Task *atomico* che modifica più file.

La proposta adattiva non può più aggiungere grant inutilizzati:
ammette solo un `read_file` di investigazione già autorizzato,
un `update_file`, un `run_tests` del Test Agent, oppure
`read_file + update_file` **dello stesso file** nella modalità
native read→CAS già esistente. Task con due scritture, letture
di file estranei al mutation target, Runner combinato con
una scrittura, o `create_file` vengono respinti prima che
il Coordinator provi a registrarli. Lo stesso controllo
indipendente viene imposto all'Owner A2A, prima di trasferire
la vera Child DC via canale privato: non ci sono permessi
aggiuntivi da infilare nel subtask degli agenti.

**Limite esplicito:** `create_file` è ancora solo presente nel
catalogo/tool Legacy, non è cablato al nuovo stager native,
alla prenotazione di HEAD/assenza del blob e alla prova
Gitea post-CAS. Non è stato abilitato artificialmente.
Il lavoro successivo deve prima stabilire un owner-only
create intent con assenza del file attestata, branch HEAD
immutabile, CAS atomico, firma/OPA e verifica separata;
poi il FunctionTool dell'agente e infine prove reali E2E.
Multi-file atomico e recovery di errori applicativi
diversi dal Test FAIL restano aperti. Nessun Gemini a
pagamento o Full CI lanciato per questo incremento.

### R383.0 — lettura diagnostica del Test Agent, senza nuova autorità

**Baseline reale:** commit `63a4414a1e59` con Fast CI
[#42399581378](https://github.com/DarkGh0st03/delegation/actions/runs/42399581378)
SUCCESS e native E2E
[#42399581386](https://github.com/DarkGh0st03/delegation/actions/runs/42399581386)
SUCCESS sulla medesima SHA. L'E2E ha attraversato
`canonical_deployment_native_preflight` e
`canonical_signed_handoff_native`: original Engineer Review Host,
MCP Child/VP interprocesso, Rust/EVM/OPA, Gitea/Docker FAIL→PASS e
Draft PR non mergiata. I log attestano
`source_code_generated_autonomously_by_model=false` e
`paid_model_calls=0`; **non** prova il pilot generativo.

**Estensione A (validata dalla Fast CI e Engineer Approval R383.0):** il Task
read-only del Test Agent diventa una decisione possibile dell'ADK
adaptive work loop, *solo* per file sorgente in
`tests/backend/**/*.test.ts[x]` o
`tests/frontend/**/*.test.ts[x]`, e soltanto se la stessa Root
Engineer firmata e l'Agent Card trusted contengono `read_file`.
Un helper `isProjectTestReadGrant` convalida un'unica permission
exact-file; il Gateway originale la ricontrolla sia al pin della
HEAD prima del Prepare sia durante la verifica della lettura
Gitea indipendente. Il Review Host non accetta il report A2A
come completion, rilegge la prova autenticata e scarta HEAD
obsolete. Il modello riceve solo il bounded excerpt verificato.
`run_tests` rimane un Task Test distinto; non è possibile
scambiare una lettura con un PASS e non sono stati ampliati
i permessi di scrittura Test o quelli dei test di acceptance.
Test offline positivi e negativi: Root assente, capability assente,
file non di test, directory/extra grant, errore nella sorgente
verificata. Nessun permesso può essere aggiunto dal modello.

**Restano A/B:** `create_file` nel vero adaptive SDK,
multi-file bounded Task, fallimenti applicativi differenti dal Test
FAIL, configurabilità dei ruoli e maggiore separazione delle
FunctionTools. La lettura composta Planning è già presente,
quindi non va ricostruita.

### Nuova evidenza integrata R381.8 — 7 novembre 2026

- **Run [#42389020763](https://github.com/DarkGh0st03/delegation/actions/runs/42389020763): SUCCESS sulla HEAD `a458b4415d2af6190ac603b8a9da013acd47a33b`.**
  Log originali GitHub Actions: `r375_original_protected_main_functional_native_docker_pass_draft_pr`
  con `status=pass`; verificatore indipendente
  `r3819_original_review_host_native_mcp_proof_checked` con
  `status=pass`, zero chiamate AI a pagamento.
- **14 Child DC native emesse, 14 via MCP privato**;
  VP native via MCP: Backend **14**, Frontend **10**, Test **2**.
  Root Engineer diretta a Rust; Gateway verifica Rust/EVM/OPA;
  una sola Engineer approval, `main` originale immutabile,
  Gitea Branch originata dalla Root; **16 Task registrati / 15
  completati** (il primo FAIL autentico non è falsamente completato).
- Docker/Test Runner: primo **FAIL** autenticato, poi **PASS**;
  7 file sorgente e 3 file test aggiornati, 12 scritture CAS,
  researcher acceptance PASS, una Draft PR creata e verificata
  indipendentemente, **non mergiata**.
- **Confine di questa prova:** agenti del workflow *scripted*, non
  generazione autonoma Gemini; diagnostica di lettura prima del primo
  write non attestata (`authenticated_source_seen_before_first_write=false`);
  non dichiarare concluse le parti A o C, né la fase D finale dopo
  ulteriori cambiamenti. L'esito R381.8 è un PASS reale **di quel codice
  e di quella SHA**, non un PASS automatico delle SHA successive.
- **R382.4, successivo alla prova:** `runApprovedGeminiDag` storico
  rifiuta il fallback Signed DAG **prima** di read receipt/OIDC/Root
  se l'host trusted seleziona `authority-only`. Il Review Host
  richiede in quel profilo il Child issuer `native-stdio`,
  `APPROVED_RUNNER_NATIVE_MCP=1` e la Branch originale, prima
  di avviare l'operational launcher. Nuovi test negativi in Fast CI;
  **test e codice R382.4 da verificare sulla nuova SHA**.
  Nessun modello a pagamento lanciato.

### R382.5 — ingresso owner-only firmato nel launcher canonico

Il **vero** `createTrustedAuthorityOnlyReviewHost` espone ora il
metodo **privato, solo in-process**
`createReviewedCanonicalHandoff({provision})`. Questo costruisce il
nuovo `createTrustedAuthorityOnlyReviewedCanonicalHandoff` legato
**allo stesso** Planning checkpoint e al medesimo file di approvazione
Ed25519 dell'Engineer: sessione, SHA base, digest del grant approvato
e DID Engineer derivano dal Review Host, non da un Task, un modello o
dall'operatore. `reviewReadiness()` rilegge checkpoint+receipt,
senza Root o effetto. Solo `runApprovedCanonical()` (one-shot)
riesamina la firma, ottiene l'input **privato del trusted owner**
da `provision`, chiama `activateOperational` (con nuova verifica
originale dell'approvazione), `admitOperationalExecution` con
`privateChildMcpTransport:"native-stdio"` e infine
`runCanonicalOperationalWorkflow` (Branch prima degli agenti).
Le Root ambiguous, gli errori del provider e la cancellazione
ritirano il Review Host originale; **mai** retry automatico,
secondo issuer, Signed DAG di fallback, approval automatica o
merge. L'infrastruttura e le credenziali non sono esposte via
Engineer HTTP, A2A, MCP o function tool Gemini.

Sono stati creati test gratuiti unitari negativi per firma non
pronta, digest errato, port MCP mancante, doppia esecuzione,
cancellazione durante il controllo della firma, fallimento Gateway
e revoca Rust incerta. Un test usa il **vero** Review Host di
Planning (checkpoints+Engineer Ed25519), rilegge la firma e
dimostra che `reviewReadiness` non emette la Root operativa;
tutti sono collegati alla Fast CI. **Questo non rende ancora il
CLI pagato `run-trusted-gemini-owner.mjs` equivalente al launcher
authority-only**: la sua istanza Planning Gemini storica resta
separata e da migrare al Review Host originale prima del pilot.
La verifica nativa finale va ripetuta dopo le fasi C/E e sulla
nuova SHA; la prova R381.8 SUCCESS `a458b441` rimane valida
solo per la baseline precedente. Nessun modello a pagamento è
stato avviato o autorizzato.

### R382.6 — ingresso Gemini reale nel Review Host authority-only (senza chiamata pagata)

- La nuova API di processo `startProtectedCanonicalGeminiOwnerSession`
  usa il **medesimo** `createTrustedAuthorityOnlyReviewHost` / 
  `startTrustedAuthorityOnlyReviewHost`, non
  `assembleProtectedOwnerGeminiPlanning` o il vecchio
  `TrustedExecutionCoordinator`. Un Model `Gemini` ADK originale viene
  costruito **solo dopo** esplicito consenso testuale ai costi,
  verifica della SHA GitHub reale e pulizia dell'albero locale, lettura
  dei file 0600 protetti, scelta `authority-only` e signer MCP nativo.
  L'assemblaggio non invoca il provider; il vero Planning è
  potenzialmente **a pagamento**, perciò non è stato eseguito.
- `bindProtectedCanonicalGeminiOwner` confronta **prima di Planning**
  sessione, repository, base SHA Gitea, inventario, preliminary Root,
  requirement, identità `did` e `card_ref` Backend/Frontend/Test,
  indirizzo Gateway e `planId` tra il **protected owner JSON** e le
  **dipendenze concrete del Review Host originale**. Rifiuta un modello
  già iniettato o limiti Planning selezionati nel bootstrap, e impone
  20 turni, 180 s, 12.000 output token, 2 revisioni, thinking LOW.
  La chiave Backend viene letta solo dal file protetto e ricontrollata
  dal **checkpoint store originale**, senza creare altri signer.
  Il modello Gemini non riceve la chiave Engineer, Root, credential
  signer o i token A2A.
- Il wrapper con listener loopback inoltra ora
  `createReviewedCanonicalHandoff({provision})` **solo come
  capability privata in-process**, non come route HTTP. Dopo Planning,
  `reviewReadiness()` e `runApprovedCanonical()` riutilizzano la
  stessa verifica Ed25519 del Review Host, le sessioni originali e
  il percorso Branch → agenti → Runner → PR in Draft. Nessuna
  approvazione automatica, nessun merge e nessun fallback Signed DAG.
- Il vecchio CLI `run-trusted-gemini-owner.mjs` rifiuta
  **sincronicamente prima di leggere le chiavi o il source pin**
  `startProtectedGeminiOwnerSession` quando l'architettura è
  `authority-only` **o assente**: il percorso storico richiede
  `DELEGATION_GATEWAY_ARCHITECTURE=legacy-signed-dag` esplicitamente.
  Non è possibile scegliere involontariamente il Planning storico.
- Test offline in Fast CI: accettazione binding originale, 15 varianti
  di dati/identità/scope/model contraffatti, rifiuto del downgrade,
  source pin e consenso prima di import/provider, wrapper
  Engineer Review Host vero con Planning scripted e nessuna firma
  operativa senza approvazione. **Nessun nuovo PASS di CI o E2E
  attribuito finché GitHub Actions non lo conferma sulla SHA finale.**
- **Ancora aperto:** generare e caricare il set completo delle
  dipendenze `authority` dal bootstrap host protetto 0600 per un
  singolo **entrypoint eseguibile** (il nuovo ingresso è API
  in-process dell'operatore), quindi rieseguire il Full CI gratuito
  e la prova nativa su quella stessa SHA. Il pilot Gemini richiederà
  consenso esplicito separato **prima** di qualunque chiamata.
  
### R382.7 — bootstrap nativo owner-protected, senza avviare modelli

- Aggiunto `loadProtectedCanonicalOwnerManifest`: valida **senza
  provider** il manifest `0600` esatto, SHA GitHub della sorgente,
  snapshot Gitea/repository/base revision/requirement/work branch,
  Root preliminare, DID Backend/Frontend/Test/Orchestrator contro
  `ADAPTER_ID_<ROLE>`, capability allowlist, URL Gateway e Adapter
  loopback, sei directory separate `0700`, file protetti e
  **corrispondenza Ed25519 private/public dell'Engineer**.
  Rifiuta symlink, link count, permessi laschi, chiavi manomesse,
  file extra e modalità legacy.
- Aggiunto `assembleProtectedCanonicalOwnerAuthority`: unisce
  **lo stesso** Backend `AuthorityPlanningCheckpointStore`,
  `DurableAuthorityOnlyActivationJournal`,
  `DurableAuthorityTaskJournal`,
  `TrustedOperationalRecoveryStore`,
  `TrustedOperationalSessionStore`, revisione Planning su
  `TrustedPlanIpcClient.connect` con attestazione IPC originale,
  e `createTrustedEngineerCredentialPort` in modalità
  **`ENGINEER_CORE_NATIVE_MODE=1`** (Rust Core diretto, nessun
  downgrade HTTP o shared MCP). Il token Gateway e il token Rust
  provengono soltanto da file owner-only e non sono un JSON field.
  Il manifest verificato può essere assemblato **una sola volta**.
- L'API protetta `startProtectedCanonicalGeminiOwnerFromPrivateConfig`
  compie verifiche di consenso costi e SHA locale **prima** di
  aprire manifest, Gateway o caricare il modello Gemini; poi richiama
  l'ingresso Gemini `authority-only` R382.6 sullo stesso Host,
  il medesimo checkpoint Backend e la stessa approvazione firmata
  Engineer. Nessuna firma automatica, root operativa automatica,
  modello a pagamento o merge.
- Test gratuiti: manifest valido con Ed25519 reali, dati non
  riconosciuti, DID scambiate, secret file non privati, symlink,
  sorgente stale, separazione delle directory, chiave Engineer
  sostituita, GitHub Actions proibita, CORE nativo assente e
  tentativi di authority forgiata; invocazione API bloccata
  prima dell'accesso a chiavi/sorgenti in assenza del consenso.
  Collegati a Fast CI. Esiti ancora da osservare sulla nuova SHA.
- **Perimetro e prossimo passo:** `provision` operativo è ancora
  una callback trusted del processo (NON un programma caricabile
  dal file 0600). Serve collegarla al vero Root emesso e ai journal
  originali, con Gitea Branch, Executor ADK/A2A e Runner;
  quindi esporre l'unico eseguibile owner e verificare CI/E2E
  gratuita **sulla SHA finale**. Il PASS nativo R381.8 resta valido
  solo per la precedente SHA `a458b441`. Pilot Gemini a pagamento
  **non autorizzato**.

### Risultati attuali e limiti di prova

- **R375.8, E2E native [42354591410](https://github.com/DarkGh0st03/delegation/actions/runs/42354591410) SUCCESS**:
  branch dalla baseline applicativa non risolta; vera failure Docker;
  modifiche Backend/Frontend e a test applicativi; retest e researcher
  acceptance PASS; Draft PR creata e indipendentemente osservata, non mergiata.
- **R376.5, E2E native [42358777600](https://github.com/DarkGh0st03/delegation/actions/runs/42358777600) SUCCESS su `3c971d2e`**:
  aggiunge un read-only Task con Child nativa distinto, MAC e lettura Gitea
  HEAD/byte verificati, source observation privata nel turno ADK successivo,
  senza riuso dopo HEAD diversa. 17 Task registrati / 16 completati;
  il primo Test FAIL non è mai dichiarato completato.
- **R376.6**: Fast CI [42359406417](https://github.com/DarkGh0st03/delegation/actions/runs/42359406417)
  SUCCESS su `f3af2827`. Non dichiarare il precedente E2E come stessa-SHA.
- **R377.0**: il proposer ora accetta una lettura separata prima del primo
  fallimento, ma **soltanto** Backend/Frontend, singolo `read_file`,
  signed Engineer grant e capability del ruolo. I test offline dimostrano
  il contesto sorgente per la decisione successiva, lo scarto su HEAD diversa
  e il rifiuto se la root non copre la lettura o il ruolo è Test.
  Fast CI [42360929830](https://github.com/DarkGh0st03/delegation/actions/runs/42360929830)
  e Engineer UI CI [42360929846](https://github.com/DarkGh0st03/delegation/actions/runs/42360929846)
  SUCCESS su `25926712`. Questo **non** è ancora un nuovo E2E nativo R377.

- **R377.10–R377.11**: prove native gratuite di recovery dopo arresto
  autenticato prima della scrittura, con nuovo Task Backend o Frontend.
  Il Test Agent corregge un test applicativo con un Task separato. Retest
  Docker e acceptance PASS, Draft PR attestata. [Backend](https://github.com/DarkGh0st03/delegation/actions/runs/42364984157) ·
  [Frontend](https://github.com/DarkGh0st03/delegation/actions/runs/42365581148).
- **R378.0–R378.3**: l'issuer Child DC authority-only e la VP originale
  dell'Orchestrator transitano attraverso MCP privato **in-process, one-shot**;
  l'unico signer rimane Rust nativo. Il trasporto Gateway non espone gli
  strumenti crittografici come FunctionTools o endpoint A2A pubblici.
  [E2E nativo gratuito R378.2](https://github.com/DarkGh0st03/delegation/actions/runs/42366707550)
  SUCCESS su `d614a5bf`: una Child per specialista, arresto Frontend
  autenticato, recovery, Docker FAIL/PASS e Draft PR osservata. Non è la
  prova di un server MCP indipendente interprocesso; occorre decidere
  il trasporto definitivo prima del gate B.
- **R379.0–R379.1**: il runtime trusted verifica Agent Card, DID, endpoint,
  versione A2A, skill e capacità dichiarate; il proprio registro configura
  l'intersezione delle capacità e il client SDK ricontrolla la Card al send.
  [Fast CI](https://github.com/DarkGh0st03/delegation/actions/runs/42367818769)
  ed [Engineer CI](https://github.com/DarkGh0st03/delegation/actions/runs/42367818752)
  SUCCESS sulla stessa SHA `07f1ba46`. Ruoli ancora limitati a
  Backend, Frontend, Test con endpoint localhost pinned.
- **R379.2**: eliminate le liste duplicate di capacità nella factory ADK.
  Il catalogo permanente di ogni ruolo deriva dallo stesso
  `APPROVED_SPECIALIZED_AGENT_PROFILES` pubblicato nelle Agent Card;
  le permission del Task restringono **soltanto la visibilità** di path/tool
  applicabili, non definiscono nuove capacità o authority. Test offline per
  tre ruoli, read/update/create e Test Agent con Runner separato.
  [Fast CI](https://github.com/DarkGh0st03/delegation/actions/runs/42368494004)
  SUCCESS sul commit `dbd83cf6`. Questa è deduplicazione e separazione
  delle *definizioni*; la generalizzazione della visibilità FunctionTools,
  la discovery di ruoli configurabili e il Planning gerarchico sono ancora
  da completare.
- **R380.0**: modalità **esplicita, originata dal trusted Engineer host**
  `hierarchical_preliminary_read:true` nello snapshot immutabile. La Root
  preliminare su `main` contiene solo `read_repository` e due permessi
  root-directory **distinti** (`list_directory`, `read_file`); sulle feature
  branch solo i due permessi ricorsivi. Rust `ResourceUri::contains_resource()`
  e `giteaPermissionCovers()` conservano identità della repository, branch,
  path component e operazione, senza diritto implicito di scrivere.
  L'originale `TrustedPlanningGatewayReadPort` richiede ancora i path
  presenti nello snapshot owner-pinned e verifica la copertura in preflight,
  senza attribuire ai tool o al modello la possibilità di scegliere uno scope.
  Il limite di file/directory **nello snapshot** per l'opt-in è 4096 per
  lista; quello dei **permessi Root** non cresce con il numero di file.
  L'enumerazione e il limite 128 originali restano la modalità default.
  [Planner preflight R380.0](https://github.com/DarkGh0st03/delegation/actions/runs/42369299057)
  PASS con >128 file e controlli negativi su out-of-snapshot, branch e write.
  Al checkpoint R380.0 **non** erano ancora dimostrate discovery ricorsiva
  di nuovi file né la verifica nativa Rust/EVM; entrambe hanno evidenza
  successiva in R380.3, descritta sotto.
- **R380.1 completato nel percorso Planning preliminare separato**:
  `OrchestratorGatewayTransport.invokeReadComposite` usa le route
  `prepare-read-composite` / `execute-read-composite` del Gateway e
  richiede **una sola VP multipermission** per 2–12 operazioni, con
  risposta/challenge/permission/SHA verificate prima della firma. Il
  `TrustedPlanningGatewayReadPort` verifica ogni azione contro lo
  snapshot originale, il branch, la Root ancora attiva e la revoca. Nessun
  fallback a singole chiamate, nessun effetto write/test. Il Planner ADK
  espone `read_files` SOLO quando il port trusted implementa il batch:
  contenuti e byte budget vengono validati in blocco prima di inviare
  qualsiasi file al modello. [Planner offline preflight
  #42370109868](https://github.com/DarkGh0st03/delegation/actions/runs/42370109868)
  SUCCESS, con 6 nuovi test di integrazione ADK/Gateway (batch positivo,
  permessi alterati, path/branch/write vietati, OPA deny e sessione ritirata).
  Rimane INVARIATO il rifiuto delle route composite dal
  `GatewayRuntime` **operativo authority-only**; il batch è ammesso solo
  dal Gateway preliminare provvisto di `TrustedPlanningRevisions`.
  A R380.1 si trattava ancora di prove offline; la verifica nativa
  e la discovery dinamica sono attestate separatamente in R380.3.
  Una Root gerarchica non concede nuovi path al modello.
  L'attuale enum ADK dei file resta basato sulla lista trusted, fino
  a 4096 voci nell'opt-in: l'ottimizzazione dello schema del modello e
  dei limiti di output è un lavoro distinto, non un permesso aggiuntivo.
- **R380.2 discovery dinamica con scope Owner esplicito**:
  `TrustedPlanningSnapshot.dynamic_discovery_roots` (max 8 directory già
  elencate nello snapshot trusted) è valido SOLO quando
  `hierarchical_preliminary_read:true`. La Root firmata resta quella
  read-only di R380.0, senza nuove permission. Il ledger privato
  `TrustedPlanningDiscoveryLedger` registra nuovi file/sottodirectory
  **solo dopo** una risposta `list_directory` Gitea al commit originale
  e dentro le subtree scelte dal Software Engineer: ogni entry deve avere
  path canonico, essere figlia diretta e superare i limiti (200 entry per
  elenco, 4096 file e 4096 directory totali). Un listing parzialmente
  invalido non modifica il ledger.
  `TrustedPlanningGatewayReadPort` conserva controllo attivo della Root,
  identità, branch, scope e SHA; un file inventato è respinto **prima**
  di Gateway prepare. `TrustedAdkReadOnlyPlanner` abilita il path dinamico
  per `read_file`/`read_files` solo in questa modalità e aggiorna
  **localmente** le liste usate per validare la proposta non approvata.
  La Root preliminare e lo snapshot owner-signed non sono riscritti.
  L'Engineer deve ancora firmare la Root operativa indipendente.
  [Planner preflight #42371230353](https://github.com/DarkGh0st03/delegation/actions/runs/42371230353)
  SUCCESS: Gitea pinned, directory e file nuovi, ADK scripted che
  propone modifica di un file scoperto, spoof/traversal e lettura anticipata
  negati, revoca e regressioni legacy. La prova nativa corrispondente,
  successivamente chiusa in R380.3, usa invece Rust/EVM/OPA/Gitea reali.
  Nessuna autonomia generativa di Gemini dimostrata.
- **R380.3 — Planning gerarchico/discovery/composite nativo PASS**:
  [F1 No AI #42375886151](https://github.com/DarkGh0st03/delegation/actions/runs/42375886151)
  SUCCESS sulla SHA di codice `e24632c6`: il test avvia veri Rust
  issuer/Verifier e trust/status EVM, OPA e Gitea disposable. Esclude
  deliberatamente il file Frontend dallo snapshot originale; il Planner ADK
  **scripted** deve prima osservarlo via Gitea `list_directory` pinned,
  poi leggerlo con un secondo file in **una sola VP multipermission**.
  La Root preliminare ha 3 grant read-only e il signer divulga soltanto
  i dir grant firmati dalla Root; il Core Rust corrobora ciascuna leaf
  richiesta, senza sintetizzare leaf nella VP. Il Gateway distingue
  `record.pinned_revision` + registry Planning attiva da un
  `approvedPlans` solo istanziato ma **non attivato**; nessuna authority
  operativa eredita l'opt-in. Il risultato strutturato attesta SHA
  Gitea `405748b1e77992b6bd8630a3ab6f990658d32f6b`,
  discovery verificata, 1 VP multipermission, Root revocata, zero
  scritture/approvazioni operative/PR, zero chiamate Gemini.
  [Planner Preflight #42375807668](https://github.com/DarkGh0st03/delegation/actions/runs/42375807668)
  SUCCESS include i test negativi su branch errato, permessi
  impliciti, Root non opt-in e path non scoperti.
  L'F1 resta una **prova di Planning**: non dimostra un Executor AI
  generativo, MCP indipendente interprocesso, launcher finale né
  E2E Docker post-cleanup.
- **CI native R380.3 deliberate**: la costosa F1 con Rust/EVM/Docker
  parte da modifica del proprio workflow oppure da checkpoint
  `.github/ci-checkpoints/r3803-native-planning-read-request.json`
  (o dispatch manuale); gli altri push usano Fast CI e i test gratuiti
  mirati. Non lanciare ripetutamente suite native ad ogni commit.
- **R381.0 — primo confine MCP interprocesso verificabile**:
  aggiunti un vero server MCP SDK **stdio in processo separato**,
  un client trusted owner con env minima (nessun secret/token/sorgente),
  un catalogo statico unico di quattro tool privati (Child, Root,
  revoca, VP) e un protocollo con richiesta opaque monouso,
  singolo ACK vincolato al ref e PID di un processo distinto.
  Il callback Rust originale rimane nella memoria dell'Owner e
  viene invocato **solo dopo** un MCP ACK valido: nessun trasferimento
  del DC firmato/VP al server, nessun HTTP/A2A endpoint e nessuna
  authority allargata. Test positivi, chiusura anticipata, replay,
  invocazione concorrente, input sconosciuto ed errore privato
  sanificato in
  [Cryptographic MCP Profile](https://github.com/DarkGh0st03/delegation/actions/workflows/crypto-mcp-offline.yml).
  **R381.1 opt-in originale Child**: il costruttore
  `TrustedAuthorityOnlyChildIssuer` accetta ora `privateMcpTransport`
  dal SOLO trusted Owner (`"in-process"` per default, oppure `"stdio"`).
  Il broker isolato viene usato **solo dopo** journal reserve e
  verifica di Root/Task; il medesimo `nativeCryptoPort.issueChild`
  continua a firmare nell'originale Owner. Un ACK ambiguo o Child non
  valida non fa fallback, non riusa il Task e non amplia il signed
  Engineer permission ceiling. Un nuovo test offline invoca
  `issueForRegisteredTask` con subprocess MCP reale e verifica
  trasferimento Child one-shot, replay e risposta corrotta.
  [Fast CI #42377180297](https://github.com/DarkGh0st03/delegation/actions/runs/42377180297)
  SUCCESS 2/2 sulla SHA `7e30b9e8`; le prove crypto SDK stdio
  [#42376726090](https://github.com/DarkGh0st03/delegation/actions/runs/42376726090)
  SUCCESS sulla SHA `0d315afe` (checkpoint precedenti).
  **Limite esplicito**: è un broker di capability/trasporto opzionale,
  NON ancora il servizio MCP che esegue la firma effettiva in un
  processo separato. Il launcher operativo non ha ancora attivato
  `"stdio"` per il pilot nativo; Root/VP/Engineer non sono migrati.
  B e C restano aperte. Prossimo passaggio: test R381.2 nativo
  Rust/EVM di Child con questo opt-in, poi confine privato per VP
  senza seconda autorità né endpoint modello.
- **R381.2 — vera Chain nativa Child+VP attraverso broker MCP stdio,
  SUCCESS**: l'E2E esistente R292 è stato esteso senza nuovo workflow,
  attivato UNA SOLA volta con checkpoint esplicito
  `.github/ci-checkpoints/r292-native-evm-request.json`. Il
  `TrustedAuthorityOnlyChildIssuer` originale prende l'opt-in
  `privateMcpTransport:"stdio"`, dopo journal reserve e firma
  Engineer della Root; la Child DC viene emessa dal medesimo Rust
  `CryptoRuntime`. Il Backend attraversa tre ulteriori sessioni
  MCP stdio *distinte*, monouso, prima di tre VP firmate attraverso
  il medesimo socket Rust: una VP corretta, una relativa a Child
  non associata al Task e una predisposta per la prova di revoca.
  Gateway/Core Rust/EVM verificano DID, provenienza Root, permessi
  e stato; OPA consente il permesso intrinseco, ma l'esecuzione
  Gateway senza abilitazione operativa resta negata. Un Child
  non associato è rifiutato e una VP già pronta viene rifiutata
  dopo revoca EVM della Root. Zero effetti del provider e zero
  API AI. [R381.2 native E2E #42378351480](https://github.com/DarkGh0st03/delegation/actions/runs/42378351480)
  **SUCCESS** su `71eebebd`; [Fast CI #42378351487](https://github.com/DarkGh0st03/delegation/actions/runs/42378351487)
  **SUCCESS 2/2 sulla stessa SHA**. Eventi strutturati:
  `r3812_native_child_vp_stdio_verified`, 1 Child broker,
  3 VP broker, 3 VP native, Root revoked, provider=0, paid=0.
  **Limite essenziale**: il broker MCP è un servizio interprocesso
  reale di *attestazione della richiesta*, ma il processo MCP NON
  contiene il signer Rust. L'effettiva chiamata a Rust segue
  l'ACK all'interno dell'Owner originale. È la prova di migrazione
  del **trasporto opzionale** per Child+VP, non del servizio MCP
  crittografico definitivo né dell'Executor AI. Il launcher
  canonico continua a usare il default in-process. R381.3 dovrà
  far transitare la richiesta crittografica e la sua risposta
  attraverso un server MCP privato realmente autorizzato,
  senza secondo signer o credenziali nel modello.
- **R381.3 — servizio MCP stdio nativo opt-in, da validare**:
  distinto dal broker ACK-only R381.2, il processo MCP separato riceve
  richiesta Child o VP su canale stdio privato e invoca direttamente
  il socket autenticato del **medesimo** CryptoRuntime Rust. Il signer
  Rust non viene duplicato; token e credenziali non sono accessibili
  a Gemini, Agent Card, FunctionTool, A2A pubblico o HTTP.
  L'Engineer mantiene Root issue/revoke diretti al Core.
  Il Child issuer ammette la modalità owner-only `native-stdio`
  esclusivamente se il port Rust possiede il metodo nativo esplicito;
  non c'è downgrade automatico a `stdio` o `in-process`.
  Test offline su socket disposable verificano successi, replay,
  risposta corrotta, chiusura e rifiuto delle operazioni Root.
  Il test R292 possiede un opt-in `R3813_NATIVE_MCP_SIGNING=1`
  per Child e tre VP, **ma non è ancora certificato PASS in tale modalità**.
  Richiesti Fast CI e successiva prova nativa Rust/EVM/OPA sulla stessa SHA;
  launcher definitivo, adapter MCP per gli agenti e gate B restano aperti.
- **R381.4 — originale Agent ADK/A2A VP con trasporto MCP nativo opt-in**:
  il trusted host `poc/apps/a2a-agent` accetta
  `DELEGATION_PRIVATE_NATIVE_MCP_SIGNING=1` esclusivamente in
  `authority-only` + ADK con il socket Rust originale.
  Il `DelegationEvidenceHandler` genera la VP tramite processo MCP
  privato che esegue direttamente `create_presentation` sul medesimo
  CryptoRuntime, vincolato alla Child e al Gateway prepare del Task.
  Nessun fallback in-process/HTTP dopo errore ambiguo; il percorso
  predefinito rimane invariato e nessun tool modello può cambiare il mode.
  Test offline aggiunti per VP positiva, errori sanificati, modalità
  legacy vietata e socket mancante. **Non è ancora una prova integrata
  nativa A2A/Rust/EVM/OPA/Gitea/Docker; CI su nuova SHA da verificare**.
  Il gate B resta aperto per la scelta finale del trasporto, il launcher
  canonico e la regressione reale.
- **R381.5 — regressione privata Agent/Task → MCP → Rust (offline)**:
  in `local-crypto-mcp-bridge.test.ts` la stessa catena usata
  dal runtime ADK viene esercitata in locale per Backend, Frontend e Test:
  `Gateway prepare` di riferimento → `PrivateMcpTaskRegistry`
  → `LocalCryptoMcpBridge` → `DelegationEvidenceHandler`
  → processo MCP stdio → socket nativo Rust **simulato**.
  I test verificano Child ID, audience, challenge, permission, bearer
  distinto per ruolo, tre richieste monouso e nessuna chiamata HTTP;
  negano replay, Task chiuso e risposta Rust errata senza mostrare
  errori privati. È nuova **copertura offline**, non conferma delle
  CI sulla SHA, di Gitea/Docker né dell'autonomia generativa.
  Prima di chiudere B serve ancora evidenza nativa integrata e un
  launcher definitivo. `main` e approvazioni non vengono modificati.
- **R381.6 — gate owner-bound A2A/ADK per VP MCP stdio**:
  l'A2A server rifiuta `nativePresentationTransport:"mcp-stdio"`
  se non è avviato nel trusted host authority-only con
  `mcpTaskSigning`. Il factory ADK rifiuta anche l'invocazione
  programmatica diretta senza entrambi i registri originali:
  `trustedEffectTaskRegistry` e `mcpTaskRegistry`.
  Sono stati aggiunti test gratuiti di rifiuto prima del listener
  per host legacy, host non configurato e Task registry assente.
  Questo restringe l'opt-in introdotto in R381.4; non costituisce
  una prova nativa end-to-end né autorizza il launcher a pagamento.
- **R381.7 — canonical Review Host owner-only Child MCP opt-in**:
  `createTrustedAuthorityOnlyReviewHost(...).admitOperationalExecution(deps)`
  accetta unicamente `privateChildMcpTransport:"native-stdio"` come
  opzione aggiuntiva del **trusted owner**. Prima di aprire il Gateway
  richiede il metodo `issueChildViaPrivateMcp` del port Rust originale;
  la modalità `"stdio"` ACK-only e valori arbitrari sono rifiutati
  senza fallback. La Root del Software Engineer, il Core verifier del
  Gateway, i Task, i journal originali e i permessi firmati restano
  invariati. Il percorso di default è lo stesso di prima.
  I test gratuiti nel Review Host verificano una Child sotto la Root
  operativa originale, nessuna chiamata al signer diretto in modalità
  opt-in e il rifiuto di port/maniera invalidi, con revoca della Root.
  **Limite**: la prova del Review Host usa un port Rust controllato;
  non è ancora attestato il flusso canonico completo con Rust/EVM/OPA
  reali, A2A, Gitea e Docker sulla HEAD attuale. In particolare gli
  E2E R375 con agenti scripted non sono automaticamente migrati.
  Conservare i gate di CI e NON attivare workflow Gemini a pagamento.
- **R381.8 — prova integrata canonica MCP nativo richiesta, NON ancora attestata PASS**:
  l'E2E storico R375 dispone ora di `R3818_CANONICAL_NATIVE_MCP=1` per
  verificare l'originale Review Host con Root Engineer diretta a Rust,
  Child firmate **dentro il processo MCP stdio**, tre agenti
  Backend/Frontend/Test con VP via MCP stdio, Gateway Rust/EVM/OPA,
  autentico Gitea + Docker FAIL→recovery→PASS e Draft PR non mergiata.
  La modalità default R375 rimane invariata. È stato creato un workflow
  gratuito dedicato `r3818-canonical-private-native-mcp-e2e.yml`,
  con dipendenze MCP pinned e verifiche delle evidenze: nessuna chiamata
  AI, Child count esatto, VP per tutti i ruoli, root e main immutabili,
  receipt Docker e Draft PR attestata. Un checkpoint GitHub Actions
  esplicito è il solo trigger di push della suite nativa: NON ripetere
  la suite costosa a ogni commit. **Il codice di test e la CI preparata
  non equivalgono a una esecuzione SUCCESS**. Recuperare la conclusione
  del job sull'esatta SHA; correggere gli eventuali FAIL prima di
  dichiarare conclusa la fase B. La verifica non autorizza Gemini.
- **R381.9 — verifica riproducibile e anti-false-PASS delle evidenze native MCP**:
  `poc/scripts/verify-r3818-native-mcp-proof.mjs` legge il JSONL
  prodotto dall'**originale** E2E R375/R381.8 e richiede **esattamente
  una** evidenza terminale PASS. Verifica il Child count MCP uguale al
  numero Child firmate, almeno una VP MCP per ognuno dei tre ruoli,
  verifica Rust/EVM/OPA, main immutabile, branch originale, fallimento
  Docker autentico seguito dal PASS, source/test updates, Draft PR
  indipendente non mergiata e zero modelli a pagamento. Rifiuta
  attestazioni parziali, falsificate, duplicate, replay contatori errati
  e valori estranei, stampando soltanto un certificato sanificato.
  Sono aggiunti test **gratuiti** nel Fast CI e nel preflight del
  workflow R381.8. La sezione E2E usa `set -euo pipefail`, controlla
  la modalità authority-only prima **e dopo** i file runtime e non
  accetta un fallimento del processo Node occultato da `tee`.
  La logica del verificatore è stata controllata con un campione PASS
  e sei mutazioni negative; **non risulta verificata la CI GitHub Actions
  né la suite nativa R381.8 sulla SHA aggiornata**. I metodi GitHub
  disponibili per le run del commit filtrano gli eventi pull_request,
  quindi la lista vuota non certifica l'assenza di run `push`.
  Non viene richiamata automaticamente una nuova lunga suite nativa
  in assenza dell'esito della precedente. Nessuna API AI a pagamento.
- **R382.0 — cancellazione originale Task → processo MCP stdio**:
  il trasporto `createOwnerPrivateNativeCryptoMcpSession` ora accetta
  un `AbortSignal` trusted, impedisce l'avvio se già cancellato e
  chiude la sessione MCP/client/worker se il Task viene annullato
  durante il flusso. L'originale `DelegationEvidenceHandler` passa
  il proprio segnale al subprocess nativo, senza aprire un trasporto
  alternativo. I test offline coprono cancellazione prima della
  richiesta Rust e cancellazione dopo che il socket ha visto una
  richiesta, con VP mai resa al chiamante, una sola richiesta e zero
  fallback HTTP. **Nota fail-closed:** annullare una richiesta dopo
  l'invio non è una prova che Rust non abbia già completato l'operazione:
  il journal/Task non può riutilizzare o ritentare l'effetto ambiguo.
  Test aggiunti al Fast CI, nessuna suite nativa a pagamento.
  Il nuovo commit non ha ancora esito Fast CI/E2E verificato.
- **R382.1 — timeout MCP completo (handshake, discovery, IPC)**:
  il servizio interprocesso nativo dispone di un limite **sull'intera
  sessione** `native_timeout_ms + 5000`, non soltanto sul socket
  Rust. `Client.connect`, `listTools` e `callTool` competono con
  lo stesso watchdog. Su timeout o cancellazione: chiusura del processo
  MCP, errore sanificato, nessuna VP/Child restituita e nessun retry
  sul port diretto/HTTP. Il timer resta attivo anche se l'handshake
  ha lasciato zero handle Node; viene rimosso su completamento.
  Test aggiunti per il blocco artificiale del handshake SDK,
  la scadenza temporale e il rifiuto di segnali Task non validi.
  Nel Fast CI i test MCP sono già eseguiti via
  `npm --prefix poc/mcp-shared test`; non serve una suite lunga
  per ciascun commit. **Nuova SHA ancora senza prova GitHub
  Actions PASS recuperabile; non chiudere B sulla base dei test
  scritti.** La cancellazione non annulla effetti già inviati
  al Rust signer; resta obbligatorio il journal fail-closed.
- **R382.2 — R381.8 FAIL effettivo recuperato, preflight corretto senza downgrade**:
  recuperati finalmente **i risultati reali degli eventi `push`** con GitHub REST
  `/actions/runs`: R382.1 Fast CI
  [#42386677279](https://github.com/DarkGh0st03/delegation/actions/runs/42386677279)
  **SUCCESS**; due suite MCP offline
  [#42386677234](https://github.com/DarkGh0st03/delegation/actions/runs/42386677234)
  e [#42386677440](https://github.com/DarkGh0st03/delegation/actions/runs/42386677440)
  **SUCCESS** sulla stessa SHA `6236599e`.
  L'E2E R381.8
  [#42384687716](https://github.com/DarkGh0st03/delegation/actions/runs/42384687716)
  **FAIL** sul checkpoint `f2b8bc51`, **solo nello step 9 preflight**:
  tre test offline R381.7 costruivano il Planning Review Host con Gateway
  e Child mock mentre la variabile di **job**
  `APPROVED_RUNNER_NATIVE_MCP=1` richiedeva, correttamente,
  `ADAPTER_ENGINEER_NATIVE_SOCKET` (non ancora avviato). Nessuna prova
  reale Rust/Gitea/Docker è stata eseguita in quella run: il job è uscito
  prima dell'avvio di Anvil/OPA/Gitea.
  Il workflow R381.8 ora isola **soltanto il sottoprocesso di unit test**
  R381.7 con `APPROVED_RUNNER_NATIVE_MCP=0`,
  `R3818_CANONICAL_NATIVE_MCP=0`, e senza socket in eredità.
  La vera fase native E2E conserva il flag di job `=1`, controllato
  esplicitamente dopo i file runtime, con `authority-only`, Rust reale,
  nessun Adapter fallback e zero modello a pagamento. Due test di
  regressione `r3822-native-mcp-checkpoint-isolation.test.mjs` verificano
  che il preflight resti confinato e che il gate nativo non sia disabilitato;
  sono collegati a Fast CI e al preflight del workflow. L'E2E **deve
  essere rieseguito una sola volta** dopo il cambio per ottenere la
  prova su una SHA finale. Non attribuire mai il vecchio FAIL a Docker,
  Planner/Executor generativo o Rust nativo, perché non erano stati
  avviati.
- **R382.3 — reale DID del signer Rust collegata alle Agent Card native**:
  il retry gratuito R381.8
  [#42387283759](https://github.com/DarkGh0st03/delegation/actions/runs/42387283759)
  su SHA `18266e20` ha superato il preflight, bootstrap
  Anvil/OPA/Gitea, registri EVM, addon Rust, blocco Adapter legacy e
  check no-HTTP; è **FAIL** nel vero percorso A2A alla verifica
  `verified Agent Card differs from trusted specialist DID`, prima
  del primo dispatch Task. La Card pubblicava la DID statica
  `did:thesis:<role>-agent`, mentre il trusted Engineer registry e
  le credenziali native Rust utilizzavano l'identità firmataria
  `ADAPTER_ID_<ROLE>` (DID `did:ethr:...` sulla chain locale).
  **La verifica trusted resta intatta**: la factory Card accetta
  `nativeSignerDid` solo su host ADK Task owner-bound
  `authority-only`, `APPROVED_RUNNER_NATIVE_MCP=1`, identico
  all'`ADAPTER_ID_<ROLE>` preprovisionato e, sotto profilo EVM,
  `did:ethr:`. Il probe SDK risolve la stessa DID dal
  signer preprovisionato, ricontrolla capacità e Card su ogni send;
  il Review Host la confronta ancora in modo indipendente col
  proprio registro Engineer. Il launcher A2A nativo e l'E2E
  R381.8 passano la DID solo dalla configurazione trusted, mai
  da modello, Task, A2A metadata o tool. Sono stati aggiunti
  test positivi e anti-impersonation per i tre ruoli al Fast CI e
  preflight nativo. La vecchia Card sintetica resta disponibile
  soltanto nel profilo storico non-native, non come fallback
  nel profilo authority-only.
  **Validazione offline stessa SHA `46b547171d59` confermata:** Fast CI
  [#42388751553](https://github.com/DarkGh0st03/delegation/actions/runs/42388751553)
  SUCCESS, Crypto MCP Profile
  [#42388751623](https://github.com/DarkGh0st03/delegation/actions/runs/42388751623)
  SUCCESS e Gateway Bridge
  [#42388751566](https://github.com/DarkGh0st03/delegation/actions/runs/42388751566)
  SUCCESS. Il prossimo checkpoint nativo resta distinto e obbligatorio
  prima di dichiarare conclusa la fase B; nessun Gemini a pagamento.
- **Fase A ancora aperta**: `create_file` authority-only, journal multi-file,
  e gestione generale di altri esiti applicativi recuperabili. Le prove
  native finora usano modifiche/decisioni scripted, non Gemini generativo.

**Vincolo di evidenza:** tutti i flussi gratuiti R375–R377 utilizzano
decisioni e correzioni di riferimento scripted. Nessuna prova afferma che
Gemini abbia autonomamente generato il codice o concluso il recovery. Non
avviare workflow Gemini pagati senza consenso esplicito. Non introdurre
merge automatico o alterare il branch GitHub `main`.

### Attività immediata nella Fase A

1. Espandere il catalogo del loop senza aggirare un Task native Child:
   indagine, editing e verifiche restano Task verificabili del Coordinator;
   `create_file` e più effetti ordinati richiedono prima un journal sicuro.
2. Trattare come recuperabili solo i **fallimenti applicativi corroborati
   indipendentemente**, includendo test di codice Backend/Frontend e Test
   applicativo. Errori di credenziali, revoca, trasporto ambiguo o OPA sono
   terminali, non recovery D1 rinominati.
3. Portare informazioni diagnostiche sanificate ai turni ADK, con limite di
   byte, Task originale e HEAD; verificare ripetute correzioni e blocco senza
   scope, prima della nuova full CI.
4. Non allargare indiscriminatamente il limite di 16 turni per compensare
   una progettazione ancora troppo granulare: scegliere solo dove un Task
   multi-file sia sicuro con un journal ordinato e prove di replay.

### Strategia CI e pulizia

Durante A–C: test offline mirati e Fast CI; l'E2E nativo esteso soltanto ai
checkpoint significativi. Durante E: inventario delle dipendenze **prima** di
cancellare, mantenimento delle prove negative Rust/Gateway, rimozione per
famiglie dopo switch degli entrypoint e regressioni gratuite dopo cleanup.
Il pilot a pagamento F si sblocca **solo** dopo E e consenso esplicito.

---

## Archivio: ordine del lavoro precedente (R353–R357)

1. **Operazioni proprie dell'Orchestrator.** Root operativa e VP per branch/PR;
   Child DC soltanto per Backend, Frontend e Test. Nessuna modifica al Core Rust
   per consentire autodelega. Binding esatto sessione/Task/root/revisione, Gateway
   Rust e OPA, effetto singolo e completamento verificato indipendentemente.
2. **Executor autonomo.** Un controller possiede il ciclo osservazione → scelta
   dei Task → esecuzione → verifica → completamento. Riusa Coordinator e registri
   trusted. La sequenza non deve essere predisposta dal test harness; il modello
   deve poter ispezionare codice entro lo scope approvato.
3. **Recovery diagnostico.** Riutilizzare D1, fornire diagnosi tecniche sanificate
   e letture autorizzate al modello; lasciare scegliere specialista e correzione
   entro il plafond firmato. Il solo digest del fallimento non è una diagnosi.
4. **Migrazione architetturale.** Child tramite MCP attivo; discovery e FunctionTools
   configurabili; scope preliminare gerarchico e letture composte; launcher canonici
   authority-only. Rimuovere il legacy sostituito dopo verifica delle dipendenze.
5. **Prova gratuita unica.** Requisito → Planning via Gateway reale → approvazione
   delle sole permission → branch → sviluppo → Test → eventuale D1 → PR attestata.
   Distinguere fixture, modelli scriptati e generazione effettiva del codice.
6. **Pilot Gemini**, soltanto con consenso esplicito ai costi e gate CI concordati.
   GUI locale finale successiva. Merge sempre separato e umano.

## Evidenze storiche (R353–R357; non rappresentano lo stato attuale)

- **PR nativa confermata:** R353.9, checkpoint `06a7f7246b0641d9b8c757082111d3ebff3eaecd`,
  [run 42255261326](https://github.com/DarkGh0st03/delegation/actions/runs/42255261326)
  SUCCESS; Fast CI 42255260980 SUCCESS sulla stessa SHA.
  Backend/Frontend, Docker FAIL, D1 repair e retest/acceptance PASS, root originale
  invariata, una Draft PR e attestazione indipendente. Sei Task registrati, cinque
  completati: il primo Test rimane fallito. Replay e revoca verificati, main invariato,
  zero chiamate a pagamento. Rust non modificato per la correzione PR.
- **Limiti della prova:** modelli scriptati, applicazione funzionale predisposta
  dal test owner, trasporto preliminare Gateway fixture. Non è prova di generazione
  autonoma Gemini, né di Planning completamente reale.
- **Branch nativo confermato:** R354.2, checkpoint `d21ac06b84bef0e9f7f5313e9bad5abf7a9a9762`,
  [run 42258775959](https://github.com/DarkGh0st03/delegation/actions/runs/42258775959)
  SUCCESS; Fast CI 42258775993 SUCCESS sulla stessa SHA. Sorgente R354.1 `f0c52287`
  con Fast CI 42258410503 ed Engineer CI 42258410306 SUCCESS.
  Baseline main irrisolta invariata; branch assente fino all'approvazione; Task scelto
  da ADK scriptato e registrato dall'owner originale, una VP root a profondità zero,
  Rust/EVM e OPA reali, HTTP GatewayRuntime, un solo POST Gitea e completamento
  attestato da client read-only indipendente. Un Task registrato/completato, zero
  Child, replay e revoca verificati, zero chiamate a pagamento. Nessun file predisposto.
- **Limite del branch:** il trasporto preliminare Gateway rimane fixture, pur con
  lettura reale di main e VP preliminare nativa. È una prova branch-only, distinta
  dalla prova nativa recovery/PR: non chiude la prova gratuita unica R11.
- **Executor R355 avviato:** l'owner originale espone un ciclo ADK limitato che
  sceglie Task/stop/blocco, registra/delega, esegue A2A e attesta prima della scelta
  successiva. Non riceve una lista di Task. La richiesta di PR è una readiness
  verificata sulla HEAD corrente, non una PR già creata. Si riusano i registri e
  gli esecutori esistenti; il budget originale resta invariato.
- **R355.5 — Test FAIL osservato e riparazione adattiva SDK:** il nuovo owner
  verifica il Runner FAIL tramite ricevuta MAC, Gateway, Child, root e HEAD,
  senza candidato D1 preimpostato. Il modello scriptato decide Backend repair
  e retest PASS nella stessa sessione, preservando il Test iniziale incompleto.
  Engineer CI [42266112619](https://github.com/DarkGh0st03/delegation/actions/runs/42266112619)
  SUCCESS: 171 test principali PASS. Provider e issuer di questa prova SDK
  restano fixture; non attribuire questa evidenza a Gemini generativo o native E2E.
- **R355.6–R355.9 — recovery adattivo più generale e diagnostica minima:** un
  errore A2A/trasporto è terminale; solo un Runner FAIL confermato dalla ricevuta
  MAC originale può sbloccare un nuovo turno. Due FAIL autenticati successivi
  sono ora ammessi nella stessa sessione, mentre il terzo termina in sicurezza.
  Il modello vede storia verificata dei fallimenti e, per typecheck, codici TS
  sanificati e MAC-autenticati, mai log grezzi o credenziali. Engineer CI
  [42270124666](https://github.com/DarkGh0st03/delegation/actions/runs/42270124666)
  SUCCESS sul codice `0e0c4729`: 175 test principali PASS, nessun FAIL.
  Il test SDK usa ancora provider/issuer fixture e modelli scriptati.
- **R356.0 — primo Test FAIL controllato dal loop adattivo, nativo:**
  [run 42271611943](https://github.com/DarkGh0st03/delegation/actions/runs/42271611943)
  SUCCESS. Originale Engineer UI/review, root Rust/EVM, OPA e Gateway/Gitea
  reali; ADK scriptato sceglie il Test tramite A2A e riceve dal Runner
  Docker un autentico FAIL di typecheck. Una ricevuta MAC autentica il
  fallimento; il Test non viene completato; decisione bounded blocked,
  root revocata, main invariato. 3 Task / 2 completati / 1 Runner.
- **R356.1 — recovery dinamico + retest nativo:**
  [run 42273016127](https://github.com/DarkGh0st03/delegation/actions/runs/42273016127)
  SUCCESS. Test FAIL reale → decisione Backend D1 dopo prova → Gitea CAS
  attestata → Test di sostituzione e acceptance Docker reali PASS. Nessun
  candidato D1 prestabilito prima del FAIL; una sola root Engineer originale.
  5 Task / 4 completati / 2 Runner / 3 commit Gitea; il Test fallito
  resta incompleto. Root ritirata dopo readiness.
- **R356.2 — recovery adattivo e Draft PR native nella stessa sessione:**
  [run 42274902525](https://github.com/DarkGh0st03/delegation/actions/runs/42274902525)
  SUCCESS. Dopo il PASS indipendente, l'Orchestrator (VP root depth 0,
  nessuna autodelega Child) propone e crea una sola Draft PR su Gitea
  disposable; l'owner ne attesta separatamente HEAD e identità. Replay
  negato, main invariato, 6 Task / 5 completati / 2 Runner / 3 commit
  Gitea / 1 PR. Un Test FAIL resta permanentemente non-completato.
  Tutto a costo AI zero; i modelli di scelta e i contenuti correttivi
  rimangono **scriptati**, e la fonte applicativa iniziale è predisposta
  dal test owner prima dell'approvazione. Questo NON prova planning
  generativo, letture autonome del codice o feature branch creato da main
  nella stessa sessione: il gate R354 branch-only è ancora separato.
- **R357.0 — branch nativo e prima Child Backend sulla stessa root:**
  [run 42281811050](https://github.com/DarkGh0st03/delegation/actions/runs/42281811050)
  SUCCESS. Main non risolta, branch inizialmente assente, approvazione
  permission-only firmata, root VP Rust/EVM e Gateway/OPA/Gitea nativi.
  Solo dopo attestazione indipendente del branch, ADK scriptato sceglie
  Backend e Rust emette una Child autentica limitata a un file. Sono
  vietate l'ammissione e la decisione ADK Backend prima del branch.
  Nessuna modifica file e nessuna app predisposta dal test owner.
- **R357.1 — prima modifica Backend nativa da main non risolta:**
  [run 42283619980](https://github.com/DarkGh0st03/delegation/actions/runs/42283619980)
  SUCCESS. La stessa sessione usa l'originale root per il branch e
  una Child Backend per un vero UPDATE Gitea con HEAD CAS e OPA;
  una seconda lettura Gitea e ricevuta MAC verificano il file modificato.
  Questa variante esegue manualmente il Gateway dall'harness e NON
  completa il Task Backend senza A2A. La sorgente della modifica è
  ancora un riferimento scriptato, non generazione autonoma.
- **R357.2 — Backend ADK/A2A nativo, CAS e Task completato:**
  [run 42285796338](https://github.com/DarkGh0st03/delegation/actions/runs/42285796338)
  SUCCESS sulla SHA `0d12276e387d746ef375329b5471223bc40c7a74`;
  Fast CI [42285796201](https://github.com/DarkGh0st03/delegation/actions/runs/42285796201)
  SUCCESS sulla stessa SHA. Originale Engineer approva i soli permessi,
  Orchestrator crea e attesta il branch con root VC/VP a profondità zero;
  Backend riceve Child Rust a profondità uno e il modello ADK scriptato
  invoca `update_file` via SDK A2A reale e staging Unix privato.
  Gateway verifica VP/OPA, committa realmente tramite Gitea HEAD CAS;
  riceve e verifica MAC indipendente prima di completare il Task.
  Il report A2A non sblocca dipendenze. 2 Task registrati,
  **2 completati con evidenza indipendente**, main invariata e nessun
  codice funzionale preinserito; il contenuto del singolo file Backend
  è ancora predisposto nel modello di prova (NON generato).
  Nessuna chiamata Gemini a pagamento. Il trasporto del read preliminare
  durante il Planning resta fixture, pur leggendo main reale.
- **R357.3 — publisher e vincoli di lettura operational (gate parziale):**
  `GatewayRuntime` ora può ricevere il publisher già esistente
  `TrustedGatewayGiteaReadEvidencePublisher` solo tramite opt-in
  dell'owner e verifica la sua identità rispetto al Gateway originale;
  in caso di mismatch o assenza, l'esecuzione resta negata. Il publisher
  richiede un `pinned_revision` SHA-40 uguale alla revisione realmente
  letta, un `GiteaExecutor` originale con witness in memoria, un
  `read_file` autorizzato dopo VP/OPA e Task/Child con flight, e
  confronta HEAD, blob e byte con un **secondo** client Gitea read-only
  prima di sigillare MAC e fsync della ricevuta. Due pubblicazioni
  concorrenti e tentativi replay sono negati. Test unitari con
  admissions simulate (NON prova nativa di read nel Backend).
  [Gateway CI 42289869434](https://github.com/DarkGh0st03/delegation/actions/runs/42289869434)
  SUCCESS. Nessun Gemini a pagamento.
- **Prossima integrazione R357.4/R358, obbligatoria per il gate unico:**
  il `read_file` deve essere veramente stadiato dal **medesimo owner**
  con un pin HEAD ottenuto e conservato in modo fidato, mai scritto dal
  modello o inferito da `update_file`. L'attuale Task Backend
  `update_file` dispone di una sola flight mutativa e non può ancora
  comporre nello stesso Task una lettura attestata seguita dal CAS:
  serve un journal di effetti sequenziali read → update che non consenta
  riuso di nonce, tentativi ambigui o avanzamento dopo HEAD cambiato.
  Collegare il read al Tool ADK entro grants espliciti `read_file`
  e `update_file` firmati dall'Engineer, senza riciclare il read del
  Planning. Poi sostituire il contenuto scriptato con edit ricavati
  esclusivamente dai file effettivamente letti, estendere a Frontend,
  Test, recovery e Draft PR nella stessa sessione branch-first.
  I test fixture e il publisher da soli NON sono autonomia Gemini.
  Completare MCP/discovery e diagnostica sanificata senza hardening
  non bloccante; solo Account Suspension, PR #38 Draft e zero paid Gemini
  senza consenso esplicito.

Non avviare suite native complete a ogni commit. Usare test mirati e Fast CI;
riservare la prova nativa a checkpoint di integrazione significativi. PR #38 Draft,
nessun merge o modifica di main.
