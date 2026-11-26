# Osservazioni: due sessioni reali con Gemini prima e dopo le Fasi R + W

**Fonte dei dati.** Le pagine di sessione della console Sigillo, copiate dall'Engineer il 26/11/2026:
- sessione `s-452aae5f0226`, "prima";
- sessione `s-ff31670e573f`, "dopo", su `main` `9f471e50`, con la Fase W attiva per default.

Repository `thesis/iam-console-poc`, modello `gemini-3.8-flash`. I numeri seguenti sono ricavati dalla cronologia, dal riepilogo e dalla tabella delle chiamate a Gemini di quelle pagine.

> **Natura del confronto.** Sono due sessioni singole, non un esperimento controllato. Differiscono per:
> 1. il **testo del requisito**: il secondo è più breve e non chiede esplicitamente di aggiornare i test esistenti;
> 2. il **commit di partenza** della repository (`50e6cca55b` contro `da7a13aef5`; il numero della Draft PR è ripartito, quindi la repository è stata reimportata);
> 3. la **non determinazione** del modello;
> 4. le **ottimizzazioni attive**. Nella sessione "prima" gli specialisti leggono un file per volta con `read_file`; quando le letture batch sono attive, `read_file` viene nascosto e si usa `read_files`. La sessione "prima" è quindi stata eseguita **senza la Fase R e senza la Fase W**. Il confronto misura l'effetto combinato di R + W, non quello della sola Fase W.
>
> I numeri descrivono queste due sessioni; non stimano un effetto medio. La valutazione quantitativa controllata resta la campagna scripted della Fase W4 (`../phase-w-w4/`, `docs/PHASE_W_RESULTS.md`).

## 1. Metriche a confronto

| Metrica | Prima | Dopo | Variazione |
|---|---|---|---|
| Durata riportata dalla console (Planning + revisione + esecuzione) | 15 min | 9 min | −40% |
| Esecuzione (firma → Draft PR) | 13 min 20 s (09:10:31 → 09:23:51) | 7 min 45 s (07:00:58 → 07:08:43) | −335 s (−42%) |
| Planning | 30 s, 3 chiamate, 25.203 token | 33 s, 3 chiamate, 25.286 token | invariato |
| Permessi firmati | 28 | 30 | +2 (il secondo piano include `tests/e2e/user-profile.spec.ts`) |
| Task specialisti (= Child DC) | 12 (Backend 5, Frontend 3, Test 3, `run_tests` 1) | 7 (Backend 1, Frontend 2, Test 1 + riparazione 1, `run_tests` 2) | −42% |
| Chiamate a Gemini | 80 | 32 | −60% |
| di cui Orchestrator in esecuzione | 15 | 10 | −33% |
| di cui specialisti | 62 | 19 | −69% |
| Token totali | 314.054 | 160.938 | −49% |
| Token medi per chiamata | 3.926 | 5.029 | +28% |
| Decisioni del Gateway (una valutazione OPA ciascuna) | 61 | 44 | −28% |
| di cui letture | 47 | 27 | −43% |
| di cui scritture | 11 | 13 (12 per la funzionalità + 1 di riparazione) | +2 |
| Pubblicazioni atomiche di write-set | 0 | 3 (Backend 5 file, Frontend 2, Test 4) | |
| Commit applicativi (stima dalle decisioni) | 11 | 5 (3 write-set + stile + riparazione) | −55% |
| Esecuzioni del Runner | 1 (PASS) | 2 (FAIL, poi PASS) | +1 |
| Negate | 0 | 0 | |

**Da dove viene la riduzione delle chiamate al modello.** Si possono attribuire tre meccanismi, osservabili nella tabella delle chiamate:
1. **Letture in una sola chiamata (Fase R).** Prima, il Backend usava una chiamata per ogni file letto: per esempio 5 chiamate di lettura nel Task del service. Dopo, una sola chiamata `read_files` legge da 3 a 9 file.
2. **Scritture in una sola chiamata (Fase W).** Una sola chiamata `write_files` genera 5, 2 o 4 file, contro una chiamata `update_file` per file.
3. **Meno Task.** Ogni Task costa almeno una chiamata dell'Orchestrator per delegarlo e una chiamata finale di resoconto dello specialista. Con 7 Task invece di 12 le chiamate dell'Orchestrator scendono da 15 a 10, e spariscono i resoconti intermedi.

**Ridondanza eliminata.** Prima, gli stessi file venivano riletti in molti Task: per esempio `account-status.ts` è stato letto 7 volte e `user-contracts.ts` 7 volte. Dopo, ogni Task li legge una volta. Il calo delle letture (da 47 a 27) è dovuto a meno riletture, non a meno controlli per operazione: anche dopo, ogni lettura e ogni scrittura riceve la propria decisione OPA.

**Contesto per chiamata più grande.** Le chiamate sono meno numerose ma più "dense": +28% di token medi per chiamata. La chiamata più grande è `write_files` del Test: 6.527 token in ingresso e 3.732 in uscita, per 4 file di test in un'unica generazione. Prima, i 3 file di test erano generati in 3 chiamate da 820, 793 e 1.350 token in uscita.

## 2. Il fallimento dei test e la riparazione

**Che cosa è successo:**
- Il primo `run_tests` è fallito nella fase `frontend_tests`, con 2 test di `tests/frontend/UserDetailPage.test.tsx` ("Unable to find an element with the text: Alice Romano / Bob Smith").
- Il messaggio passato al Task di riparazione indica la causa: `Unhandled request: /api/users/usr-001`. Il mock di `fetch` scritto nel test rispondeva solo se `init?.method === "GET"`. Ma `getUser` in `apps/frontend/src/api/users-api.ts` non passa `method` per le GET, quindi la richiesta della pagina restava senza risposta.
- Il Runner ha restituito un FAIL verificato. L'Orchestrator ha delegato una riparazione mirata del solo file di test, con lettura di `UserDetailPage.tsx` e `users-api.ts`. Il secondo `run_tests` è passato su tutte le 6 fasi.
- Il ciclo "FAIL verificato → riparazione firmata → nuovo `run_tests`" ha funzionato come previsto.

**Costo del fallimento.** Dalla delega del primo `run_tests` (07:04:09) alla delega del secondo (07:06:27) passano circa 2 min 18 s. Senza il fallimento l'esecuzione sarebbe stata di circa 5 min 30 s invece di 7 min 45 s. È solo una stima controfattuale, perché presuppone che il resto della sessione resti identico.

### 2.1 Ipotesi sulla causa, in ordine di supporto empirico

**H1 — Contesto insufficiente nel Task di test aggregato (ipotesi più supportata).**
- Il Task write-set del Test ha scritto 4 file leggendo 9 file. Tra le letture **non c'era `apps/frontend/src/api/users-api.ts`**, cioè il file che definisce come la pagina chiama `fetch`, esattamente ciò che il mock doveva imitare.
- La riparazione ha letto proprio quel file e ha corretto il mock.
- Nella sessione "prima", il Task del test frontend leggeva `users-api.ts` (09:20:12), e il test è passato al primo tentativo.
- Il limite dei 16 permessi non c'entra: il Task usava 13 permessi (9 letture + 4 scritture), quindi c'era spazio per altre letture.
- La causa più probabile è quindi la **scelta delle letture fatta dall'Orchestrator** per un Task che copre più file. Con un Task per file, le letture erano mirate al singolo file; con un Task che copre backend, route, frontend ed e2e, la selezione è stata più grossolana e ha tralasciato una dipendenza diretta del test frontend.
- È un effetto del raggruppamento, ma riguarda la pianificazione del contesto, non il numero di chiamate in sé.

**H2 — Generazione più lunga in una sola chiamata (plausibile, non dimostrata).**
- Generare 4 file in una chiamata (3.732 token in uscita) dà al modello meno occasioni di "fermarsi", e un errore non può essere corretto tra un file e l'altro.
- Però l'errore riguarda un solo file su 4, e i write-set del Backend (5 file) e del Frontend (2 file) hanno superato typecheck e test al primo tentativo.
- Avere tutti i file nello stesso contesto può anzi favorire la coerenza tra file, come si vede nel Backend.
- Con una sola sessione non si può separare H2 da H1.

**H3 — Requisito meno specifico (confondente, non escludibile).**
- Il secondo requisito non dice di aggiornare i test esistenti né di aggiungere API, pulsanti e indicazione di stato. Il piano risultante è diverso:
  - aggiunge l'e2e;
  - modifica `user-contracts.ts` invece di `user.repository.ts`;
  - nel frontend usa `PATCH /api/users/:id/status` invece di endpoint separati di sospensione e riattivazione.
- Il difetto osservato non riguarda però i test che verificavano la "sospensione non disponibile": è un errore di mock legato al client API. Il requisito più breve può aver portato l'Orchestrator a deleghe più ampie e meno dettagliate, e quindi favorito H1, ma non è la causa diretta osservabile.

**H4 — Variabilità del modello.** Con una sola esecuzione per variante, un errore di mock può comparire anche con il flusso a un file per Task.

### 2.2 Il minor numero di chiamate peggiora la qualità?

Sulla base di queste due sessioni, **non c'è evidenza che il minor numero di chiamate in sé peggiori la qualità**:
- 2 dei 3 write-set e il passaggio di stile sono corretti al primo tentativo;
- l'unico difetto ha una causa specifica e verificabile: una lettura mancante;
- anche contando la riparazione, l'esecuzione resta più breve del 42% e consuma il 49% di token in meno.

Il raggruppamento sposta però la responsabilità sulla **scelta del contesto** di Task più ampi:
- Con un Task per file, le letture di ogni Task erano mirate e i file già modificati venivano riletti ogni volta.
- Con un write-set, l'Orchestrator deve elencare in un solo Task le dipendenze di tutti i file, e un'omissione si ripercuote su più file generati insieme.
- Inoltre, all'interno di un write-set lo specialista non vede l'effetto delle proprie scritture prima di produrre quelle successive.

## 3. Che cosa si può affermare nella tesi

- **Sì:** in una sessione reale con Gemini sulla stessa funzionalità, R + W hanno ridotto:
  - il tempo di esecuzione (−42%);
  - le chiamate al modello (−60%);
  - i token (−49%);
  - i Task e le Child (da 12 a 7);
  - le decisioni del Gateway (−28%, per l'eliminazione delle riletture ridondanti; resta un controllo OPA per ogni operazione).
- **Sì:** la direzione dei risultati è coerente con la campagna scripted controllata della Fase W4.
- **Sì:** l'unico fallimento è stato rilevato dal Runner indipendente e riparato con un Task firmato, senza intervento umano e senza permessi aggiuntivi.
- **No:** queste due sessioni non permettono di stimare un effetto medio, né di attribuire la riduzione alla sola Fase W. Non permettono nemmeno di stabilire con certezza la causa del fallimento: requisito, commit di partenza e piano sono diversi tra le due sessioni.

## 4. Possibili approfondimenti (non eseguiti; prototipo congelato)

- **Esperimento controllato con Gemini:** stesso requisito, stesso commit, n ≥ 5 per variante (baseline, R, R + W), con misura degli errori di test al primo `run_tests`. Ha un costo in API a pagamento, quindi richiede l'autorizzazione dell'Engineer.
- **Prompt dell'Orchestrator per i write-set:** si potrebbe richiedere, per ogni file scritto, la lettura dei file che ne definiscono le API usate (per un test frontend: la pagina e il suo client API). La regola generale esiste già ("Give every Task read_file of the files that define the data, types and APIs its file uses"), ma in questo caso non è stata applicata per tutti i file del Task.
- **Separare i write-set di test per livello** (backend, frontend, e2e), così che ciascuno abbia letture mirate.
