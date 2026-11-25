# Fase R — Risultati: letture multiple operative con una sola VP

**Branch:** `feature/batch-read-authorization` (implementazione `a3d8a658`, progetto `152327b9`). `main` invariato (`97547d24`).
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
