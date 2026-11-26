# Fase W — Risultati finali: Atomic Write-Set Publication

**Branch:** `feature/batch-write-design`.
- **Commit precedenti:** W0–W2 (`a63e422c`, `e151207d`, `c2bc17e2`, `c7fe03a1`) e W3 (`16d058bc`, `4bbb5c3d`).
- **W4:** il commit che aggiunge questo file.
- **`main`:** invariato (`b3222ee1`).

**Altri documenti:**
- progetto e invarianti: `docs/PHASE_W_BATCH_WRITE_DESIGN.md`, §0–§15;
- dati grezzi, script, configurazioni e seed: `docs/experiments/phase-w-w4/`.

**Vincoli rispettati:**
- nessuna API a pagamento: tutte le sessioni sono `scripted` e `GEMINI_API_KEY` è vuota;
- nessuna modifica a core Rust, resolver DID o smart contract.

**Immagine usata per la sicurezza e per la campagna:** `delegation-app:phase-w4`.
- È costruita da `delegation-app:local` più l'albero `poc/` di W4.
- L'albero `poc` dell'immagine (`f997e709…`) coincide con quello del commit W4.

## 1. Correzione preliminare del proposer

- Con `batchWrites` attivo, la regola generale del workflow chiede **un Task per passo di uno specialista**. Tutte le scritture dello stesso passo vanno in un Task write-set (da 2 a 8); un singolo file resta un Task a una scrittura.
- Con l'opzione disattivata il testo è identico a prima.
- Test: `write-set-proposer.test.mjs`, che ora contiene 4 test e verifica il prompt in entrambe le modalità.

## 2. Validazione di sicurezza sullo stack reale

**Stack:**
- Anvil con did:ethr, `IssuerRegistry` e Status List;
- Gitea 28;
- OPA;
- Runner;
- verificatore Rust nativo;
- repository `thesis/batch-bench`.

**Come è stata eseguita la prova:**
- La pausa tra lo staging e la seconda verifica è ottenuta con l'hook sperimentale descritto in §15 del progetto. L'hook è assente nei deployment normali.
- **Revoca:** è stata revocata on-chain la **Root operativa**, cioè l'antenata della Child, attraverso il percorso reale dell'Engineer (`revokeRoot` → `updateStatusList`). Il prodotto non espone una revoca della Child, e questa è la scelta approvata.

### 2.1 Revoca tra staging e seconda verifica (`raw/security/revoke-mixed.json`)

| Fatto | Evidenza |
|---|---|
| VP valida all'inizio | Il primo elemento del write-set è verificato da Rust (`batch_verification: performed`, 18:06:49.9Z); gli altri 4 elementi sono validati con riuso e OPA |
| Write-set misto | 4 `update_file` + 1 `create_file` (`src/ledger/fees.js`) del Backend |
| Staging eseguito | ref `feature/w2-write-set-ef24f181…`, commit `730fee67…` |
| Revoca registrata on-chain | `StatusListUpdated` al blocco 31 (18:06:52Z), versione 3 della Status List della Root. La versione 2, al blocco 29, è la revoca della Root preliminare all'approvazione. La console ha avuto conferma dopo 7.024 ms |
| Seconda verifica rifiutata | 18:07:00.8Z, `VerificationRejectedError: Rust Core rejected the signed VP or trust context` |
| Nessun HEAD-CAS | Supportato da due elementi: il percorso di controllo del codice (la seconda verifica precede `markTrustedWriteSetCasSent` e il CAS, e un suo rifiuto termina il write-set prima dell'invio) e la HEAD del branch di lavoro, ancora uguale al commit base `c7a8718b…` (`gitea-evidence.txt`). **Non** c'è un contatore indipendente delle richieste HTTP a Gitea |
| Task non completato, nessuna Draft PR | Sessione `failed`, `pull_request: null`; l'ultima PR prima di questa prova è la #55 |
| Ref di staging | Conservato per la riconciliazione, come previsto dal §4 del progetto |

**Esito della policy ed esito dell'esecuzione.** Nel log della sessione l'ultima decisione riporta `decision: allow`: è l'esito di OPA, che aveva autorizzato l'operazione. L'**esecuzione** di quella stessa decisione è invece fallita, perché la seconda verifica crittografica, eseguita dopo OPA, ha rifiutato la VP; la pubblicazione è stata quindi bloccata. Le due cose vanno lette separatamente: `allow` non significa che l'operazione sia stata eseguita.

**Osservazione da riportare.** L'audit classifica il rifiuto dell'ultimo elemento come `provider_unavailable`. È la classe con cui l'executor riporta gli errori che avvengono prima del CAS, e la causa crittografica si vede solo nel log. Inoltre la console chiude la sessione con "Root retirement unconfirmed": il ritiro finale trova la Root già revocata. In entrambi i casi l'esito è sicuro (fail-closed), ma la diagnostica è meno precisa di quanto potrebbe essere.

### 2.2 Controllo positivo (`raw/security/control-mixed.json`)

- Stesso requisito, stessa pausa, nessuna revoca.
- La seconda verifica riesce (1.705 ms).
- Viene pubblicato un solo commit `a1ddc24b…`, con parent uguale alla base e i 5 file firmati (4 modificati, 1 creato).
- Il ref di staging viene rimosso.
- La sessione si completa con la Draft PR #56.

### 2.3 Write-set di sole creazioni (`raw/security/creates-only.json`)

- Sono approvati soltanto `create_file` più i permessi di repository e branch.
- Il risultato è un write-set di 2 creazioni (`fees.js`, `taxes.js`), con una sola VP e un solo commit `cbcb26ac…`.
- La sessione si completa con la Draft PR #57.

### 2.4 Ref di staging inaccessibili agli strumenti degli agenti

- Durante la pausa, sia nella prova di revoca sia nel controllo, sono state chiamate le stesse route del Gateway legate al ruolo che usa il worker Backend. Il branch indicato era il ref di staging, e le operazioni provate sono `read_file`, `update_file` e `write_files`.
- Tutte e 3 le operazioni sono rifiutate in entrambe le sessioni con `Authority-only Gateway admission: operation outside signed work branch`.
- I ref di staging restano comunque branch ordinari del repository, leggibili da chi ha accesso al repository: sono **isolati e vietati agli agenti**, non riservati.

I test negativi di W1–W3 non sono stati ripetuti dal vivo.

## 3. Campagna sperimentale

**Disegno:**
- Varianti:
  - **base:** Fase R attiva, W disattivata;
  - **ws:** R + W in modalità rigorosa.
- Dimensioni: k = 2, 4 e 8 scritture del Backend.
- 6 ripetizioni per cella, cioè 36 sessioni misurate.
- Ordine casuale con seed `20261125` (Mersenne Twister, `make-plan.py`).
- Per ogni sessione misurata i container dello stack vengono ricreati (`docker compose down` / `up`). I **volumi Docker persistono** (dati di Gitea, stato della console, configurazione), quindi l'ambiente non è completamente vergine: per esempio il repository `batch-bench` accumula branch e Draft PR delle sessioni precedenti.
- Prima di ogni sessione misurata c'è un warm-up escluso dalle misure. Il warm-up usa **sempre lo stesso workload da 2 scritture** ("Stock items: record each change"), nella stessa variante della sessione misurata, qualunque sia il k misurato.

**Requisiti** (`campaign.sh`): ogni requisito seleziona esattamente k moduli applicativi e nessun file di test. Tra le due varianti sono quindi uguali lo scope approvato (stessi permessi), il workload scripted (gli stessi file ricevono la stessa modifica marcata) e il superamento dei test del Runner. L'equivalenza è limitata a questo: non è stata verificata l'identità byte per byte dei contenuti (il marcatore contiene l'ID della sessione) né un'equivalenza nella generazione di codice con modelli reali.

| k | Requisito | Permessi approvati |
|---|---|---|
| 2 | "Stock items: record each change" | 7 |
| 4 | "Orders returns transfers counts: record each change" | 11 |
| 8 | "Inventory: record each change" (`DELEGATION_SCRIPTED_PLAN_FILES=8`) | 19 |

In ogni cella il Task write-set più grande ha 2k ≤ 16 permessi.

**Esito:** 36 sessioni su 36 completate con Draft PR; nessun tentativo fallito, nessuna deviazione dal piano.

### 3.1 Conteggi (identici in tutte le 6 ripetizioni di ogni cella)

| k | Variante | Task (= Child DC) | VP | Verifiche complete | OPA | Decisioni | Commit | Chiamate tool |
|---|---|---|---|---|---|---|---|---|
| 2 | base | 3 | 8 | 8 | 8 | 8 | 2 | 5 |
| 2 | ws | 2 | 6 | 7 | 8 | 8 | 1 | 3 |
| 4 | base | 5 | 12 | 12 | 12 | 12 | 4 | 9 |
| 4 | ws | 2 | 6 | 7 | 12 | 12 | 1 | 3 |
| 8 | base | 9 | 20 | 20 | 20 | 20 | 8 | 17 |
| 8 | ws | 2 | 6 | 7 | 20 | 20 | 1 | 3 |

Nella baseline crescono linearmente con k i Task (k + 1), le VP (2k + 4), i commit (k) e le chiamate ai tool (2k + 1). Con W restano costanti:
- 2 Task;
- 6 VP;
- 7 verifiche complete (6 più la seconda verifica rigorosa);
- 1 commit;
- 3 chiamate ai tool.

Le valutazioni OPA e le decisioni del Gateway restano **una per operazione** in entrambe le varianti: il controllo per singola operazione non è stato eliminato.

**Come sono contati:**
- **VP:** le richieste singole più il primo elemento di ogni batch.
- **Child:** una per Task specialista. `create_branch` e la PR usano la Root operativa.
- **Chiamate tool:** quelle dei modelli scripted nella sessione misurata.
- **Operazioni Git:** è stato contato soltanto il numero di commit pubblicati. Le chiamate API interne a Gitea (staging, confronto, letture di controllo, rimozione del ref) non sono strumentate.

### 3.2 Tempo di esecuzione (dall'approvazione al completamento; mediana di 6)

| k | base (ms) | ws (ms) | Δ ws − base (IC 95%) | Rapporto ws/base (IC 95%) |
|---|---|---|---|---|
| 2 | 29.712 | 25.220 | −4.492 [−5.025, −2.996] | 0,849 [0,834, 0,897] |
| 4 | 43.264 | 25.706 | −17.558 [−18.088, −17.044] | 0,594 [0,582, 0,606] |
| 8 | 71.344 | 25.212 | −46.132 [−46.160, −45.620] | 0,353 [0,353, 0,361] |

**Metodo statistico:** bootstrap con 10.000 ricampionamenti della mediana, gruppi indipendenti, PRNG con seed `20261125` (`analyze.py`).

**Risoluzione delle misure.** I tempi sono raggruppati a passi di circa 1 s, perché il driver legge lo stato della sessione ogni secondo e i cicli interni di polling A2A seguono la stessa cadenza. Le differenze inferiori a circa 1 s non sono risolvibili. Per questo il tempo della variante ws appare costante in k: l'aumento dovuto al numero di file resta al di sotto della risoluzione. Non è una dimostrazione di costo costante: nell'intervallo k = 2–8 il costo aggiuntivo delle scritture in un write-set è molto inferiore a quello di un Task in più.

### 3.3 Beneficio crittografico e miglioramento del workflow

| k | Δ tempo di verifica (ws − base) | Quota del Δ di esecuzione | Seconda verifica rigorosa (mediana) |
|---|---|---|---|
| 2 | −1.630 ms | 36% | 1.602 ms |
| 4 | −7.920 ms | 45% | 1.646 ms |
| 8 | −20.953 ms | 45% | 1.649 ms |

- **Rapporto descrittivo:** il tempo di verifica è la somma dei `verification_ms` e della seconda verifica. La riduzione mediana del tempo di verifica vale il 36–45% della riduzione mediana del tempo di esecuzione. È un **rapporto tra differenze di mediane**, non una scomposizione causale: le componenti non sono state misurate isolandole, possono sovrapporsi nel tempo e non sono additive in senso stretto.
- **La parte restante** è compatibile con la riduzione dei Task, che però non è stata attribuita voce per voce:
  - meno Child da emettere;
  - meno dispatch A2A e meno cicli di polling;
  - meno staging e attestazioni del proprietario;
  - un solo commit e un solo CAS al posto di k.
- Il guadagno complessivo **non** va quindi attribuito alla sola verifica crittografica, né diviso con precisione tra le singole cause.
- La modalità rigorosa costa una verifica completa in più per ogni write-set, già inclusa in queste misure.

### 3.4 Modalità standard

La modalità standard (senza seconda verifica) **non è stata misurata end-to-end**: non è esposta dalla console e richiederebbe un'opzione di deployment in più. Il suo effetto atteso è la rimozione della seconda verifica, cioè circa 1,6 s per write-set (misura diretta di `reverification_ms`), al prezzo della semantica di revoca più debole descritta nel §4.3 del progetto.

## 4. Limiti

- Modelli **scripted**: le modifiche sono commenti marcati e gli agenti non ragionano. I tempi dei modelli reali si sommerebbero in entrambe le varianti e, per una sessione LLM, ridurrebbero la quota relativa del guadagno.
- Una sola macchina virtuale condivisa con Anvil locale; il rumore è mitigato dalla ricreazione dei container per ogni sessione (con volumi persistenti), dal warm-up fisso da 2 scritture e dall'ordine casuale.
- Sei ripetizioni per cella: gli intervalli bootstrap sono indicativi, con un campione piccolo.
- La modalità standard non è stata misurata end-to-end (§3.4).
- Il TOCTOU residuo tra la seconda verifica e il CAS (§4.3 del progetto) resta: la prova di revoca non lo elimina.
- Equivalenza funzionale limitata a scope, workload scripted e test superati (§3).
- Risoluzione di circa 1 s sul tempo di esecuzione (§3.2).
- La revoca è stata provata sull'**antenata** (la Root operativa), non direttamente sulla Child.
- Le chiamate API interne a Gitea non sono strumentate.

## 5. Test

**Suite:**

| Suite | Test superati |
|---|---|
| gateway | 245 |
| agent-runtime | 219 |
| orchestrator-runtime | 371 (+2 hook W4, +1 prompt del proposer) |
| console | 61 |
| orchestrator | 74 |
| plan-contracts | 31 |
| mcp-shared | 26 |
| OPA | 52/52 |

Il core Rust non è stato modificato.

**Test unitari dell'hook:**
- viene eseguito dopo lo staging (ref presente, HEAD invariata) e dopo la sola prima verifica;
- con una revoca simulata non parte nessun CAS e il write-set va in `failed`;
- il controllo positivo pubblica;
- l'hook viene rifiutato in modalità standard.
