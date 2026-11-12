# R385.6 — Recovery rigoroso: lettura diagnostica autentica prima delle UPDATE

Data: 8 novembre 2026. PR #38 Draft, branch
`refactor/post-prof-plan-contracts-20261021`.
**Non** sono state eseguite inferenze a pagamento né workflow nativi Full E2E
per introdurre questa modifica.

## Perché

R385.5 ha chiuso il checkpoint gratuito di integrazione **sulla stessa
SHA `339a8b1`**, con Fast CI #42440148395 SUCCESS ed E2E nativo
#42440148389 SUCCESS: Engineer direttamente su Rust, Gateway verificatore
Rust, EVM/OPA, MCP crittografico Child/VP task-local, Gitea, A2A,
Docker FAIL → D1 CREATE e correzioni scripted → Docker PASS e
Draft PR nella Gitea disposable.

Il JSONL di quella prova dichiara esplicitamente
`source_code_generated_autonomously_by_model: false`,
`authenticated_diagnostic_source_seen_by_decider: false`,
`signed_read_only_diagnostic_tasks: 0` e
`attested_test_agent_project_test_repairs: 0`.
**Non** è una prova di riparazione autonoma basata sul sorgente.

La capacità di lettura isolata via Child MCP esiste già
nel percorso adaptive R376.2, e il Gateway conserva le proprie
attestazioni. Mancava tuttavia un *vincolo di provenienza* tra
la lettura autentica e la successiva decisione **post-FAIL** di
modificare il file.

## Implementazione

1. Nuovo selettore puro fail-closed
   `trusted-authority-only-repair-diagnostic-gate.mjs`.
   Accetta solo un Task UPDATE autorizzato dal percorso precedente
   e **una e una sola** lettura indipendente che:
   - appartiene allo stesso agente Backend, Frontend o Test;
   - riguarda esattamente lo stesso ResourceURI dell'UPDATE;
   - è un Task separato **con un solo permesso `read_file` firmato**;
   - è stato registrato in un'epoch **successiva** al vero Test FAIL;
   - è completato nel ledger originale del Gateway;
   - possiede la stessa HEAD corrente e il digest di evidenza
     riconciliato tra osservazione e Gateway.
   Il risultato è una prova congelata **non autorizzativa**:
   non emette credenziali, non esegue provider e non amplia la Root.

2. Il Review Host privato
   `trusted-authority-only-review-host.mjs`
   costruisce queste prove esclusivamente da
   `adaptiveSourceObservations` (popolata dopo
   `AuthenticatedGiteaReadCompletionObserver.prototype.observeSource`),
   `stagedTaskIds`, `gatewayAttestedTaskIds`,
   `operationalCoordinator.assertTrustedGatewayRegisteredTask`
   e `gateway.assertTrustedCompletedReadObservationBinding`.
   Modello/A2A non possono fornire queste porte o evidenze.
   Il Core Rust originario e il digest dell'autorità sono
   nuovamente confermati prima di ammettere il gate.

3. `runTrustedAuthorityOnlyAdaptiveWorkLoop` supporta il flag
   privato `requireVerifiedRepairDiagnostic: true`.
   Dopo un Test FAIL autenticato, **prima di staging, Child o provider**,
   UPDATE deve superare la verifica e una nuova lettura di contesto
   garantisce che Gateway, Root, HEAD e ledger non siano cambiati
   durante il gate. Un errore chiude la Root (fail-closed).
   La lettura prima del FAIL **non** è sufficiente: serve una
   lettura successiva, sulla stessa HEAD, nello stesso ruolo e file.
   Una CREATE post-FAIL è rifiutata in questa modalità finché
   non si definisce un distinto percorso di investigazione
   adatto a un file non ancora esistente. Nessuna conclusione
   Docker PASS o PR deriva dalla lettura.

4. L'opzione è **solo opt-in, non un nuovo permesso**:
   `canonical-owner-deployment.mjs` la accetta
   **esclusivamente se impostata a `true` nel file di
   deployment protetto**, e la inoltra al launcher in-process.
   Il launcher rifiuta valori falsi, oggetti o stringhe.
   I vecchi scenari scripted non vengono cambiati di nascosto
   e conservano la configurazione senza flag. Questa tappa
   non afferma che il flag sia già attivato nel pilot reale.

## Regressioni mirate

- `trusted-authority-only-repair-diagnostic-gate.test.mjs`:
  permette gli UPDATE test/source solo con provenienza esatta;
  nega letture prima del Test FAIL, stantie, ruolo diverso,
  resource diverso, MAC/digest discordanti, completion mancante,
  grant modificati, Task riciclati, prova ambigua e CREATE.
- `trusted-authority-only-adaptive-work-loop.test.mjs`:
  in modo rigoroso, una UPDATE senza lettura chiude la Root
  **prima** di ogni dispatch; con una lettura separata verificata
  il flusso completa il retest senza ampliare i grant. Negativi
  per mancato verificatore e CREATE post-FAIL; D0 continua a
  funzionare senza leggere sorgenti in assenza di FAIL.
- `trusted-authority-only-operational-launcher.test.mjs`:
  verifica il passaggio attraverso il solo owner e rifiuta
  valori impropri nel config.
- La Fast CI esegue questi test e le regressioni originali
  senza invocare modelli a pagamento.

## Cosa NON è dimostrato

**R385.6 rimane da certificare con Fast CI sulla SHA finale.**
Questi test non equivalgono a un nuovo E2E Rust/EVM/Docker.
Per non ripetere la Full CI costosa per ogni refactoring,
la tappa conserva la proof nativa R385.5 sulla sua SHA storica
e richiede una futura proof post-modifica per chiudere il
nuovo checkpoint end-to-end.

La modalità rigorosa non genera autonomamente codice, non
decide se il Test sia erroneo invece dell'applicazione, non
effettua CREATE sotto investigazione rigorosa e non prova
che un agente Test abbia corretto davvero il proprio
file in un E2E nativo. Sono obiettivi distinti da affrontare
nella roadmap. Nessuna modifica a `main`, nessun merge,
nessuna inferenza Gemini senza consenso esplicito.
