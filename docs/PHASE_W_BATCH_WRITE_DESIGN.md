# Fase W — Scritture multiple atomiche: progetto, invarianti e semantica

**Stato:** progetto approvato (D1–D5); W0 (§11) e W1 (§12) completate e approvate; **W2 implementata** (§13), in revisione. W3–W4 non sono iniziate.
**Branch:** `feature/batch-write-design` (da `main` @ `b3222ee1`, dopo il merge della Fase R, PR #42).
**Fuori ambito:**
- parallelismo dei Task, sottodelega ricorsiva, Trusted Agent Registry on-chain;
- modifiche al resolver DID, agli smart contract, al formato delle credenziali e al core crittografico Rust;
- API a pagamento.

**Terminologia.** Il meccanismo garantisce una **Atomic Write-Set Publication**: le W modifiche di un Task vengono pubblicate sul branch di lavoro tutte insieme o per niente. **Non** è una transazione distribuita atomica dell'intero workflow (§4.5).

## 0. Decisioni approvate

| # | Decisione |
|---|---|
| D1 | Al massimo **8 scritture** per Task |
| D2 | Limite complessivo invariato: **16 permessi ed effetti** per Task |
| D3 | **Modalità rigorosa come default**: seconda `verifyMultiple` della VP dopo la costruzione e la verifica del commit privato, immediatamente prima del HEAD-CAS. La modalità standard (una sola verifica) resta come variante sperimentale |
| D4 | Un unico tool del modello: `write_files` |
| D5 | Insiemi parziali rifiutati: l'agente presenta esattamente l'insieme firmato |

D1 e D2 sono limiti implementativi del prototipo, non del meccanismo crittografico: `verifyMultiple` accetta fino a 128 permessi.

Combinazioni ammesse, con R letture, U modifiche e C creazioni:

| R | U | C | Ammesso | Motivo |
|---|---|---|---|---|
| 10 | 3 | 0 | sì | 13 ≤ 16, 3 ≤ 8 |
| 8 | 8 | 0 | sì | 16 ≤ 16, 8 ≤ 8 |
| 6 | 4 | 4 | sì | 14 ≤ 16, 8 ≤ 8 |
| 15 | 2 | 0 | no | 17 > 16 |
| 2 | 2 | 7 | no | 9 scritture > 8 |
| 0 | 0 | 3 | sì | sole creazioni, nessuna lettura necessaria (§6) |

Ogni modifica (U) riguarda un file letto nello stesso Task. Ogni creazione (C) riguarda un file non letto e assente alla HEAD fissata.

## 1. Obiettivo

Un Task con R letture e W scritture va eseguito con:
- **una VP per il batch di letture** (Fase R);
- **una VP per il batch di scritture**, verificata due volte in modalità rigorosa;
- **OPA e binding per ogni operazione**;
- **una sola pubblicazione atomica** sul branch di lavoro, tramite un unico HEAD-CAS.

Confronto teorico per lo stesso Task con 8 letture e 5 scritture:

| Percorso | Verifiche VP complete | Commit sul branch |
|---|---|---|
| Verifica singola per ogni operazione | 13 | 5 |
| Letture in batch (Fase R) + scritture singole | 1 + 5 = 6 | 5 |
| Fase W standard (variante sperimentale) | 2 | 1 |
| **Fase W rigorosa (default)** | **3** (−76,9% rispetto a 13) | **1** |

Sono numeri teorici, non misure di latenza. Oggi un Task ammette una sola scrittura, quindi 5 modifiche richiedono 5 Task distinti (§9).

## 2. Percorso attuale (baseline, resta disponibile)

- **Forma del grant:** `readWriteGrantShape` (`plan-contracts/src/gitea-permission-containment.mjs`) ammette 1–15 `read_file` più **esattamente una** scrittura. Esiste inoltre il Task di sola creazione con un solo `create_file`. Al massimo 16 permessi per Task (`adk-decision-proposer.mjs:377`; stager con `total_effects ≤ 16`).
- **Sequenza del proprietario:** `TrustedAuthorityOnlySequentialReadUpdateStager` esegue `read_ready → read_pending → … → read_verified → mutation_pending → finalized`. Ha un solo flight attivo e un'evidenza concatenata (`previous_evidence_sha256`).
- **Scrittura singola:**
  1. Prepare con il contenuto nella richiesta, legato dalla `request_fingerprint`;
  2. staging del proprietario: intent CAS durevole e flight;
  3. VP con un permesso;
  4. Execute: Rust → OPA → binding → executor.
- **Executor:** `reserveAttempt` durevole, poi `GiteaClient.updateFileWithHeadCas` / `createFileWithHeadCas`:
  1. ref di staging isolato creato alla HEAD fissata;
  2. commit del file;
  3. verifica del parent e del contenuto;
  4. `PUT /branches/{branch}` con `old_commit_id`;
  5. rilettura.

  Seguono la ricevuta HMAC, l'osservazione indipendente, `reserveCompletedEvidence` e l'attestazione. Un solo tentativo: un esito ambiguo è terminale.

## 3. Progetto

### 3.1 Forma del grant: `readsWriteSetGrantShape`

È una forma nuova, aggiuntiva alla baseline:
- 0–15 `read_file` distinti;
- 1–8 scritture su percorsi distinti, in totale ≤ 16 permessi, nessun altro permesso;
- `update_file` solo di file letti nel Task;
- `create_file` solo di file non letti, la cui assenza alla HEAD viene provata al momento dello staging;
- 0 letture ammesse solo se tutte le scritture sono creazioni;
- vincoli di ruolo invariati: le applicazioni scrivono file applicativi, il Test Agent crea o ripara solo sorgenti di test del profilo; OPA `forbidden_path` resta per operazione.

Il percorso batch si attiva solo con W ≥ 2 e con l'opzione attiva (§6).

### 3.2 Flusso (modalità rigorosa)

```
letture (Fase R)                                               ← invariato
  │
  ▼  l'agente produce TUTTE le W modifiche in un solo tool: write_files
Prepare write-batch ── W record ordinari (prepareAuthorization invariato), stessa challenge
  │                    write_set_digest calcolato dal Gateway (§3.3)
  ▼
staging del proprietario: UN write-set flight durevole (W effetti, sequenze contigue)
  │                       intent per file: blob atteso (update) / prova di assenza (create)
  ▼
1 VP con i W permessi divulgati
  │
  ▼  per ogni elemento, in ordine canonico:
Execute(i) ── consumo monouso → (primo) verifyMultiple #1 │ (altri) riuso VP identica
          ── OPA(i) ── binding(i) con write-set flight, intent(i) e write_set_digest
          ── NESSUNA scrittura sul provider: l'elemento è "convalidato"
  │
  ▼  Execute(ultimo) ⇒ PUBBLICAZIONE (monouso, §3.4)
  P1  stato batch = "validated" (tutti i W convalidati) → passa a "publishing" in modo sincrono
  P2  reserveAttempt durevole dell'intero write-set (prima di qualunque scrittura su Gitea)
  P3  ref di staging isolato dalla HEAD fissata → UN commit ChangeFiles con le W modifiche
      (sha del blob atteso sempre presente per gli update; create che fallisce se il file esiste)
  P4  verifica dell'esatto insieme (§3.3, W0 S1/S7): parent, elenco e stato dei file, contenuti
  P5  verifyMultiple #2 della STESSA VP sugli stessi W permessi        ← D3, modalità rigorosa
  P6  dopo ogni await di P2–P5: stato batch ancora "publishing", Root attiva (#live),
      Child non scaduta, record e finestra non scaduti, HEAD del branch = HEAD fissata
  P7  UNICO HEAD-CAS: PUT /branches/{work} {old_commit_id: HEAD fissata, new_commit_id: commit}
  P8  rilettura del branch e di ogni file al nuovo commit
  P9  per OGNI file: ricevuta HMAC + osservazione indipendente + evidenza durevole
  │
  ▼
attestazione del proprietario per ogni scrittura (sequenze R+1 … R+W, in ordine) → finalizzazione
```

Nella modalità standard P5 viene omesso. Restano P6 e la finestra di 60 s dal Prepare, come per le letture.

### 3.3 Binding dell'intero write-set

Il Gateway, non il client, calcola un **`write_set_digest`**: lo SHA-256 della serializzazione canonica (JSON a chiavi ordinate) di:
- **contesto:** `session_id`, `authority_digest`, `root_credential_id`, `task_id`, `runtime_task_id`, `epoch`, `child_credential_id`, `agent_did`, ruolo, branch di lavoro, `pinned_head_sha`, `batch_id`, `challenge`;
- **elementi, in ordine canonico** (ordinati per percorso, con `sequence = R + 1 + indice`): `request_id`, `request_fingerprint`, `operation`, `path`, `required_permission`, `expected_blob_sha` (update) o `absent: true` (create), `next_content_sha256`, `next_content_bytes`.

**Provenienza dei dati.** Il digest è costruito **solo** con:
- i record del Prepare custoditi dal Gateway (`InMemoryRequestStore`), di cui le admissions **ricalcolano** fingerprint e permesso canonico;
- l'intent riservato dal **preflight del proprietario** (`TrustedAuthorityOnlyWriteSetPreflight`). Le admissions ne verificano il marchio privato della classe e lo leggono con la chiamata via prototype. Blob SHA degli update e prove di assenza dei create provengono esclusivamente dalle letture Gitea del proprietario alla HEAD fissata.

Nessun blob SHA, prova di assenza, ordine o percorso viene accettato dal modello, da A2A o dal chiamante.

**Canonicalizzazione.** L'ordine canonico (per risorsa) e la serializzazione JSON a chiavi ordinate rendono il digest **deterministico per lo stesso insieme di record**, indipendentemente dall'ordine in cui il modello elenca i file. **Non** è un identificatore del solo contenuto: due Prepare diversi dello stesso insieme di modifiche producono digest diversi, perché cambiano challenge e `request_id`. È voluto: il digest identifica un'autorizzazione monouso, non una patch.

**Scope dell'Engineer e permessi del Task.** Sono due insiemi distinti e vanno tenuti separati:
- **scope firmato dall'Engineer:** i permessi approvati nella ricevuta firmata, che formano la Root operativa;
- **permessi del Task:** quelli proposti dall'Orchestrator, ammessi dal Coordinator solo se contenuti nello scope (`registerTask`, contenimento verificato sulla ricevuta firmata) e incorporati nella Child.

La forma `readsWriteSetGrantShape`, il `write_plan` del manifest e il digest sono valutati **sui permessi del Task**, cioè sulla riga registrata dal Coordinator e sulla Child iscritta, mai sullo scope dell'Engineer. Uno scope ampio, per esempio una directory, non rende ammissibile un write-set che non sia esattamente firmato nel Task.

Il digest viene:
1. registrato nel manifest e nel write-set flight durevoli (staging);
2. ricalcolato e confrontato a ogni Execute, prima del commit privato (P3), prima del CAS (P7) e nelle evidenze per file (P9);
3. scritto nel messaggio del commit, insieme a `batch_id`, per la riconciliazione.

L'ordine canonico rende il digest indipendente dall'ordine in cui il modello elenca i file. L'insieme deve coincidere **esattamente** con le scritture firmate nella Child (D5). La `request_fingerprint` di ogni record lega già percorso, operazione e contenuto alla richiesta preparata.

**Verifica dell'esatto insieme prima del CAS (P4):**
1. il commit ha un solo parent, uguale a `pinned_head_sha`;
2. l'elenco dei file di `GET /git/commits/{sha}?files=true` è esattamente l'insieme dei W percorsi, con `modified` per gli update e `added` per i create; nessun file in più, in meno o rinominato;
3. controllo ridondante con `GET /compare/{head}...{commit}`, sul campo `commits[].files`;
4. il contenuto di ogni file al commit ha sha256 e lunghezza dell'intent;
5. per gli update, il blob alla HEAD era quello fissato; per i create, il file era assente;
6. nessun contenuto è identico all'originale: questo controllo resta prima dello staging, perché Gitea crea commit vuoti (W0 S8).

### 3.4 Transizioni terminali e pubblicazione monouso

Stati del write-batch (admissions): `staged → validated → publishing → cas_sent → published`, più due stati terminali, `failed` e `ambiguous`. `publishing` significa "CAS non ancora inviato"; `cas_sent` significa che la richiesta CAS può essere arrivata a Gitea.

Le fasi della pubblicazione hanno questo ordine: **P1–P6 precedono l'invio del CAS, P7 è il CAS, P8–P9 lo seguono.** Gli esiti si distinguono così:

| Classe | Quando | Stato del branch | Stato del write-set |
|---|---|---|---|
| **Fallimento precedente al CAS** | qualsiasi errore in Prepare, staging, Execute (verifica, OPA, binding, scadenza, replay, VP diversa) o in P1–P6 (commit privato, verifica dell'insieme, seconda verifica, ricontrolli) | nessuna modifica; al più un ref di staging isolato | `failed` |
| **Rifiuto certo del CAS** | P7 risponde 422 (HEAD avanzata o `old_commit_id` diverso, W0 S3/S10) e una rilettura conferma la HEAD invariata | nessuna modifica | `failed` |
| **Esito ambiguo** | P7 inviato, ma la risposta è persa o non classificabile, oppure la rilettura P8 è incoerente | tutto o niente, da riconciliare | `ambiguous` |
| **Pubblicazione avvenuta, evidenze fallite** | P7 e P8 riusciti, ma una ricevuta, un'osservazione o un'attestazione (P9) falliscono | **tutte** le modifiche pubblicate | `published`, Task **non** finalizzato (§4.4) |

**Regole:**
- `failed` e `ambiguous` sono terminali, nessuna transizione ne esce. `published` non può tornare a `failed` (`failTrustedWriteSet` lo rifiuta): le evidenze restano pendenti e il Task non viene concluso.
- **Pubblicazione monouso.** `validated → publishing` avviene in modo sincrono (`beginTrustedWriteSetPublication`), prima di qualunque `await` del publisher. Una seconda chiamata viene rifiutata. `reserveAttempt` dell'insieme è durevole prima di P3, quindi neppure dopo un riavvio si ripubblica.

**Replay o errore concorrente (W2):**
- **Prima dell'invio del CAS** (`staged`, `validated`, `publishing`): un replay di un elemento, un Execute concorrente o qualsiasi errore asincrono portano il write-set a `failed` (`failTrustedWriteSet`). Il publisher ricontrolla lo stato dopo **ogni** `await` e si ferma prima del CAS: a Gitea non viene inviata alcuna scrittura sul branch di lavoro.
- **Subito prima della richiesta CAS**, in modo sincrono e dopo un ultimo controllo di Root e Child, il publisher esegue `markTrustedWriteSetCasSent` e lo stato passa a `cas_sent`.
- **Dopo l'invio** (`cas_sent`): un errore esterno, come il replay di un elemento, **non cambia lo stato**. `failTrustedWriteSet` lascia `cas_sent` invariato, quindi non può classificare come `failed` né come `ambiguous` una pubblicazione avviata o avvenuta. Solo il publisher che ha inviato il CAS classifica l'esito:
  - `recordTrustedWriteSetPublished`: la rilettura mostra il branch al commit;
  - `recordTrustedWriteSetCasRejected` → `failed`: Gitea ha rifiutato con 409 o 422 e la rilettura conferma che il branch non è il commit;
  - `recordTrustedWriteSetCasAmbiguous` → `ambiguous`: qualsiasi altro esito.
- `published`, `failed` e `ambiguous` non cambiano più. In nessun caso c'è un nuovo tentativo.

### 3.5 Limiti sulle dimensioni

| Limite | Valore | Origine |
|---|---|---|
| Contenuto per file | 1–2.000.000 byte UTF-8, senza NUL | invariato (`gitea-client.ts`, preflight) |
| Somma dei contenuti di un write-set | ≤ 4.000.000 byte | nuovo |
| Scritture per write-set | 2–8 (D1) | nuovo |
| Argomenti di `write_files` (JSON) | ≤ 6 MiB, solo `{branch, changes:[{path, operation, content}]}`, chiavi esatte | nuovo |
| Richiesta di Prepare write-batch | stesso limite di `write_files` | nuovo |
| Percorsi | regole attuali (nessun `..`, `%`, `\`, segmenti vuoti) | invariato |

W0 mostra che Gitea accetta un ChangeFiles di 8 × 2 MB, circa 21 MB di richiesta, in 0,93 s. I limiti sono quindi nostri, scelti per contenere memoria, evidenze e output del modello; non sono vincoli del provider.

### 3.6 Componenti coinvolti

| Componente | Modifica |
|---|---|
| `plan-contracts/.../gitea-permission-containment.mjs` | `readsWriteSetGrantShape` (nuova); `readWriteGrantShape` invariata |
| Proposer, adaptive loop, review host | Task con 2–8 scritture solo con l'opzione attiva; limite di 16 invariato |
| `trusted-authority-only-admissions.ts` | manifest con R letture + W scritture; nuovo **write-set flight** (W effetti riservati insieme); binding per elemento con `write_set_digest`; attestazione per file in ordine; finalizzazione solo con tutte le evidenze |
| Stager del proprietario | stati `writes_pending → writes_validated → published → finalized`; un solo write-set attivo |
| Preflight update/create | riuso per file per l'intent (blob atteso / prova di assenza) |
| Nuovo `trusted-write-batch.ts` | `prepareWriteBatch`, store, macchina a stati del §3.4, verifica e riuso VP, seconda verifica |
| Nuovo executor write-set | `reserveAttempt` dell'insieme, P2–P9, evidenze per file |
| `gitea-client.ts` | `commitFilesWithHeadCas` (ChangeFiles + verifica dell'insieme + CAS); prefisso del ref di staging isolato aggiunto alla lista dei ref vietati agli agenti |
| Evidence publisher/observer | ricevuta e osservazione per file, legate al commit comune e al `write_set_digest` |
| `execute.ts` | ramo write-batch; invalidazione come R-F3 |
| Client e strumento | `writeFiles(changes[])`, tool `write_files`; `update_file`/`create_file` nascosti quando attivo |
| Console e modelli scripted | `enableBatchWrites`, `DELEGATION_BATCH_WRITES=0` per la baseline; piano scripted multi-scrittura; eventi `write_batch_id` e `batch_verification` (`performed` / `reused` / `reverified`) |
| OPA | **invariata** |

## 4. Semantica di atomicità

### 4.1 Unità atomica

L'unità è l'insieme delle W scritture di un Task.
- Sul branch di lavoro sono osservabili solo due stati: la HEAD fissata, senza modifiche, oppure il nuovo commit, con tutte le W modifiche.
- Il passaggio avviene con una sola compare-and-swap del ref, sull'id del commit.
- Task diversi restano sequenziali, con commit distinti.

### 4.2 Esiti

| Evento | Stato del branch di lavoro | Stato del Task |
|---|---|---|
| Un elemento non supera OPA, binding o verifica | nessuna modifica del batch | fallito |
| Lo staging o la verifica dell'insieme falliscono (P3–P4) | nessuna modifica; può restare il ref di staging isolato | fallito, ref da rimuovere |
| La seconda verifica fallisce (P5: revoca o scadenza) | nessuna modifica | fallito |
| Il CAS viene rifiutato (HEAD avanzata, W0 S3) | nessuna modifica | fallito, nessun retry |
| Il CAS riesce | tutte le modifiche pubblicate | prosegue con le evidenze |
| Il CAS riesce ma fallisce un'evidenza o un'attestazione | tutte le modifiche pubblicate | **non concluso** (§4.4) |
| La risposta del CAS viene persa | tutto o niente, da riconciliare | `ambiguous`, nessun retry |

### 4.3 Revoca e scadenza prima della pubblicazione; TOCTOU residuo

- **Per elemento:** consumo, scadenza del record, OPA, binding, Root attiva e Child non scaduta.
- **Prima del CAS:**
  - P5, seconda `verifyMultiple` (modalità rigorosa): stato di revoca on-chain, firma, catena e scadenze;
  - P6, dopo l'ultima operazione asincrona: Root attiva (incluso il ritiro della sessione da parte dell'Engineer), Child non scaduta, finestra, stato del batch, HEAD invariata.
- **TOCTOU residuo:** tra P5/P6 e P7 resta una finestra breve, nell'ordine di una o due chiamate HTTP (W0: CAS ≈ 0,3 s). Blockchain e Gitea sono sistemi distinti, quindi non esiste un'operazione atomica che leghi la lettura dello stato di revoca on-chain allo spostamento del ref Git. Una revoca registrata sulla catena dopo P5 e prima di P7 non impedisce la pubblicazione. Il rischio è dichiarato:
  - la finestra è ridotta al minimo, con P5 subito prima di P7 e nessun lavoro intermedio oltre a P6;
  - la modalità standard la estende fino alla finestra del batch, quindi viene usata solo come variante sperimentale.

### 4.4 Fallimento delle evidenze dopo un CAS riuscito

Le modifiche sono pubblicate, ma il Task resta **non attestato**:
- nessuna finalizzazione: il Task non entra in `completed` e le dipendenze (`depends_on`) restano bloccate, quindi i Task successivi non superano il preflight;
- nessuna PR: la Draft PR richiede che il ciclo adattivo arrivi a `owner_adaptive_work_ready_for_pr`, con l'ultimo Test completato e attestato in modo indipendente (`trusted-authority-only-operational-launcher.mjs:169`). Un Task di scrittura non attestato interrompe il ciclo prima di quel punto;
- la sessione termina in errore e la Root operativa viene revocata, come oggi;
- nessun ripristino automatico, perché un revert sarebbe una nuova scrittura non autorizzata. La console riporta "modifiche pubblicate sul branch ma non attestate", con commit e `write_set_digest`;
- test dedicato: con l'osservatore che fallisce dopo il CAS, nessuna dipendenza viene sbloccata e la PR non viene creata.

### 4.5 Atomicità della pubblicazione Git e atomicità del workflow

| Proprietà | Garantita? |
|---|---|
| Le W modifiche compaiono sul branch tutte insieme o per niente | **sì** (un commit, un CAS) |
| Nessun sottoinsieme del write-set è osservabile sul branch | **sì** |
| Pubblicazione, evidenze, attestazioni e completamento formano un'unica transazione | **no**: le evidenze seguono il CAS (§4.4) |
| Revoca on-chain e spostamento del ref sono atomici | **no**: TOCTOU residuo (§4.3) |
| Atomicità tra Task diversi | **no**: Task sequenziali, commit distinti |
| Esito certo dopo un errore di rete sul CAS | **no**: stato `ambiguous`, riconciliazione |

## 5. Invarianti da preservare

| # | Invariante | Garanzia |
|---|---|---|
| W1 | Prepare legato al ruolo | Fetch in-process legata al ruolo; Execute solo sui record del ruolo |
| W2 | Permesso derivato dal Gateway | `prepareAuthorization` invariato per elemento |
| W3 | Esatto insieme firmato | `readsWriteSetGrantShape`, `write_set_digest`, D5 |
| W4 | Update solo di file letti; create solo di file assenti e non letti | Regole attuali per file; W0 S5 e S6 |
| W5 | Una VP, verifica crittografica completa (due volte in modalità rigorosa) | `verifyMultiple` invariato; riuso solo per la VP identica byte per byte |
| W6 | OPA e binding per ogni operazione | Ogni Execute |
| W7 | Staging isolato | Ref di staging isolato da HEAD fissata, prefisso vietato agli agenti; branch di lavoro invariato fino al CAS (W0 S2) |
| W8 | Esatto insieme pubblicato | §3.3, P4; W0 S1 e S7 |
| W9 | Atomic Write-Set Publication | Un commit, un CAS sull'id del commit (W0 S2, S3, S10) |
| W10 | Evidenze per file | Ricevuta, osservazione ed evidenza durevole per file; attestazioni in ordine |
| W11 | Journal durevole prima di ogni effetto | Manifest, write-set flight e `reserveAttempt` prima di P3 |
| W12 | Fail-closed, stati terminali | §3.4 |
| W13 | Anti-replay, pubblicazione monouso, esiti ambigui | §3.4 |
| W14 | Revoca e scadenza prima della pubblicazione | P5 e P6; TOCTOU dichiarato |
| W15 | Esecuzione sequenziale | Un solo write-set attivo, un solo Task attivo |
| W16 | Nessuna nuova autorità | Credenziali, OPA e core invariati |
| W17 | Baseline disponibile | §6 |

## 6. Compatibilità con il percorso a scrittura singola

- **W = 1:** con o senza l'opzione, il percorso resta quello attuale, invariato (`readWriteGrantShape`, `update_file`/`create_file`, un commit e un CAS per Task).
- **Creazione senza letture:**
  - il Task di sola creazione con un `create_file` resta sul percorso attuale;
  - un write-set di sole creazioni (W ≥ 2, R = 0) è ammesso nel batch;
  - un write-set con almeno un update richiede la lettura di quel file nello stesso Task, come oggi.
- **Interruttore della baseline:** `DELEGATION_BATCH_WRITES=0` disattiva il batch nella console, come `DELEGATION_BATCH_READS=0` per le letture. Con il batch disattivato il planner non propone Task con più scritture.
- **Riparazioni dopo un FAIL del Runner:** restano Task a scrittura singola (baseline) nella Fase W.
- **Fase R:** invariata. Letture e scritture batch convivono nello stesso Task (1 VP di lettura + 1 VP di scrittura).

## 7. Rischi

| Rischio | Mitigazione |
|---|---|
| Modifica delle admissions (2.231 righe, critica): il write-set flight cambia l'invariante "un flight attivo" | Tipo di flight esplicito con W effetti, nessun flight concorrente; percorsi esistenti invariati; test dedicati |
| Update senza `sha` accettato da Gitea (W0 S6b) | L'owner invia **sempre** il blob atteso; verifica P4 dei contenuti |
| ChangeFiles con contenuto identico crea un commit vuoto (W0 S8) | Contenuto identico rifiutato prima dello staging; P4 richiede l'insieme esatto |
| Ref privati residui (W0 S10) | Rimozione dopo il successo; conservazione per la riconciliazione dopo un fallimento |
| Pubblicazione avvenuta ma evidenza fallita | §4.4 |
| TOCTOU revoca–CAS | §4.3, dichiarato |
| Output del modello con W contenuti in un turno | Limiti del §3.5; W_MAX = 8 |
| Riavvio a metà write-set | Journal durevole, Task terminale, nessuna ripresa automatica |

## 8. Test necessari

**Unit, plan-contracts:** `readsWriteSetGrantShape`:
- tabelle del §0, mix di update e create, sole creazioni;
- duplicati, update di un file non letto, create di un file letto;
- oltre 8 scritture o 16 permessi, permessi estranei;
- vincoli del Test Agent.

**Unit, Gateway (write-batch, executor, `execute`):**
- batch valido: `performed`, W − 1 `reused` e `reverified`; nessuna chiamata di scrittura a Gitea prima dell'ultimo elemento;
- per ognuno tra OPA, binding, scadenza, replay, VP diversa e verifica: `failed` e **nessuna** chiamata di scrittura;
- pubblicazione monouso: replay dell'ultimo Execute, Execute concorrente, errore durante P2–P5;
- P5 rifiutata (revoca simulata), Root ritirata, Child scaduta, finestra scaduta, HEAD avanzata: nessun CAS;
- `write_set_digest`: ordine dei file diverso → stesso digest; contenuto, percorso o operazione diversi → rifiuto;
- limiti del §3.5.

**Unit, `commitFilesWithHeadCas`** (Gitea simulato):
- parent errato;
- file in più, in meno o con stato errato;
- contenuto diverso; update senza sha (vietato lato owner);
- CAS 422; risposta del CAS persa → `ambiguous`;
- nessun retry.

**Integrazione su Gitea locale reale:** i casi di W0 trasformati in test di regressione (opt-in, con lo stack attivo).

**Owner e IPC (stager reale + IPC Unix reale):**
- ordine degli eventi; un solo write-set; attestazioni per file in ordine;
- chiamate non conformi: attestazione prima della pubblicazione, secondo write-set, scrittura dopo un fallimento;
- evidenza fallita dopo il CAS: nessuna dipendenza sbloccata.

**E2E scripted comparativo:** §9.

**Regressione:** tutte le suite Node, OPA 52/52 e core Rust.

## 9. Valutazione sperimentale e comparabilità

Il confronto tra baseline e batch è valido a **livello di workflow**: con la baseline, W scritture richiedono W Task distinti. Misura quindi insieme quattro benefici, che vanno riportati separatamente:

| Componente | Metrica | Fonte |
|---|---|---|
| Verifiche crittografiche | numero di verifiche complete; Σ `verification_ms` | decisioni Gateway (`batch_verification`) |
| Deleghe e orchestrazione | numero di Task, di Child DC emesse, di turni dell'Orchestrator | log e journal della sessione |
| Pubblicazioni | numero di commit e di CAS sul branch | Gitea (`compare` HEAD iniziale…finale) |
| Chiamate agli strumenti | tool call e turni del modello dello specialista | `adk_tool_timing` |
| Totale | tempo dalla firma al completamento | driver E2E |

**Separazione del beneficio crittografico, senza nuovi percorsi operativi:**
- **stima del contributo della verifica:** (verifiche evitate) × (mediana di `verification_ms` di una verifica Child nella stessa campagna). Il resto della differenza del tempo totale va attribuito a deleghe, pubblicazioni e turni;
- **contrasto interno, rigorosa contro standard:** stesso workflow, stessi Task; differiscono per una sola verifica per write-set. Misura direttamente il costo marginale di una verifica e il prezzo della modalità rigorosa.

**Protocollo:** quello della Fase R.
- Stack riavviato per esecuzione, riscaldamento scartato, ordine casuale con seme registrato, n = 6 per cella, bootstrap con PRNG esatto (mulberry32).
- Celle: baseline a scrittura singola, batch rigoroso, batch standard.
- Workload: Task con W = 3 e W = 8 scritture, più letture.
- Limiti: workload scripted, nessuna generalizzazione automatica ai workflow con Gemini.

## 10. Piano di lavoro (dopo l'approvazione)

1. ~~**W0, spike** su Gitea locale~~: completato (§11).
2. **W1, forma del grant e admissions:** write-set flight, manifest, `write_set_digest`, attestazioni per file, unit test.
3. **W2, Gateway:** write-batch, `commitFilesWithHeadCas`, executor, evidenze per file, P1–P9, stati del §3.4.
4. **W3, client e strumento:** `write_files`, console, modelli scripted, opzione e baseline.
5. **W4, test, suite ed E2E** comparativo; report sul modello di `PHASE_R_RESULTS.md`.

Il merge su `main` avverrà solo dopo la revisione dei risultati.

## 11. Risultati di W0 (Gitea 28.0.0 locale)

- **Setup:** repository usa e getta `thesis/w0-spike` creato con l'account admin. Tutte le operazioni usano il **token del Gateway**, collaboratore in scrittura, come in produzione.
- **Script e dati:** `docs/experiments/phase-w-w0/w0-spike.mjs`, `w0-size.mjs`, `w0-results.jsonl`, `w0-size.jsonl`.
- **Esito:** 9 casi con asserzione superati e 2 casi **diagnostici**, S6b e S8, che osservano il comportamento di Gitea senza un'asserzione di successo (nei risultati grezzi compaiono con `ok: true` per costruzione). Nella prima esecuzione due casi erano falliti per errori nello script, non di Gitea, poi corretti. Quando diventeranno test di regressione (W2/W4), S6b e S8 avranno asserzioni esplicite sul comportamento atteso dal nostro codice: sha sempre inviato e byte identici rifiutati prima dello staging.

| Caso | Risultato |
|---|---|
| S1, ChangeFiles misto (2 update con sha + 2 create) su ref di staging isolato | **1 commit**, unico parent = HEAD fissata; `git/commits?files=true` e `compare` riportano esattamente `{a: modified, b: modified, new1: added, new2: added}`; contenuti corretti; 0,40 s |
| S2, isolamento e CAS | branch di lavoro invariato e file nuovi non visibili prima del CAS; un `PUT /branches` con `old_commit_id` pubblica tutto (204, 0,31–0,37 s) |
| S3, CAS con HEAD avanzata | **422** "branch commit does not match"; branch invariato; commit privato non pubblicato |
| S4, uno sha errato tra operazioni valide | **422**, intera richiesta rifiutata, nessun commit parziale |
| S5, create di un file esistente tra operazioni valide | **422**, intera richiesta rifiutata, nessun commit parziale |
| S6, update di un file inesistente | **404**, nessun commit |
| S6b, update **senza** sha (diagnostico) | **accettato**: nessuna guardia del blob. L'owner deve sempre inviare lo sha (§7) |
| S7, commit con un file non autorizzato | rilevato sia da `git/commits?files=true` sia da `compare`: la verifica P4 lo rifiuterebbe |
| S8, update con contenuto identico (diagnostico) | **accettato**, con un commit vuoto (nessun file): il rifiuto dei byte identici resta prima dello staging |
| S9, ripiego: 3 commit sequenziali sul ref di staging isolato + 1 CAS | funziona: `compare` riporta 3 commit e i 3 file; un solo CAS (0,38–0,41 s per commit) |
| S10, CAS con `old_commit_id` errato | **422**, branch invariato; i ref di staging isolati restano finché non vengono rimossi (DELETE 204) |
| Dimensione | ChangeFiles con 8 × 256 KiB (2,8 MB di richiesta): 201 in 0,55 s; con 8 × 2 MB (21,3 MB): 201 in 0,93 s |

**Conclusioni di W0:**
1. **ChangeFiles offre garanzie sufficienti** e diventa il meccanismo principale: un commit multi-file per write-set, con rifiuto dell'intera richiesta se un'operazione non è valida (S4–S6). Il ripiego a commit multipli (S9) funziona ma non serve; resta documentato.
2. **La verifica dell'esatto insieme è affidabile** con due fonti indipendenti dell'API (`git/commits?files=true` e `compare` sul campo `commits[].files`).
3. **Il CAS sull'id del commit** rifiuta qualunque avanzamento della HEAD e qualunque `old_commit_id` errato (422), senza effetti sul branch.
4. **Regole lato owner emerse:** inviare sempre lo sha negli update (S6b); rifiutare i byte identici prima dello staging (S8); rimuovere i ref di staging isolati dopo il successo (S10); aggiungere il nuovo prefisso dei ref di staging isolati alla lista dei branch vietati agli agenti.
5. I limiti di dimensione sono nostri (§3.5): Gitea accetta richieste ben oltre il limite proposto.

**Limite di W0:** è una prova dell'API di Gitea, non del protocollo. Non coinvolge Gateway, VP, OPA, admissions o journal; quelli sono coperti da W1–W4.

**Da consolidare in W2/W4:**
- accessibilità dei ref di staging (chi li vede e chi li può spostare);
- completezza del diff, compresa la **modalità dei file** (eseguibilità, symlink);
- CAS con `old_commit_id` obsoleto anche quando il commit candidato è **discendente** della HEAD corrente.

## 12. W1: grant, admissions, manifest, write-set flight e journal

**Implementazione** (branch `feature/batch-write-design`), tutta opt-in. Senza `batchWritesEnabled` nessun nuovo percorso è raggiungibile.

| Componente | Contenuto |
|---|---|
| `plan-contracts/.../gitea-permission-containment.mjs` | `readsWriteSetGrantShape` (R 0–15, W 2–8, ≤ 16, file esatti distinti di un solo branch, update solo di file letti, create solo di file non letti, sole creazioni senza letture), `isProjectTestWriteSetGrant`, `MAX_TASK_WRITES = 8`, `MAX_TASK_EFFECTS = 16`. Le forme a scrittura singola sono invariate e disgiunte |
| `orchestrator-runtime/.../sequential-effect-journal.ts` | piano tipato `isReadWriteSetPlan`; `write_plan` canonico nel manifest; `reserveWriteSet` (**un solo** flight durevole per Task, O_EXCL, uguale al `write_plan`, concatenato all'ultima lettura attestata); scrittura come flight individuale vietata; evidenze delle scritture **in ordine e concatenate**; finalizzazione invariata |
| `gateway/.../write-set-intent-journal.ts` (nuovo) | intent per file del write-set, riservato **una volta** per Task; limiti: 2–8 file, 2.000.000 byte per file, 4.000.000 byte in totale, update con blob, create con assenza, nessun update a vuoto. I journal degli intent a scrittura singola (uno per Task) non sono toccati |
| `gateway/.../write-set-preflight.ts` (nuovo) | preflight del proprietario, **nessuna scrittura**: blob SHA degli update e 404 dei create letti dal proprietario alla HEAD fissata, HEAD invariata prima e dopo, update identici rifiutati |
| `gateway/.../admissions.ts` | `beginTrustedSequentialWriteSetTask`, `assertTrustedWriteSetIntentBinding`, `stageTrustedWriteSet` (digest), `assertTrustedWriteSetItemBinding` (ordine canonico, VP della Child sull'esatto insieme), `beginTrustedWriteSetPublication` (monouso), `assertTrustedWriteSetStillPublishable` (P6), `recordTrustedWriteSetPublished`, `failTrustedWriteSet` (`failed` / `ambiguous`), `attestTrustedWriteSetEffect` (solo dopo la pubblicazione, in ordine); finalizzazione solo per un write-set `published` con tutte le evidenze. I percorsi a scrittura singola (intent, staging, binding) rifiutano esplicitamente i Task con write-set |

**Test** (tutti verdi):
- plan-contracts 31 (+4);
- orchestrator-runtime 345 (+13: 5 journal, 8 admissions su componenti reali, cioè sessione Engineer, Coordinator, emissione della Child, journal durevoli, osservatore di completamento, `GiteaClient` con HTTP simulato);
- Gateway 245 (+2, journal degli intent);
- agent-runtime 216, console 61, orchestrator 74, Runner 50, mcp-shared 26: invariati.

OPA non è modificato (non rieseguito localmente in questa sessione per l'assenza del daemon Docker; lo esegue la CI).

**Copertura dei sette punti della revisione:**

| Punto | Test |
|---|---|
| 1. Contenimento dei permessi e normalizzazione | forma: tabella D1/D2, file esatti, stesso branch, attraversamenti, percorsi codificati, chiavi estranee, scope a directory rifiutati; admissions: Prepare con fingerprint e permesso canonico ricalcolati |
| 2. Combinazioni di letture, update e create | flusso completo R = 2, U = 2, C = 1; update di un file non letto e create di un file letto rifiutati |
| 3. Sole creazioni senza letture | write-set di 2 create con `first_sequence = 1` (journal e admissions) |
| 4. Binding dell'intero write-set | insieme parziale, record fuori piano, challenge diversa, preflight contraffatto, digest diverso, VP di un altro presentatore o con un sottoinsieme dei permessi |
| 5. Unico flight durevole | seconda `reserveWriteSet` (EEXIST); scrittura come flight individuale; letture dopo lo staging |
| 6. Nessuna attestazione anticipata o fuori ordine | attestazione prima della pubblicazione; ricevuta del secondo file prima del primo; evidenze fuori ordine nel journal; finalizzazione prima della pubblicazione |
| 7. Baseline e funzionalità disabilitata | `batchWritesEnabled` assente: percorso indisponibile; grant a scrittura singola: write-set rifiutato e manifest baseline ammesso; percorsi a scrittura singola che rifiutano i Task con write-set; tutte le suite esistenti invariate |

**Controllo per mutazione:**
- **rilevati:** binding non ordinato (M1), pubblicazione non monouso (M3), intent di update a scrittura singola accettato per un write-set (M5);
- **ridondanti per costruzione**, documentati: tre guardie sopravvivono perché un controllo precedente produce lo stesso rifiuto, e restano come difesa in profondità:
  - il blocco dello staging a scrittura singola (M2), già rifiutato dall'intent binding;
  - la finalizzazione senza pubblicazione (M4), perché le evidenze richiedono la pubblicazione;
  - la lettura dopo lo staging (M6), perché le letture sono già esaurite.

**Non incluso in W1** (rimandato):
- **W2:**
  - ramo write-batch di Prepare ed Execute nel Gateway, seconda `verifyMultiple`;
  - executor con `commitFilesWithHeadCas`, `reserveAttempt` dell'insieme, CAS;
  - ricevute e osservazioni per file;
  - prefisso dei ref di staging isolati nella lista dei branch vietati;
  - regressioni W0 con asserzioni esplicite.
- **W3:** proposer, ciclo adattivo, owner A2A e remoto, stager lato agente, tool `write_files`, console.
- **Limitazione dichiarata:** per un Task con write-set non esiste il percorso "nessuna modifica" (`reportNoChange`), coerentemente con D5. Il fence prima della scrittura resta disponibile solo per i Task a scrittura singola.

## 13. W2: Gateway, write-batch, executor, seconda verifica, ChangeFiles, HEAD-CAS, evidenze

**Implementazione** (opt-in; senza `batchWritesEnabled` e senza executor configurato nessun nuovo percorso è raggiungibile):

| Componente | Contenuto |
|---|---|
| `gateway/src/trusted-write-batch.ts` (nuovo) | `prepareWriteBatch`: `write_files` con 2–8 modifiche distinte, chiavi esatte, ≤ 2 MB per file, ≤ 4 MB in totale, richiesta ≤ 6 MiB; un record ordinario per file tramite `prepareAuthorization` invariato; challenge comune; finestra di 60 s; elementi restituiti in ordine canonico. `stageWriteBatch` (solo owner): preflight e write-set flight, digest legato al `batch_id`. `verifyWriteBatchItem`: una `verifyMultiple` al primo Execute, riuso solo per la VP identica byte per byte, VP conservata nella memoria dell'owner per la seconda verifica. Invalidazione del batch per qualsiasi errore |
| `execute.ts` | ramo write-batch: verifica o riuso → OPA per elemento (invariato) → `assertTrustedWriteSetItemBinding`, che controlla ordine, VP sull'esatto insieme, digest e **batch ID**. Gli elementi non ultimi sono "convalidati" senza effetti; l'ultimo invoca il publisher. Audit con `write_batch_id`, `batch_verification`, `write_set_digest`, `write_set_reverified` e commit |
| `gateway/src/trusted-authority-only-write-set-executor.ts` (nuovo) | P1–P9 del §3.2. Binding dei byte: i file inviati a ChangeFiles sono **ricostruiti dai record del Gateway**, con fingerprint, SHA-256 e dimensione ricalcolati e confrontati con l'intent; un contenuto modificato dopo lo staging non viene mai inviato. Seconda `verifyMultiple` della stessa VP (modalità rigorosa, default). Ricontrolli dopo ogni `await`. Classificazione del CAS. Ricevute per file. Rimozione del ref di staging isolato dopo il successo |
| `gitea-client.ts` | `stageWriteSetCommit` (ref di staging isolato `feature/w2-write-set-<hash>` alla HEAD fissata e un solo commit ChangeFiles, con lo sha sempre presente negli update), `getCommitChanges`, `compareCommitFiles`, `getTreeModes`, `casBranchToCommit` (`updated` / `rejected` / eccezione ambigua, senza retry), `deleteWriteSetStagingRef`. Il prefisso privato è vietato come branch di lavoro anche nei CAS a scrittura singola |
| `gateway/src/trusted-authority-only-write-set-evidence.ts` (nuovo) | ricevuta HMAC per file, legata a richiesta, percorso, operazione, contenuto, blob **e** commit comune, `write_set_digest`, `batch_id` e parent fissato; osservatore indipendente che verifica il MAC, la corrispondenza con l'intent e il commit, e rilegge Gitea |
| Admissions | stato `cas_sent`; `markTrustedWriteSetCasSent`, `recordTrustedWriteSetCasRejected`, `recordTrustedWriteSetCasAmbiguous`; `failTrustedWriteSet` senza effetto dopo l'invio; `batch_id` nel digest e nel binding; attestazione solo tramite l'osservatore del write-set, con il controllo che commit e digest osservati coincidano con quelli pubblicati |
| Journal degli intent | `reserveAttempt` (un solo tentativo, durevole, prima di qualsiasi scrittura Gitea, anche dopo un riavvio) e `reserveOutcome` |

**Test:**
- orchestrator-runtime 360 (+15), su componenti reali (Prepare/Execute, admissions, journal, preflight, executor, evidenze) e un Gitea in memoria fedele alle semantiche osservate in W0;
- Gateway 245 più 3 test di integrazione opt-in sul **Gitea 28 reale**, eseguiti nel container e superati (`docs/experiments/phase-w-w2/real-gitea-regression.txt`);
- OPA 52/52; le altre suite sono invariate.

| Punto della revisione | Test |
|---|---|
| 1. Prima e dopo l'invio del CAS | stato `cas_sent` esplicito; replay durante ChangeFiles → `failed`, nessun CAS; replay durante il CAS → `published`; errore esterno dopo l'invio senza effetto |
| 2. Byte inviati uguali agli intent | contenuto di un record modificato dopo lo staging → nessuna chiamata ChangeFiles, nessun CAS |
| 3. Binding di digest, batch, record, challenge e flight | batch ID diverso, digest diverso, challenge diversa, VP diversa, VP parziale, ordine sbagliato |
| 4. Evidenze legate a commit, digest e batch | osservazione con commit, write-set o batch diversi → rifiutata; contenuto atteso diverso → rifiutato; attestazione con digest diverso → rifiutata |
| 5. Seconda verifica e ricontrolli | modalità rigorosa: 2 verifiche; modalità standard: 1; revoca simulata dopo la prima verifica → nessun CAS, `failed` |
| 6. Regressioni W0 | **Gitea reale:** commit misto con insieme esatto, modi e CAS; `old_commit_id` obsoleto con candidato discendente della HEAD corrente → `rejected`; update senza sha rifiutato dal nostro client; byte identici → commit senza quel file, quindi rifiutato dal controllo dell'insieme; ref di staging isolati mai usabili come branch di lavoro. **Gitea in memoria:** file estraneo nel commit, cambio di modo, symlink → nessun CAS |
| 7. Classi di esito | errore prima del CAS; rifiuto certo (HEAD spostata subito prima del CAS → 422 e rilettura → `failed`); esito ambiguo in 4 varianti (risposta persa dopo o prima dell'applicazione, 500, rilettura impossibile) → `ambiguous`, un solo CAS; pubblicazione riuscita con evidenze fallite → `published`, Task non finalizzato |

**Controllo per mutazione** (6 su 6 rilevate):
- seconda verifica rimossa;
- controllo dell'insieme esatto rimosso;
- binding dei byte rimosso;
- errore esterno dopo l'invio che porta ad `ambiguous`;
- evidenza non legata al commit;
- controllo dei modi rimosso.

**Isolated staging reference, non riservato.** I ref `feature/w2-write-set-*` sono **isolati** dal branch di lavoro e **vietati agli agenti** attraverso il Gateway: nessun Prepare o Execute li accetta come branch, e i CAS e le scritture del Gateway li rifiutano. **Non** sono però riservati: sono branch ordinari, leggibili da chiunque legga il repository. Contengono soltanto ciò che, se la pubblicazione riesce, compare pochi istanti dopo sul branch di lavoro. Vengono rimossi dopo il successo e conservati per la riconciliazione dopo un fallimento. Nella tesi vanno descritti come *isolated staging reference*, senza attribuire loro proprietà di confidenzialità.

**Correzione dopo la revisione di W2:**
- **Scadenza durante l'ultima rilettura della HEAD.** Il ricontrollo locale (stato delle admissions, Root, Child, stato del batch, finestra) viene ripetuto **dopo** l'ultima `await` (la rilettura della HEAD in P6) e di nuovo in modo sincrono immediatamente prima di `markTrustedWriteSetCasSent`, senza altre `await` in mezzo. Test: l'orologio avanza di 61 s durante la rilettura della HEAD → nessun CAS, `failed`.
- **Batch invalidato durante lo staging asincrono.** Lo staging usa lo stato `staging`. Un'invalidazione che arriva nel frattempo lo porta a `failed`, e lo staging non può più impostare `staged`: rifiuta e porta a `failed` anche il write-set durevole. Test: invalidazione esterna durante il preflight, e un Execute anticipato durante il preflight.
- Entrambe le correzioni sono verificate per mutazione: rimuovendole, i nuovi test falliscono.

**Misura della seconda verifica (W3/W4).** In W2 la durata della seconda `verifyMultiple` ricade nel `provider_ms` dell'executor. W3 la espone separatamente (`reverification_ms`), così che in W4 il costo dell'autorizzazione non venga sottostimato.

**Revoca reale tra staging e pubblicazione: non eseguita in W2.**
- Il test usa un verificatore simulato che rifiuta dopo la prima verifica.
- Una prova on-chain richiede VP reali emesse dal core nativo, cioè l'intero percorso della console. È prevista nell'E2E di W4: un punto di pausa del proprietario tra lo staging e il CAS, durante il quale la Child viene revocata sulla Status List su Anvil, come nella Fase 1b.
- Resta valida la dichiarazione del TOCTOU residuo del §4.3.

**Non incluso in W2** (W3): stager e IPC lato agente, tool `write_files`, proposer, owner A2A e remoto, console e modelli scripted, cablaggio nel deployment canonico (`canonical-owner-deployment.mjs`).

## 14. W3: integrazione agente, IPC, owner, proposer, deployment e console

**Catena di un Task write-set** (R letture + W scritture, 2 ≤ W ≤ 8, ≤ 16 effetti):
1. il modello chiama le letture (`read_files` o `read_file`), poi **una sola volta** `write_files` con l'insieme esatto delle scritture firmate (D4, D5);
2. `GatewayControlledToolClient.writeFiles` → `POST /v1/authorization/prepare-write-batch` (route legata al ruolo, mai all'Orchestrator);
3. staging del proprietario via IPC autenticata (`stage_write_set`, solo il batch ID): preflight, intent durevoli, write-set flight;
4. **una** presentazione con i permessi derivati dal Gateway;
5. N Execute: i primi N−1 restituiscono `write_set_item_validated` senza effetto, l'ultimo pubblica (ChangeFiles + seconda verifica rigorosa + un solo HEAD-CAS);
6. attestazione del proprietario via IPC (`attest_write_set`): le N evidenze per file in ordine canonico, poi il sigillo finale del Task;
7. completamento A2A del proprietario come per i Task misti.

**Componenti:**
- tool `write_files` (`adk-specialized-agents.ts`): offerto solo se il Task è write-set *e* esiste uno stager write-set del proprietario; nasconde `update_file`/`create_file`; rifiuta prima del Gateway insiemi parziali, operazioni diverse e una seconda chiamata; un esito per file.
- stager del proprietario `TrustedAuthorityOnlySequentialWriteSetStager` (Gateway, senza endpoint): stati `read_ready → read_pending → reads_done → write_set_staged → finalized`, ogni errore porta a `failed`; l'agente fornisce soltanto ID.
- IPC (`trusted-effect-staging-unix-ipc.ts`, `trusted-effect-staging-task-registry.ts`): operazione `read_then_write_set`, azioni `stage_write_set`/`attest_write_set`, controllo di fase su entrambi i lati.
- owner A2A e owner remoto: riconoscono la forma write-set solo con `batchWritesEnabled` e richiedono lo stager nativo dello stesso proprietario (brand check).
- proposer adattivo: con `batchWrites` propone Task write-set (≤ 8 scritture, ≤ 16 effetti); senza l'opzione il comportamento è invariato.
- deployment canonico: `enableBatchWrites`, directory `writeSetIntent`/`writeSetReceipts`, verificatore del Gateway passato all'executor, route `prepare-write-batch`.
- console e modelli scripted: opt-in `DELEGATION_BATCH_WRITES=1` (**default spento**); il piano scripted raggruppa gli elementi consecutivi dello stesso agente in Task write-set.

**Compatibilità.** Con `DELEGATION_BATCH_WRITES` assente o diverso da `1` nessun componente cambia comportamento: il percorso a scrittura singola (baseline) e le letture batch della Fase R restano quelli già misurati. Le suite esistenti passano senza modifiche alle asserzioni.

**Osservabilità della seconda verifica.** L'executor misura la `verifyMultiple` rigorosa (`reverification_ms`, `performance.now()`). L'audit dell'Execute di pubblicazione registra `write_set_reverification_ms` e `provider_ms = max(0, elapsed − reverification_ms)`, così il costo crittografico non viene attribuito al provider. La console riporta `write_batch_id`, `batch_verification`, `reverification_ms`, `provider_ms` e `commit_sha`.

**Isolated staging reference.** Invariato rispetto a W2: i ref di staging sono isolati dal branch di lavoro e vietati agli agenti attraverso il Gateway, ma **non** sono intrinsecamente riservati.

**Test W3:**
- tool `write_files`: 3 test (offerta, rifiuti locali, assenza nella baseline);
- catena completa su componenti reali (client, IPC Unix autenticata, registry, stager, Gateway, executor, Gitea in memoria): pubblicazione con una VP e un commit; chiamate non conformi sui canali del proprietario rifiutate; batch che non è l'insieme firmato rifiutato allo staging, nessuna pubblicazione.

- proposer: 3 test (Task write-set accettato solo con `batchWrites`; forma write-set imposta; avanzamento con un Task write-set completato accettato solo con l'opzione).

**Smoke E2E sullo stack reale** (scripted, nessuna IA; dettagli in `docs/experiments/phase-w-w3/`): con `DELEGATION_BATCH_WRITES=1` la sessione si completa con Draft PR; il Task backend pubblica 4 scritture con una VP e un commit esatto, seconda verifica 1540,8 ms separata dal `provider_ms`; nessun ref di staging residuo. Con l'opzione a `0` la stessa sessione segue il percorso baseline con letture batch della Fase R. Una sola esecuzione per variante: è uno smoke funzionale, non una misura. Lo smoke ha trovato due difetti, corretti prima delle esecuzioni riportate (directory write-set non create dalla console; operazione `write_set` rifiutata dal proposer nell'avanzamento).

**Rimandato a W4:** revoca reale della Child tra staging e CAS; campagna sperimentale completa.

## 15. W4: validazione finale (sicurezza sullo stack reale e campagna)

**Correzione preliminare (proposer adattivo).** Con `batchWrites` la regola generale del workflow non impone più "un file modificato per Task": chiede un Task per passo di uno specialista, con tutte le sue scritture (2–8) in un Task write-set, e mantiene il Task a scrittura singola per un solo file. Senza l'opzione il testo è identico a prima (test `write-set-proposer.test.mjs`, 4 test).

**Hook sperimentale per la prova di revoca.** `TrustedAuthorityOnlyWriteSetExecutor` accetta `beforeStrictReverification`, invocato dopo lo staging verificato (P3–P4) e prima della seconda verifica (P5); dopo l'hook si ripetono tutti i controlli locali. Non è mai presente in un deployment normale: lo passa soltanto la console, nelle sessioni scripted con `DELEGATION_W4_PROBE=revoke|control`, come parametro in-process di `assembleCanonicalOperationalDeployment` (non dal manifest, non da un agente). È rifiutato in modalità standard. Riceve solo identificativi e una funzione che prova le route del Gateway dell'agente sul ref di staging.

**Revoca reale on-chain (decisione approvata: revoca della Root).** Il prodotto espone soltanto la revoca della Root da parte dell'Engineer; il wallet dell'Orchestrator non ha un'operazione di revoca della Child. La prova revoca quindi on-chain la **Root operativa**, antenata della Child, con il percorso reale dell'Engineer (`revokeRoot` → `update_credential_status` → `updateStatusList` su `IssuerRegistry`, Anvil). Va descritta come revoca dell'antenata della catena, non della Child. Nessuna modifica a core Rust, resolver DID o smart contract.

Risultati: `docs/experiments/phase-w-w4/` (`raw/security/`) e `docs/PHASE_W_RESULTS.md`.

**Esiti W4** (dettagli in `docs/PHASE_W_RESULTS.md`):
- revoca on-chain della Root dopo lo staging: VP valida alla prima verifica, revoca registrata su `IssuerRegistry`, seconda verifica rifiutata, nessun HEAD-CAS, HEAD invariata, sessione fallita, nessuna Draft PR; controllo positivo pubblicato;
- write-set misto (4 update + 1 create) e write-set di sole creazioni pubblicati sullo stack reale;
- route del Gateway dell'agente sul ref di staging: 3/3 rifiutate in entrambe le sessioni;
- campagna 36/36 (k = 2, 4, 8; 6 ripetizioni; seed 20261125): VP 6 contro 2k + 4, Task 2 contro k + 1, commit 1 contro k, OPA invariato; tempo di esecuzione 0,849 / 0,594 / 0,353 della baseline; la riduzione mediana del tempo di verifica vale il 36–45% della riduzione mediana del tempo di esecuzione (rapporto descrittivo, non causale); container ricreati con volumi persistenti, warm-up fisso da 2 scritture.

## 16. Attivazione per default (dopo il merge della Fase W)

Su richiesta dell'Engineer la Fase W è **attiva per default**: la console tratta ogni valore di `DELEGATION_BATCH_WRITES` diverso da `0` come attivo, e `compose.yaml` passa all'app `DELEGATION_BATCH_WRITES` con default `1`. `DELEGATION_BATCH_WRITES=0` (nel file `.env`) ripristina il percorso a scrittura singola, come `DELEGATION_BATCH_READS=0` per le letture. Il codice dei percorsi non cambia: le misure di W3/W4, eseguite con il valore esplicito `1` o `0`, restano valide. Le sezioni precedenti che parlano di opt-in descrivono lo stato al momento delle misure.
