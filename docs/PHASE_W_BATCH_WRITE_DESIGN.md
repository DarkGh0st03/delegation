# Fase W — Scritture multiple atomiche: progetto, invarianti e semantica

**Stato:** documento di progetto. Nessuna implementazione finché il progetto non viene approvato.
**Branch:** `feature/batch-write-design` (da `main` @ `b3222ee1`, dopo il merge della Fase R, PR #42).
**Fuori ambito:**
- parallelismo dei Task, sottodelega ricorsiva, Trusted Agent Registry on-chain;
- modifiche al resolver DID, agli smart contract, al formato delle credenziali e al core crittografico Rust;
- API a pagamento.

## 1. Obiettivo

Un Task con R letture e W scritture (creazioni e/o modifiche di file) deve essere eseguito con:
- **una VP per il batch di letture** (Fase R, già integrata);
- **una VP per il batch di scritture**;
- **OPA e binding applicativo per ogni operazione**;
- **una sola pubblicazione atomica** sul branch di lavoro, tramite un unico HEAD-CAS.

Esempio, 10 letture e 3 modifiche:

| Percorso (stesso Task con 10 letture e 3 scritture) | Verifiche VP complete | Commit sul branch di lavoro |
|---|---|---|
| Verifica singola per ogni operazione | 13 | 3 |
| Letture in batch (Fase R) + scritture singole | 1 + 3 = 4 | 3 |
| **Fase W, modalità standard** | **2** | **1** |
| Fase W, modalità rigorosa (§4.4, D3) | 3 | 1 |

Questi numeri sono teorici e non ancora misurati. Oggi un Task ammette una sola scrittura, quindi le 3 modifiche richiedono 3 Task distinti, ciascuno con le proprie letture.

## 2. Percorso attuale (baseline, resta disponibile)

- **Forma del grant:** `readWriteGrantShape` (`plan-contracts/src/gitea-permission-containment.mjs`) ammette 1–15 `read_file` più **esattamente una** scrittura, cioè un `update_file` di un file letto oppure un `create_file` di un file nuovo. Al massimo 16 permessi per Task (`adk-decision-proposer.mjs:377`, `stager` `total_effects ≤ 16`).
- **Sequenza del proprietario:** `TrustedAuthorityOnlySequentialReadUpdateStager` esegue `read_ready → read_pending → … → read_verified → mutation_pending → finalized`. Ha un solo flight attivo per Task e un'evidenza concatenata (`previous_evidence_sha256`).
- **Scrittura:**
  1. Prepare `update_file`/`create_file`: il contenuto è nella richiesta, legato dalla `request_fingerprint`;
  2. staging del proprietario: intent CAS durevole (`TrustedAuthorityOnlyGiteaMutationPreflight.stageUpdate` / `CreatePreflight.stageCreate`) e flight;
  3. VP con un permesso;
  4. Execute: Rust → OPA → binding (`assertTrustedCompletedMutationEvidenceBinding` / `assertTrustedCreateNativeAdmissionBinding`) → executor.
- **Executor** (`TrustedAuthorityOnlyGiteaMutationExecutor`): `reserveAttempt` durevole, poi `GiteaClient.updateFileWithHeadCas`:
  1. ref privato `feature/r302-internal-<hash>` creato alla HEAD fissata;
  2. commit del file sul ref privato;
  3. verifica del parent e del contenuto;
  4. `PUT /branches/{branch}` con `old_commit_id` (CAS);
  5. rilettura.
  Seguono la ricevuta HMAC (`publisher`), l'osservazione indipendente (`observer`), `reserveCompletedEvidence` e l'attestazione del proprietario. Un tentativo solo: un esito ambiguo è terminale.

## 3. Progetto della Fase W

### 3.1 Forma del grant: `readsWriteSetGrantShape`

Una nuova forma, aggiuntiva alla baseline, che non la sostituisce:
- 0–15 `read_file` di file distinti;
- 1–W_MAX scritture su percorsi distinti. Ogni scrittura è:
  - un `update_file` di un file **letto nello stesso Task**, invariato rispetto a oggi;
  - oppure un `create_file` di un file **non letto e assente alla HEAD fissata**, invariato rispetto a oggi;
- totale ≤ 16 permessi (limite attuale; vedi D2), nessun altro permesso;
- vincoli di ruolo invariati: le applicazioni scrivono file applicativi, il Test Agent crea o ripara solo sorgenti di test del profilo del progetto (`isProjectTestSource`), OPA `forbidden_path` resta per operazione.

Con W = 1 la forma coincide con la baseline. Il percorso a scrittura singola resta il default e la baseline sperimentale (`DELEGATION_BATCH_WRITES=0`).

### 3.2 Flusso

```
letture (Fase R: 1 VP, N Execute)              ← invariato
  │
  ▼  l'agente produce TUTTE le W modifiche in un solo tool: write_files
Prepare write-batch  ── N record ordinari update/create (prepareAuthorization invariato),
  │                     stessa challenge, contenuti legati dalla fingerprint per file
  ▼
staging del proprietario: UN "write-set flight" durevole con W effetti
  │   (intent CAS per file: blob atteso per gli update, prova di assenza per i create)
  ▼
1 VP con i W permessi divulgati
  │
  ▼  per ogni elemento, in sequenza:
Execute(i) ── consumo monouso → (i = primo) verifyMultiple su W permessi │ (i > primo) riuso VP identica
          ── OPA(i) ── binding(i) con write-set flight e intent(i)
          ── NESSUNA scrittura sul provider: l'elemento è "convalidato"
  │
  ▼  Execute(ultimo elemento) ⇒ PUBBLICAZIONE (dentro l'Execute, dopo OPA e binding dell'ultimo)
  1. ricontrollo: batch non fallito, tutti i W elementi convalidati, finestra del batch,
     Root attiva (#live), Child non scaduta, record non scaduti  [modalità rigorosa: nuova verifyMultiple]
  2. reserveAttempt durevole dell'intero write-set (prima di qualunque chiamata Gitea)
  3. ref privato da HEAD fissata → UN commit con le W modifiche (API ChangeFiles di Gitea;
     sha del blob atteso per ogni update, create che fallisce se il file esiste)
  4. verifica dell'ESATTO insieme: parent = HEAD fissata; file cambiati del commit = esattamente
     i W percorsi autorizzati, con lo stato atteso (modified/added); contenuto di ognuno = sha256 dell'intent
  5. ricontrollo immediato di Root, Child e HEAD del branch di lavoro = HEAD fissata
  6. UNICO HEAD-CAS: PUT /branches/{work} {old_commit_id: HEAD fissata, new_commit_id: commit}
  7. rilettura del branch e di ogni file al nuovo commit
  8. per OGNI file: ricevuta HMAC + osservazione indipendente + evidenza durevole
  │
  ▼
attestazione del proprietario per ogni scrittura (sequenze reads+1 … reads+W) → finalizzazione del Task
```

### 3.3 Componenti coinvolti

| Componente | Modifica |
|---|---|
| `plan-contracts/.../gitea-permission-containment.mjs` | `readsWriteSetGrantShape` (nuova); `readWriteGrantShape` invariata |
| Proposer, adaptive loop, review host (`orchestrator-runtime`, `orchestrator`) | accettare Task con W > 1 solo con l'opzione attiva; limite di 16 permessi invariato |
| `trusted-authority-only-admissions.ts` | manifest con `effect_plan` di R letture + W scritture; nuovo **write-set flight** (W effetti riservati insieme, sequenze contigue); binding per elemento; attestazione per file in ordine; finalizzazione |
| `trusted-authority-only-sequential-read-update-stager.ts` | stati `writes_pending → writes_validated → published → finalized`; un solo write-set attivo |
| Preflight update/create | riuso per file (`stageUpdate` / `stageCreate`) con lo stesso ref privato del write-set |
| Nuovo `trusted-write-batch.ts` (Gateway) | `prepareWriteBatch`, `TrustedWriteBatchStore`, stato del batch, verifica/riuso VP (come Fase R), condizione di pubblicazione |
| Nuovo executor write-set | `reserveAttempt` del write-set, `GiteaClient.commitFilesWithHeadCas` (ChangeFiles + verifica dell'insieme + CAS), publisher/observer per file |
| `gitea-client.ts` | `commitFilesWithHeadCas`: ref privato, commit multi-file, verifica diff/parent/contenuti, CAS |
| Evidence publisher/observer | ricevuta e osservazione per file, legate al commit comune e al `write_set_digest` |
| `execute.ts` | ramo write-batch analogo al read-batch; invalidazione del batch per qualunque errore (come R-F3) |
| Client e strumento (`gateway-tool-client.ts`, `adk-specialized-agents.ts`) | `writeFiles(changes[])` e tool `write_files` (un turno del modello); `update_file`/`create_file` nascosti quando attivo |
| Console e modelli scripted | opzione `enableBatchWrites`, `DELEGATION_BATCH_WRITES=0` per la baseline; piano scripted con Task multi-scrittura |
| OPA | **invariata**: valutata per ogni operazione con l'input attuale |

## 4. Semantica di atomicità

### 4.1 Unità atomica

L'unità atomica è **l'insieme delle W scritture di un Task**.
- Sul branch di lavoro esistono soltanto due stati osservabili:
  - la HEAD fissata, nessuna modifica applicata;
  - il nuovo commit, tutte le W modifiche applicate.
- Il passaggio avviene con una sola compare-and-swap del ref (`old_commit_id`), quindi un osservatore del branch non vede mai un sottoinsieme.
- L'atomicità **non** si estende oltre il Task: Task diversi restano sequenziali e producono commit distinti.

### 4.2 Esiti

| Momento del fallimento | Effetto sul branch di lavoro | Stato |
|---|---|---|
| Prepare, staging, VP, Execute(i): OPA, binding o verifica | nessuno | batch e Task falliti, nessuna chiamata di scrittura a Gitea |
| Commit sul ref privato, verifica dell'insieme, ricontrollo prima del CAS | nessuno; può restare un ref privato | terminale, ref privato da riconciliare |
| CAS rifiutato (HEAD avanzata) | nessuno | terminale (`provider_conflict`), nessun retry |
| Risposta del CAS persa o ambigua; rilettura incoerente | sconosciuto: tutto o niente, mai parziale | **terminale**: nessun retry automatico, riconciliazione manuale (come oggi) |
| Dopo un CAS riuscito: ricevuta o osservazione di un file fallita | tutte le W modifiche pubblicate | Task fallito, non concluso; le evidenze mancanti bloccano la finalizzazione |

L'ultimo caso è la differenza principale rispetto alla baseline, dove ogni file ha il proprio commit. Qui la pubblicazione è già avvenuta, ma il Task non viene attestato e non sblocca dipendenze né PR. È lo stesso comportamento di oggi per un singolo file la cui evidenza fallisce dopo il CAS.

### 4.3 Esatto insieme autorizzato

Prima del CAS il commit privato deve soddisfare **tutte** queste condizioni:
1. ha come unico parent la HEAD fissata;
2. il suo elenco di file modificati è **esattamente** l'insieme dei W percorsi firmati: nessun file in più, in meno o rinominato;
3. lo stato di ogni file è quello atteso: `modified` per un update, `added` per un create;
4. il contenuto di ogni file ha lo sha256 e la lunghezza in byte dell'intent, legati alla `request_fingerprint` del record;
5. per un update, il blob alla HEAD era quello fissato al momento dello staging; per un create, il file era assente alla HEAD;
6. nessun contenuto è identico all'originale (stessa regola di oggi: nessun effetto vuoto).

### 4.4 Revoca e scadenza prima della pubblicazione

- **Per elemento**, a ogni Execute (invariato): consumo monouso, scadenza del record, OPA, binding, Root attiva e Child non scaduta.
- **Immediatamente prima del CAS** (punti 1 e 5 del §3.2): Root attiva (`#live`, include il ritiro della sessione da parte dell'Engineer), Child non scaduta, finestra del batch, HEAD del branch invariata.
- **Revoca on-chain:**
  - **modalità standard:** osservata dalla `verifyMultiple` del primo Execute. La pubblicazione deve avvenire entro la finestra del batch: al massimo 60 s dal Prepare, come in Fase R, e in pratica pochi secondi. È lo stesso compromesso dichiarato per le letture;
  - **modalità rigorosa** (opzione D3): una seconda `verifyMultiple` della stessa VP subito prima del CAS. Costa circa 1,5 s per write-batch e rende la revoca on-chain osservata immediatamente prima dell'effetto.

## 5. Invarianti da preservare

| # | Invariante | Come è garantito |
|---|---|---|
| W1 | Prepare legato al ruolo | Nuovo endpoint nella stessa fetch in-process legata al ruolo; Execute solo sui record del ruolo |
| W2 | Permesso derivato dal Gateway | Ogni elemento passa da `prepareAuthorization` invariato; la verifica usa i permessi del batch derivati dal Gateway |
| W3 | Ogni scrittura appartiene al grant firmato del Task | `readsWriteSetGrantShape` nella Child e nelle admissions; il batch deve coprire **esattamente** l'insieme firmato |
| W4 | Update solo di file letti nel Task; create solo di file non letti e assenti alla HEAD | Regole attuali dello stager e dei preflight, per file |
| W5 | Una VP per il batch, verifica crittografica completa | `verifyMultiple` del core invariato; riuso solo per la VP identica byte per byte |
| W6 | OPA e binding per ogni operazione | Ogni Execute valuta OPA e il binding con il write-set flight e l'intent del file |
| W7 | Staging isolato | Le modifiche esistono solo sul ref privato finché il CAS non riesce; agenti e Gateway non possono scegliere quel ref |
| W8 | Esatto insieme pubblicato | Verifiche del §4.3 prima del CAS; rilettura dopo |
| W9 | Atomicità | Un commit e un `old_commit_id` CAS per l'insieme; nessuna pubblicazione parziale osservabile |
| W10 | Evidenze per file | Ricevuta HMAC, osservazione indipendente ed evidenza durevole per ogni file; attestazione per file, in ordine |
| W11 | Journal durevole prima di ogni effetto | Manifest, write-set flight e `reserveAttempt` dell'insieme fsync'd prima di qualunque chiamata di scrittura a Gitea |
| W12 | Fail-closed e stato terminale | Batch e Task falliti per qualsiasi errore; `failed` terminale (come R-F1 e R-F3); nessun retry dopo il primo tentativo |
| W13 | Anti-replay ed esiti ambigui | `request_id` monouso, batch e ref privato derivati dall'hash del write-set; un esito ambiguo del CAS è terminale |
| W14 | Scadenza e revoca prima della pubblicazione | §4.4 |
| W15 | Esecuzione sequenziale dei Task | Invariato; un solo write-set attivo per Task e un solo Task attivo |
| W16 | Nessuna nuova autorità | Credenziali, OPA e core invariati; il batch raggruppa solo scritture già firmate nel Task |
| W17 | Baseline disponibile | Con W = 1 o `DELEGATION_BATCH_WRITES=0` il percorso è quello attuale |

## 6. Rischi

| Rischio | Mitigazione |
|---|---|
| Modifica di `trusted-authority-only-admissions.ts` (2.231 righe, critica): il write-set flight rompe l'invariante "un flight attivo" | Nuovo tipo di flight esplicito con W effetti, invece di più flight concorrenti; test dedicati; nessuna modifica ai percorsi esistenti |
| Semantica dell'API multi-file di Gitea (ChangeFiles): stato `added`/`modified`, guardia sha, comportamento su file esistente | Spike W0 sul Gitea locale prima dell'implementazione. Se l'API non offre garanzie sufficienti: N commit sequenziali sul ref privato e un solo CAS finale (atomicità sul branch invariata; storia con N commit) |
| Verifica del diff: l'elenco dei file del commit dipende dall'API | Doppio controllo: elenco del commit **e** confronto `compare` HEAD…commit; rilettura di ogni file |
| Pubblicazione avvenuta ma evidenza fallita (§4.2, ultimo caso) | Task non finalizzato, PR non creata, riconciliazione documentata; test dedicato |
| Il modello deve produrre W contenuti in un solo turno (dimensione dell'output) | W_MAX iniziale piccolo (D1); il limite di token per chiamata resta quello attuale |
| Riparazioni dopo un FAIL del Runner con W > 1 | Il Task di riparazione resta a scrittura singola (baseline) finché non viene deciso altrimenti |
| Finestra di revoca on-chain (modalità standard) | Dichiarata; modalità rigorosa disponibile (D3) |
| Riavvio del processo a metà write-set | Come oggi: il journal durevole rende il Task terminale; nessuna ripresa automatica |

## 7. Decisioni da prendere prima dell'implementazione

- **D1, W_MAX per Task.** Proposta: 8, con il totale sempre ≤ 16 permessi.
- **D2, limite di 16 permessi ed effetti per Task.** Proposta: invariato nella Fase W, così da non toccare proposer, review host e console oltre il necessario.
- **D3, modalità di revoca prima del CAS.** Proposta: standard (1 verifica) come default, rigorosa (2 verifiche) come opzione misurata nell'E2E.
- **D4, interfaccia del modello.** Proposta: un solo tool `write_files` con l'insieme completo. In alternativa, `update_file`/`create_file` che accumulano e un `commit_changes` finale (più turni, più flessibile).
- **D5, insieme parziale.** Proposta: rifiutato. L'agente deve presentare esattamente l'insieme firmato, come oggi il manifest richiede tutti gli effetti pianificati. Il "no change" resta il percorso attuale (`reportNoChange`).

## 8. Test necessari

**Unit, plan-contracts:** `readsWriteSetGrantShape` con:
- update di file letti, create di file nuovi, mix;
- duplicati, update di un file non letto, create di un file letto;
- oltre W_MAX o 16 permessi, permessi estranei;
- vincoli del Test Agent.

**Unit, Gateway (`trusted-write-batch`, `execute`):**
- batch valido: 1 `performed` e W − 1 `reused`, nessuna scrittura prima dell'ultimo elemento;
- per ognuno tra OPA, binding, scadenza, replay, VP diversa e verifica: il batch fallisce e **nessuna** chiamata di scrittura arriva al client Gitea;
- prima verifica concorrente; stato `failed` terminale;
- ricontrollo prima del CAS: Root revocata, Child scaduta, finestra scaduta → nessun CAS;
- modalità rigorosa: VP revocata (verificatore simulato) → nessun CAS.

**Unit, `GiteaClient.commitFilesWithHeadCas`** (Gitea simulato):
- parent errato;
- file in più, in meno o rinominato;
- stato atteso errato;
- contenuto diverso;
- blob dell'update cambiato; file del create già esistente;
- HEAD avanzata prima del CAS (`provider_conflict`);
- risposta del CAS persa (ambigua, terminale);
- nessun retry.

**Integrazione su Gitea locale reale (spike W0 + regressione):**
- commit multi-file;
- diff esatto;
- CAS che fallisce se il branch avanza tra commit e CAS;
- il branch di lavoro non mostra mai un sottoinsieme.

**Owner e IPC (stager reale + IPC Unix reale):**
- ordine degli eventi;
- write-set staging unico;
- attestazioni per file in ordine;
- chiamate non conformi (attestazione prima della pubblicazione, secondo write-set, scrittura dopo un fallimento) rifiutate.

**E2E scripted comparativo**, senza API a pagamento: protocollo della Fase R (stack riavviato per esecuzione, riscaldamento scartato, ordine casuale con seme, n = 6 per cella):
- varianti: baseline a scrittura singola (`DELEGATION_BATCH_WRITES=0`) contro batch;
- workload: Task con W = 3 e W = 8 scritture, più letture;
- metriche: verifiche complete, Σ `verification_ms`, numero di commit e di CAS sul branch, tempo della fase di scrittura, tempo complessivo dalla firma al completamento;
- osservabilità: `write_batch_id` e `batch_verification` nelle decisioni, `write_set_digest` e commit nelle evidenze.

**Regressione:** tutte le suite Node, OPA 52/52 e core Rust, nessuna regressione rispetto a `main`.

## 9. Piano di lavoro proposto (dopo l'approvazione)

1. **W0, spike:** API multi-file e diff su Gitea 28 locale; esito documentato prima di scrivere il codice di produzione.
2. **W1, forma del grant e admissions:** write-set flight, manifest e attestazioni per file, con unit test.
3. **W2, Gateway:** write-batch, `commitFilesWithHeadCas`, executor, evidenze per file, invalidazione e ricontrolli prima del CAS.
4. **W3, client e strumento:** `write_files`, console, modelli scripted, opzione e baseline.
5. **W4, test, suite ed E2E** comparativo; report dei risultati sul modello di `PHASE_R_RESULTS.md`.

Il merge su `main` avverrà solo dopo la revisione dei risultati, come per la Fase R.
