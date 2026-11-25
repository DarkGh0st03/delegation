# Fase R — Risultati: letture multiple operative con una sola VP

**Branch:** `feature/batch-read-authorization` (implementazione `a3d8a658`, progetto `152327b9`, correzioni della revisione `740d9bc9`). `main` invariato (`97547d24`).

> Le sezioni 1–4 descrivono la prima campagna (k = 2, `f4735c57`). La revisione (R-F1, R-F2, R-F3) e la campagna con k = 5 e k = 15 sono nelle sezioni 5 e 6.
**Progetto e invarianti:** `docs/PHASE_R_BATCH_READ_DESIGN.md` (R1–R13).
**Dati grezzi e script:** `docs/experiments/phase-r-e2e/` (`raw/`, `scripts/`).
Nessuna API a pagamento: tutte le sessioni sono in modalità `scripted`, con `GEMINI_API_KEY` vuota. Core Rust, resolver DID e smart contract non sono stati modificati.

## 1. Test positivi e negativi

| Suite | Prima | Dopo | Note |
|---|---|---|---|
| gateway | 222 | 232 | +10 `trusted-read-batch.test.ts` |
| agent-runtime | 213 | 216 | +3 `adk-batch-read-tool.test.ts` |
| orchestrator-runtime | 327 | 330 | +3 `batch-read-owner-ipc-tool-client.test.ts` (IPC Unix reale + stager reale) |
| plan-contracts, console, orchestrator, mcp-shared, runner | 27 / 61 / 74 / 26 / 50 | invariati | |
| OPA | 52/52 | 52/52 | policy non modificata |
| core Rust | 82/82 | 82/82 | codice non modificato |

**Casi negativi coperti** (fail-closed; in ogni caso nessun elemento successivo del batch esegue):
- forma errata;
- percorsi duplicati, meno di 2 o più di 15;
- permesso dichiarato dal chiamante;
- Gateway senza admissions authority-only;
- elemento fuori Task, con i record già preparati bruciati;
- VP diversa su un elemento successivo;
- VP rifiutata da Rust;
- batch scaduto;
- record estraneo al batch;
- `verifyMultiple` assente;
- prima verifica concorrente.

Non sono stati ripetuti nell'E2E dal vivo: i casi negativi sono coperti a livello unitario e di integrazione IPC, mentre l'E2E misura i percorsi positivi.

## 2. E2E scripted comparativo

**Configurazione:**
- **Immagine e stack:** immagine `delegation-app:phase-r` (`delegation-app:local` + `poc/` di `a3d8a658`); stack compose completo (Anvil, did:ethr, Gitea, OPA, Runner, staging).
- **Sessione:** repository `campus-library`; requisito "Add a genre filter to the book list: users can filter books by genre in the API and in the UI, with tests."; 9 permessi approvati; 12 decisioni Gateway per sessione.
- **Varianti:**
  - **batch**: `DELEGATION_BATCH_READS=1`;
  - **baseline a verifica singola**: `DELEGATION_BATCH_READS=0`, stesso container riavviato.
- **Ripetizioni:** 3 per variante. Tutte le 6 sessioni sono `completed`, con Draft PR aperta e tutte le decisioni `allow`.

**Applicabilità del batch** in questo workload. Il batch richiede almeno 2 letture firmate nel Task:
- Orchestrator: 1 lettura → percorso singolo;
- Data: 1 lettura → percorso singolo;
- 2 Task Test con 2 letture ciascuno → batch con k = 2.

### 2.1 Costo dell'autorizzazione (lato Gateway, `verification_ms` per decisione)

| Run | Verifiche complete | Riusate (VP identica) | Σ verifiche (s) | Σ verifiche delle letture (s) | Σ OPA (ms) |
|---|---|---|---|---|---|
| batch-1 | 10 | 2 | 13,77 | 5,66 | 40,3 |
| batch-2 | 10 | 2 | 13,45 | 5,54 | 34,5 |
| batch-3 | 10 | 2 | 13,54 | 5,44 | 35,5 |
| single-1 | 12 | 0 | 16,75 | 8,64 | 39,7 |
| single-2 | 12 | 0 | 16,92 | 8,76 | 41,5 |
| single-3 | 12 | 0 | 16,47 | 8,44 | 30,3 |

- **Verifica.** Mediana Σ verifiche: 16,75 s nella baseline contro 13,54 s nel batch, cioè −3,2 s (−19%). Sulle sole letture: 8,64 s contro 5,54 s (−36%).
- **Riuso.** Una verifica riusata costa circa 0,05 ms (confronto SHA-256 della VP); una verifica Child completa costa circa 1,5 s.
- **OPA.** Resta valutata a ogni decisione: 12 per sessione in entrambe le varianti.
- **Tool lato agente, Task Test con k = 2** (`adk_tool_timing`, Prepare + firma + Execute + attestazione):
  - baseline: due `read_file`, mediana 3,63 s per Task;
  - batch: un `read_files`, mediana 1,84 s per Task;
  - rapporto ≈ 1,98×, coerente con lo speedup ≈ k della Fase 1b.

### 2.2 Tempo complessivo del workflow

| Run | Planning (s) | Esecuzione, firma → completamento (s) |
|---|---|---|
| batch-1 | 10,1 | 50,3 |
| batch-2 | 2,1 | 36,2 |
| batch-3 | 7,1 | 36,2 |
| single-1 | 9,1 | 46,3 |
| single-2 | 8,1 | 39,3 |
| single-3 | 7,1 | 36,2 |

- **Mediane dell'esecuzione:** 36,2 s nel batch contro 39,3 s nella baseline.
- **Il tempo complessivo non distingue le varianti.** Il risparmio atteso è di circa 3 s per sessione (§2.1), ma con n = 3 e un campionamento di stato a 1 s la differenza non è distinguibile dal rumore:
  - la prima sessione dopo l'avvio è più lenta in entrambe le varianti (50,3 s e 46,3 s);
  - batch-3 e single-3 coincidono (36,2 s).
- **Cosa domina il tempo.** Il tempo complessivo è dominato da componenti che il batch non tocca: scritture, Runner, Gitea, PR e orchestrazione. In questo workload solo 4 delle 12 decisioni sono letture in batch.
- **Conclusione:** il beneficio misurato riguarda il costo di autorizzazione e la fase di lettura dei Task con più letture. Il vantaggio sul workflow cresce con il numero di letture per Task, fino a 15, e con il numero di Task di questo tipo, ma qui non è stato misurato con significatività.

## 3. Invarianti verificati

Riferimenti a `PHASE_R_BATCH_READ_DESIGN.md` §3:
- **R1–R5** (ruolo, permessi derivati, appartenenza al Task, unicità e limite 15, HEAD fissata): ogni elemento passa dall'invariato `prepareAuthorization`; coperti da unit test. Nell'E2E le letture del batch hanno superato staging e binding come quelle singole.
- **R6** (verifica crittografica completa): una sola `verifyMultiple` del core, invariato, su tutti i permessi del batch.
- **R7** (OPA per ogni operazione): 12 valutazioni per sessione in entrambe le varianti.
- **R8** (monouso e anti-replay): ogni `request_id` è consumato; una VP diversa o un record estraneo vengono rifiutati.
- **R9** (scadenza): la scadenza del batch è testata; la Root attiva e la Child sono controllate per elemento.
- **R10** (fail-closed): coperto dai test negativi.
- **R11** (journal ed evidenze): una ricevuta e un'attestazione per lettura; l'ordine degli eventi è verificato nel test IPC.
- **R12** (esecuzione sequenziale): nessuna concorrenza; la prima verifica concorrente viene rifiutata.
- **R13** (nessuna nuova autorità): nessuna modifica a credenziali, grant, OPA o core.

**Differenza semantica dichiarata, invariata:** la revoca viene osservata una volta per batch, entro il TTL del Prepare.

## 4. Limiti e questioni aperte

- **Workload:** k = 2 soltanto. Mancano un E2E con Task da 5–15 letture e un numero di ripetizioni sufficiente per un test sul tempo complessivo.
- **Strumentazione:** gli eventi di audit `read_batch_id` / `batch_verification` sono nel sink di audit in memoria del Gateway e non esposti dalla console. Il riuso è osservato tramite `verification_ms` ≈ 0,05 ms e `adk_tool_timing.batch_size = 2`.
- **Costo di avvio dei processi:** lo startup dei processi `node` del resolver did:ethr resta non isolato, come già annotato nella Fase 1b.
- **Fase W:** non avviata, in attesa della revisione di questi risultati.

## 5. Revisione: correzioni R-F1, R-F2, R-F3 (`740d9bc9`)

| Punto | Problema | Correzione | Test |
|---|---|---|---|
| R-F1 | Una seconda verifica concorrente portava il batch a `failed`, ma la prima `verifyMultiple` ancora pendente poteva poi riportarlo a `verified` | `failed` è terminale: al termine della verifica, se lo stato non è più `verifying`, la verifica viene rifiutata | primo, secondo e terzo elemento rifiutati; il verificatore viene chiamato una sola volta |
| R-F2 | La finestra di riuso era pari al TTL del Prepare (20 min per il Test Agent) | Finestra propria del batch di 60 s (`READ_BATCH_TTL_MS`, configurabile solo verso il basso). La scadenza di ogni record del batch viene ridotta alla finestra | finestra di 60 s anche con TTL di 20 min; scadenza a metà batch che ferma gli elementi rimanenti e termina il batch; revoca dopo la verifica |
| R-F3 | Il batch veniva invalidato solo da un fallimento della verifica crittografica | `executeAuthorization` invalida il batch per **qualsiasi** errore di un suo elemento: verifica, scadenza, OPA, binding, provider, ricevuta, replay o VP diversa | Gateway: per ognuno di OPA, binding, provider e ricevuta, un client non conforme che prosegue riceve `verification_rejected` sugli elementi successivi; anche un fallimento sul primo elemento, un replay o una VP estranea terminano il batch. Proprietario (IPC Unix reale + stager reale): dopo un Execute negato o un'attestazione fallita, staging, attestazione e scrittura vengono rifiutati anche se chiamati direttamente |

**Controllo per mutazione.** Ho ripristinato il codice precedente alle correzioni e rieseguito i nuovi test: falliscono 7 test su 11 senza la correzione di `execute.ts` e 5 test senza quelle di `trusted-read-batch.ts`.

**Finestra di riuso e semantica di revoca.** Da dichiarare nella tesi come compromesso esplicito tra prestazioni e freschezza dell'autorizzazione; il batch non è equivalente a una verifica aggiornata della revoca per ogni lettura.
- La VP del batch viene verificata **una volta**, al primo Execute. In quel momento il core Rust controlla anche lo stato di revoca on-chain della catena.
- Gli elementi successivi riusano il risultato solo per la VP identica byte per byte ed entro la finestra del batch: **al massimo 60 s dal Prepare** (`READ_BATCH_TTL_MS`). La finestra decorre dal Prepare, non dal momento della revoca.
- Una revoca on-chain della Child o della Root avvenuta dopo la verifica iniziale **non viene ricontrollata** per le letture successive dello stesso batch. Diventa efficace al più tardi alla scadenza della finestra; ogni batch successivo verifica di nuovo e la osserva.
- Restano invece controllati **per ogni lettura** (admissions `#live` e `expires_at`): il ritiro della sessione e della Root operativa da parte dell'Engineer, la scadenza della Root e della Child, la scadenza del record.
- Con la verifica singola lo stato di revoca viene osservato a ogni lettura; questo è il percorso baseline, sempre disponibile (`DELEGATION_BATCH_READS=0`).

**Natura delle prove sulla revoca.**
- Il test "on-chain revocation after the batch verification…" (`trusted-read-batch-fail-closed.test.ts`) usa un **verificatore simulato** che, dopo la prima verifica, comincia a rifiutare. Dimostra la semantica del Gateway (riuso entro la finestra, rifiuto dopo, nuova verifica per un nuovo batch). **Non** è una prova E2E di revoca intermedia sulla blockchain reale.
- La revoca on-chain osservata dal core (Status List aggiornata su `IssuerRegistry`, Anvil) è stata misurata nella Fase 1b come caso negativo con **Root revocata on-chain** (`RESULTS_PHASE1B.md` sul branch `experiment/multi-permission-verification-benchmark`): la verifica immediatamente successiva la osserva. Non è stata eseguita un'E2E con revoca on-chain **durante** un batch del workflow operativo.

**Revoca, comportamento verificato:**
- **Revoca on-chain della Child dopo la verifica del batch:** gli elementi dello stesso batch continuano a riusare la verifica fino alla scadenza della finestra, al massimo 60 s dal Prepare. Dopo la scadenza vengono rifiutati, e un nuovo batch ripete la verifica e osserva la revoca.
- **Ritiro della Root operativa e scadenza della Child:** restano controllati per elemento dalle admissions (`#live`, `expires_at`) in staging, binding e attestazione. Non ho aggiunto test specifici, perché questi controlli valgono già per le letture singole e sono coperti dai test esistenti sulle admissions reali.
- **Un limite dichiarato:** il fixture IPC modella l'osservatore di completamento con una ricevuta per richiesta. Nel sistema reale l'attestazione richiede `observer.observe` sulla ricevuta HMAC del Gateway (`trusted-authority-only-admissions.ts`, `attestTrustedSequentialReadEffect`); il caso dell'osservatore che fallisce è coperto dal test esistente "bogus completion observer fails closed".

**Osservabilità.** Le decisioni Gateway della console (`gateway_decisions`) espongono `read_batch_id` e `batch_verification` (`performed` / `reused`). Il riuso non si deduce più dalla latenza.

**Test aggiornati.** Gateway 243 (+11), orchestrator-runtime 332 (+2), agent-runtime 216, console 61, orchestrator 74, plan-contracts 27, Runner 50, mcp-shared 26. OPA e core Rust non sono stati modificati.

## 6. E2E scripted con k = 5 e k = 15 (`740d9bc9`)

**Repository di benchmark.** `thesis/batch-bench`, creato nel Gitea locale con le stesse protezioni degli import della console (`k5-k15/scripts/seed-batch-bench.mjs`). Contiene 4 moduli `src/ledger/*`, 14 moduli `src/inventory/*` e `test/ledger.test.js`, `test/inventory.test.js`.
- **k = 5**, requisito "Ledger: record each change": 13 permessi, 4 Task backend con k = 1, un Task Test con 5 letture + 1 update, `run_tests`, PR; 18 decisioni per sessione.
- **k = 15**, requisito "Inventory: record each change": 33 permessi, 14 Task backend, un Task Test con 15 letture + 1 update; 48 decisioni per sessione.
- **Limite del planner scripted:** è di 12 file e l'ho portato a 15 solo per il benchmark (`DELEGATION_SCRIPTED_PLAN_FILES`; il valore predefinito resta 12).

**Protocollo:**
- 6 ripetizioni per cella (2 valori di k × 2 varianti = 24 esecuzioni) in ordine casuale con seme fisso (`make-plan.mjs`, seme 20261125, `plan-campaign.txt`).
- Per ogni esecuzione: stack completo riavviato (Anvil e app insieme), una sessione di riscaldamento scartata, poi la sessione misurata.
- Le due varianti differiscono solo per `DELEGATION_BATCH_READS`.
- **Deviazione dall'ordine casuale:** `batch-k15-5` è fallita all'avvio dell'esecuzione, prima di qualsiasi lettura, con "Protected canonical deployment configuration denied" (conservata in `raw/failed/`). L'ho ripetuta in coda alla campagna.

**Risultati:** 24 sessioni misurate valide su 25 tentativi. Il tentativo fallito (`batch-k15-5`, primo tentativo) resta documentato in `raw/failed/`. Tutte le 24 sessioni valide sono `completed` con Draft PR e tutte le decisioni sono `allow`.
- **Batch:** in ogni sessione una sola verifica `performed`, 4 riusi (k = 5) o 14 (k = 15), un solo `read_batch_id`.
- **Baseline:** nessun campo di batch.
- **OPA:** valutata a ogni decisione (18 o 48) in entrambe le varianti.

Mediane (n = 6 per cella); IC 95% da bootstrap non appaiato della differenza delle mediane (batch − baseline), 10.000 ricampionamenti, generatore mulberry32 con seme 20261125.

> **Correzione del bootstrap.** La prima versione di `analyze-campaign.mjs` usava un generatore congruenziale il cui prodotto poteva superare 2^53 e veniva arrotondato. Ho sostituito il generatore con mulberry32 (aritmetica intera a 32 bit esatta) e ricalcolato gli intervalli offline, senza ripetere esperimenti. Le mediane non cambiano; gli estremi degli intervalli cambiano al più di 0,06 s. Il generatore dell'ordine delle esecuzioni (`make-plan.mjs`) è conservato com'era quando è stato eseguito: è deterministico e `plan-campaign.txt` si riproduce identico.

| k | Metrica | Baseline | Batch | Differenza | IC 95% | Rapporto |
|---|---|---|---|---|---|---|
| 5 | Σ verifiche Gateway per sessione | 27,50 s | 21,36 s | −6,14 s | [−6,60, −5,64] | 1,29× |
| 5 | Σ verifiche delle letture | 15,56 s | 9,34 s | −6,22 s | [−6,54, −5,93] | 1,67× |
| 5 | Fase di lettura del Task Test (tool lato agente) | 9,69 s | 2,32 s | −7,37 s | [−7,49, −7,18] | 4,18× |
| 5 | **Esecuzione, firma → completamento** | **59,31 s** | **50,28 s** | **−9,04 s** | [−9,06, −8,51] | 1,18× |
| 15 | Σ verifiche Gateway per sessione | 75,48 s | 53,87 s | −21,61 s | [−23,26, −19,97] | 1,40× |
| 15 | Σ verifiche delle letture | 47,62 s | 25,51 s | −22,11 s | [−23,21, −20,92] | 1,87× |
| 15 | Fase di lettura del Task Test | 29,03 s | 3,32 s | −25,70 s | [−26,54, −24,81] | 8,73× |
| 15 | **Esecuzione, firma → completamento** | **146,59 s** | **121,52 s** | **−25,07 s** | [−27,11, −24,06] | 1,21× |

**Lettura dei risultati:**
- **Workflow complessivo.** Con k = 5 e k = 15 il vantaggio è misurabile e gli intervalli non includono lo zero: −9 s e −25 s, cioè circa −15% e −17%. Con k = 2 la differenza era nel rumore.
- **Da dove viene il risparmio.** Sul Gateway, k − 1 verifiche Child da circa 1,5 s ciascuna. Lato agente, si risparmiano anche k − 1 round trip di Prepare e di firma e k − 1 turni del modello.
- **Fase di lettura.** Lo speedup del Task Test (4,2× con k = 5, 8,7× con k = 15) supera quello della sola verifica, per la stessa ragione.
- **Verifiche delle letture.** Σ include anche le 4 o 14 letture singole dei Task backend (k = 1), che il batch non tocca.
- **Granularità dei tempi.** I tempi complessivi sono molto stabili (dispersione < 1 s) e quantizzati sul campionamento di stato a 1 s del driver.

**Limiti di generalizzazione.**
- Il workload è scripted, senza modello di IA: i turni del modello hanno costo quasi nullo.
- Le ripetizioni sono 6 per cella, su un solo repository di benchmark e una sola macchina.
- Gli intervalli descrivono questo workload e non si estendono automaticamente ai workflow con Gemini: lì i turni del modello e la loro variabilità pesano di più sul tempo complessivo.

**Questione preesistente, fuori dall'ambito della Fase R** (presente anche su `main`): il fallimento intermittente di `batch-k15-5` nasce nella validazione della configurazione del deployment (`canonical-owner-deployment.mjs`). La causa più probabile, non dimostrata perché le porte non vengono registrate, è `freePort()` in `engineer-console/src/sessions.mjs`: apre e chiude una porta alla volta, quindi due ruoli possono ricevere la stessa porta effimera, e la configurazione rifiuta le porte duplicate. La correzione proposta è riservare tutte le porte prima di chiuderle. Non l'ho applicata.

**File:**
- `docs/experiments/phase-r-e2e/k5-k15/raw/`: JSON delle sessioni, `adk_tool_timing` per esecuzione, log della campagna, `analysis.txt`.
- `docs/experiments/phase-r-e2e/k5-k15/scripts/`: `campaign.sh`, `make-plan.mjs`, `plan-campaign.txt`, `seed-batch-bench.mjs`, `analyze-campaign.mjs`.
- Riproduzione dell'analisi: `node scripts/analyze-campaign.mjs raw` dalla cartella `k5-k15`.
