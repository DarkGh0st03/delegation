# Fase R — Letture multiple operative con una sola VP: invarianti e progetto

**Branch:** `feature/batch-read-authorization` (da `main` @ `97547d24`). `main` invariato.
**Motivazione:** Fase 1b (`experiment/multi-permission-verification-benchmark`, `RESULTS_PHASE1B.md`). Sul trust layer reale la verifica di una VP costa circa 1,0 s (Root) e 1,5 s (Child) ed è dominata dalle risoluzioni `did:ethr`, fisse per VP. Con k letture la verifica multipla è circa k volte più veloce.
**Fuori ambito (Fase R):** scritture multiple (Fase W), modifiche al core Rust, al resolver DID o agli smart contract, parallelismo, sottodelega, registry on-chain.

## 1. Percorso attuale (baseline, resta disponibile)

Un Task "letture + una scrittura" (`readWriteGrantShape`, fino a 15 letture) viene eseguito così:
1. il modello chiama `read_file` una volta per ogni file;
2. ogni chiamata esegue Prepare → staging del proprietario → VP con un permesso → Execute (Rust → OPA → binding → lettura Gitea → ricevuta HMAC) → attestazione del proprietario;
3. dopo l'ultima lettura attestata si esegue la scrittura.

Con k letture: **k turni del modello, k VP, k verifiche Rust** (circa k × 1,5 s per una Child).

## 2. Progetto della Fase R

**Una sola autorizzazione per tutte le letture del Task:**

1. **Prepare batch** (`POST /v1/authorization/prepare-read-batch`, `{task_id, agent_role, tool:"read_files", arguments:{branch, paths[]}}`). Il Gateway crea **N record di lettura ordinari**, uno per file, con **la stessa funzione `prepareAuthorization`** e quindi gli stessi controlli di oggi:
   - Prepare legato al ruolo;
   - permesso derivato dal Gateway;
   - preflight del Task;
   - HEAD fissata;
   - impronta per file.

   L'unica differenza è che **condividono una challenge**. Registra un batch `{batch_id, task, ruolo, request_id[], permessi[], challenge, audience, scadenza}` e risponde con challenge, audience, scadenza e l'elenco `{request_id, path, required_permission}`.
2. **Una VP** dal wallet dello specialista con i N permessi divulgati (API del wallet già esistente: `disclosed_permissions`).
3. **Per ogni file, in sequenza:** staging del proprietario → `POST /v1/authorization/execute {request_id, signed_vp}` → attestazione del proprietario.
   - Al primo Execute del batch il Gateway verifica la VP **una volta** con `verifyMultiple` sui **N permessi derivati dal Gateway** e sulla challenge del batch. Memorizza il risultato e lo SHA-256 della VP.
   - Agli Execute successivi riusa il risultato solo se la VP presentata è **byte per byte la stessa**.
   - Ogni record esegue comunque, da solo: consumo monouso, scadenza, OPA, binding con Task/Child/Root/flight/impronta, lettura alla HEAD fissata, ricevuta HMAC, attestazione indipendente.
4. **Tool del modello `read_files`** (senza argomenti oltre al branch): legge in una sola chiamata **tutti** i file di lettura firmati del Task, cioè quello che il prompt già chiede. Un turno del modello invece di k.
5. **Baseline:** `read_file` resta disponibile e invariato. La scelta tra batch e singolo è un'opzione di deployment (`batchReads`), per poter fare l'E2E comparativo.

## 3. Invarianti da preservare

| # | Invariante | Come è garantito nella Fase R |
|---|---|---|
| R1 | Prepare legato al ruolo: un agente non può preparare richieste a nome di un altro | Il nuovo endpoint passa dalla stessa fetch in-process legata al ruolo (`agent_role === role`); Execute accetta solo record del proprio ruolo |
| R2 | Il permesso richiesto è derivato dal Gateway, mai dichiarato dal chiamante | Ogni elemento passa da `prepareAuthorization` (`assertNoCallerSuppliedAuthority`, `deriveRequiredPermission`); la verifica Rust usa i permessi del batch derivati dal Gateway |
| R3 | Ogni lettura deve appartenere al Task iscritto, alla Child iscritta e alle letture firmate | Preflight per elemento invariato; staging e binding per elemento invariati (`stageTrustedSequentialReadEffect`, `assertTrustedCompletedReadEvidenceBinding`) |
| R4 | Ogni file al massimo una volta per Task; al massimo 15 letture | Il batch rifiuta percorsi duplicati e più di `MAX_TASK_READS`; staging invariato (`readPaths`) |
| R5 | Revisione Git fissata per tutte le letture del Task | Ogni record porta la `pinned_revision` del Task; il batch richiede che sia la stessa per tutti |
| R6 | Verifica crittografica completa: firma, presentatore, audience, challenge, catena, attenuazione, witness, revoca, trust anchor | Una `verifyMultiple` del core, invariato, su tutti i permessi del batch; il batch intero viene rifiutato se manca un permesso (atomicità già misurata nella Fase 1) |
| R7 | OPA per ogni operazione | Invariato: OPA viene valutata a ogni Execute, per elemento |
| R8 | Monouso e anti-replay | Ogni `request_id` viene consumato prima della verifica; la VP del batch è valida solo per i record del batch (stessa challenge, impronta della VP fissata dopo la prima verifica); un'altra VP o un record fuori batch vengono rifiutati |
| R9 | Scadenza | Il batch ha una finestra propria di 60 s (`READ_BATCH_TTL_MS`, configurabile solo verso il basso), indipendente dal TTL del Prepare (20 min per il Test Agent, necessario al Runner); la scadenza di ogni record del batch è ridotta alla finestra. La scadenza della Child e la Root attiva vengono ricontrollate per elemento dalle admissions (`#live`, `expires_at`) |
| R10 | Fail-closed | Lo stato `failed` è terminale (anche rispetto a una verifica ancora pendente). Qualsiasi Execute fallito di un elemento (verifica, OPA, binding, provider, ricevuta, replay, scadenza) termina il batch: nessun elemento successivo può riusare la VP verificata. Lato proprietario lo stager resta in `read_pending` e rifiuta staging e attestazioni successive |
| R11 | Journal ed evidenze per file | Invariati: un flight durevole, una ricevuta HMAC e un'attestazione indipendente per ogni lettura, concatenati come oggi |
| R12 | Esecuzione sequenziale dei Task e un solo flight attivo | Invariato: gli elementi sono eseguiti uno alla volta; il batch non introduce concorrenza |
| R13 | Nessuna nuova autorità | Nessun cambiamento a credenziali, Task, grant, OPA o core; il batch può solo raggruppare letture già firmate nel Task |

**Differenza semantica da dichiarare.** Lo stato di revoca viene osservato una volta per batch, alla verifica, invece che una volta per lettura. La finestra è limitata alla durata del batch, al massimo 60 s dal Prepare (non più il TTL del Prepare, che per il Test Agent è di 20 minuti). La revoca della Root operativa da parte dell'Engineer, cioè il ritiro della sessione, e la scadenza della Child restano controllate a ogni elemento.

## 4. Verifica prevista

- **Unit test del Gateway:**
  - batch valido;
  - VP diversa al secondo elemento;
  - VP con un permesso mancante;
  - challenge errata;
  - percorso duplicato;
  - più di 15 percorsi;
  - percorso fuori dal Task;
  - ruolo diverso;
  - record riusato;
  - scadenza;
  - verifica fallita che blocca il resto del batch;
  - `verifyMultiple` assente (fail-closed).
- **Suite complete:** Node, Rust e OPA; nessuna regressione rispetto alla baseline di 1.170 test.
- **E2E scripted comparativo** (senza Gemini) sullo stesso repository e Task: `batchReads` attivo e disattivo, con tempo di autorizzazione (`verification_ms` dagli eventi di audit) e tempo complessivo della sessione.
