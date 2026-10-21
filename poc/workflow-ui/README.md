# Delegation · Authorization Review UI (offline mock)

Frontend statico per la **simulazione** di revisione del piano e delle
permission del Software Engineer. Non è un sistema di emissione né un gate
di autorizzazione. Usa il contratto condiviso v1 (stesse strutture dati).

## Come aprirlo

Aprire direttamente `poc/workflow-ui/index.html` nel browser, oppure
estrarre l'artifact `delegation-approval-ui-mock` di GitHub Actions e
aprire `index.html`. Non richiede npm, server, token o chiamate di rete.
Per visualizzare e produrre un digest SHA-256 il browser deve consentire
`crypto.subtle`; se non disponibile, la revisione viene rifiutata senza
fabbricare un digest.

## Funzionalità

- Piano v1 con `plan_id`, `session_id`, `version`, repository e
  `base_revision` fissata.
- Consultazione di Task, agenti (da mock di Agent Card), dipendenze e
  risorse con URI Gitea canonici dimostrativi.
- Modifica dell'agente assegnato a un Task (aggiornamento coerente dei
  suoi permission bindings).
- Inclusione/esclusione, aggiunta, rimozione e modifica di permission;
  ogni permission lega `task_id`, `agent_id`, `resource`, `operation`.
- Incremento della versione del piano dopo modifiche sostanziali e
  calcolo SHA-256 sul JSON con chiavi ordinate come il backend.
- Differenze rispetto al piano originario e conferma simulata con
  esportazione JSON esplicitamente `simulated: true` (nessuna identità
  dell'Engineer è autenticata e nessuna DC è emessa).
- Selezionare/escludere una permission cambia l'insieme della revisione,
  non richiede la modifica del piano proposto.

Il file `mock-plan.js` contiene **solo dati dimostrativi**. L'elenco di
operazioni suggerite dalla GUI non è un secondo catalogo di authority:
il catalogo ufficiale rimane l'enumerazione Rust
`src/delegation/authorization/operation.rs`, verificata dai test CI.

## Trust boundary

**Un digest non prova chi abbia approvato un piano.** Il contenuto del
browser e l'export JSON sono tutti modificabili dall'utente e vanno
considerati input non fidati. Non usare l'export mock per emettere root
DC, child DC, verificare VP o autorizzare operazioni sui provider.

Il futuro backend trusted deve autenticare l'Engineer, risolvere i DID
delle Agent Card da un registro affidabile, fissare revisione e repository,
verificare l'autorità dell'Engineer, validare schema e URI canoniche,
controllare il catalogo Rust, persistere una decisione approvata immutabile
e usarla nel preflight dell'esecuzione. Gateway/Core Rust/OPA continuano
a verificare separatamente ogni operazione protetta.

L'interfaccia non importa repository, non interroga Gemini e non gestisce
una sessione di approvazione reale in GitHub Actions.

## Verifiche gratuite

```sh
node --test poc/workflow-ui/tests/ui-contract.test.mjs
node --test poc/packages/plan-contracts/test/plan.test.mjs
```

Il workflow `.github/workflows/workflow-ui-mock.yml` esegue entrambe
le suite su push e PR, quindi pubblica uno ZIP offline contenente anche
`review-model.js`. Non avvia Gemini a pagamento.

## Successive integrazioni

Questa UI è già compatibile a livello di struttura con lo schema di
proposta, ma le sue azioni restano mock. L'integrazione con il backend
trusted e l'approvazione interattiva reale resta nella fase finale
prevista dopo l'E2E in GitHub Actions. Il dimostratore IAM Console è una
repository bersaglio separata da questa GUI.

## Bridge GUI → firma Ed25519 (solo selezione, senza login GUI)

Il pulsante **Esporta selezione JSON (non firmata)** produce un file
`mock_authorization_review`, che resta non attendibile. Per provarne il
collegamento al comando di firma esistente, l'operatore autorizzato può usare:

```sh
ENGINEER_DID=did:thesis:software-engineer \
  node poc/apps/orchestrator/src/sign-engineer-approval.mjs \
  --review /trusted/approved-plan.json /downloads/delegation-plan-review-mock.json \
  /secure/approvals /secure/keys/engineer-ed25519.pem engineer-pinned-key-v1
```

**Importante:** `/trusted/approved-plan.json` deve essere ottenuto
**indipendentemente** dal processo trusted (repository, SHA, versione e schema
già validati), non copiato dall'export del browser. Il bridge verifica l'esatta
corrispondenza del digest del piano, l'insieme di permission ID selezionati ed
esclusi e nega piani modificati, permessi nuovi e versioni differenti.
L'identità, il timestamp e l'ID della decisione sono generati dal comando,
non dal browser. La chiave privata viene usata soltanto nel processo CLI e
la firma richiede ancora la digitazione interattiva dell'intero SHA-256.

Questo **non** autentica una sessione web, non sostituisce la verifica
dell'authority dell'Engineer e non attiva autonomamente root DC o Gateway.
I cambiamenti sostanziali fatti nella GUI mock non possono essere firmati
in questa modalità finché il backend trusted non ha validato una nuova
versione del piano. La futura GUI autenticata e il trasporto fra processi
restano attività distinte.

Test gratuiti:
`node --test poc/packages/plan-contracts/test/review-bridge.test.mjs`
