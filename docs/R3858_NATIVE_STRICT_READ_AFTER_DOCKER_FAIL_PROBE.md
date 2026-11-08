# R385.8 — Probe nativa: lettura firmata *dopo* Docker FAIL, prima del primo CAS D1

Data: 8 novembre 2026. Branch `refactor/post-prof-plan-contracts-20261021`, PR #38 Draft.

## Punto di partenza

R385.5 Fast CI #42440148395 ed E2E nativo #42440148389 sono
entrambi SUCCESS sulla SHA `339a8b1`: Root Engineer diretta al
Core Rust, Gateway public-only, EVM, OPA, Child/VP MCP task-local,
Gitea, A2A, Docker FAIL → D1 scripted → Docker PASS e Draft PR.
Quel test **non** esercitava una lettura diagnostica distinta
*dopo* il Runner FAIL. R385.6 e R385.7 hanno aggiunto il gate
rigoroso e un test offline con decisione condizionata a sorgenti
differenti, ma **non** hanno ancora una nuova prova nativa sulla
SHA modificata.

## L'intervento

La suite preesistente
`poc/packages/orchestrator-runtime/test/r375-native-protected-main-functional-draft-pr-e2e.mjs`
conserva esattamente la modalità originale come default.
Soltanto in presenza del flag **privato di CI**
`R3858_NATIVE_STRICT_POSTFAIL_PROBE=1`:

- Rifiuta le varianti pre-FAIL R376/R377 e richiede
  `R3818_CANONICAL_NATIVE_MCP=1`.
- Crea la stessa feature branch disposable dal main Git
  temporaneo, con l'unica approvazione Engineer Ed25519
  immutabile e Root diretta Rust.
- Dopo due modifiche D0 sotto Task/Child separati, lancia
  il primo **vero Test Runner Docker**, che deve FAIL.
  Un A2A error non diventa un fallimento autenticato.
- Il successivo turno ADK offline deve vedere il fallimento
  verificato, ma **nessuna** `source_observations` post-FAIL.
  Seleziona un Task Backend `read_file` **solo lettura**
  con un nuovo Child MCP e permesso esattamente incluso nel
  grant Engineer originale.
- Dopo il completamento autenticato del Gateway e la lettura
  indipendente Gitea, il turno seguente deve vedere una
  `source_observations` con la HEAD, il digest e l'estratto
  del file effettivamente letto. Il controllo R385.6
  `requireVerifiedRepairDiagnostic:true` richiede che
  il read sia successivo all'epoch del Test FAIL, appartenga
  allo stesso ruolo/file/HEAD e sia confermato dal Gateway.
- Soltanto allora si esegue il primo Task D1 di
  `read_file` + `update_file` sul medesimo file con
  stager nativo, CAS e receipt. L'editor è tuttora una
  **fixture scripted**, non un LLM che genera codice.
- Per impedire una falsa dichiarazione di successo
  funzionale, il turno ADK successivo restituisce
  `blocked`: l'owner ritira la Root, non tenta un
  altro Test, non crea Draft PR, e la prova controlla
  esplicitamente che esistano **una ricevuta Docker FAIL
  e zero ricevute Docker PASS**, una sola lettura post-FAIL
  e precisamente tre CAS (due D0 + prima D1).

L'esecuzione nativa è separata dal Fast CI:
`.github/workflows/r3858-native-strict-postfail-diagnostic-probe.yml`
supporta `workflow_dispatch` o un checkpoint dedicato
`.github/ci-checkpoints/r3858-native-strict-postfail-probe-request.json`.
È una **prova gratuita con zero chiamate Gemini/OpenAI**,
con teardown dei servizi e nessuna scrittura su `main`
o merge del PR GitHub.

## Prima run: configurazione originale bloccata, senza recovery

La run [#42445318317](https://github.com/DarkGh0st03/delegation/actions/runs/42445318317)
sulla SHA `7805215` è **FAIL**, non un PASS applicativo:
compilazione dei due addon Rust riuscita, ma il test
R375 ha rifiutato **prima dell'avvio dell'owner**
`DELEGATION_GATEWAY_ARCHITECTURE` mancante (valore
atteso `authority-only` nel percorso MCP privato).

Il workflow era stato derivato dalla vecchia suite R376,
che non impostava quel flag. L'architettura R3844
invece lo impostava correttamente **solo sullo step
dell'owner**, non sull'intero job che verifica il rifiuto
dell'Adapter legacy. R385.8 applica quel medesimo
isolamento e aggiunge controlli espliciti anti-downgrade
**dopo** aver caricato gli env temporanei, oltre a
`set -euo pipefail` e asserzioni JSONL su Test FAIL,
lettura firmata, primo CAS e zero PASS/PR.
Un nuovo test Fast CI blocca la ricomparsa
dell'errore di configurazione.

**Il primo FAIL non prova né smentisce il read-after-FAIL
nativo**, perché quell'esecuzione non ha raggiunto
il Test Runner o il recupero. Non reinterpretarlo
come fallimento funzionale né come SUCCESS.

## Evidenza richiesta e limiti

**R385.8 è PENDING finché** Fast CI e probe native non
terminano SUCCESS sulla stessa SHA. I test Fast CI verificano
sintassi della suite e wiring del workflow, senza lanciare
ogni volta Docker/Rust/EVM.

In caso di native SUCCESS, la conclusione ammessa sarà:
**l'owner ha verificato un vero Test FAIL e una lettura
autenticata successiva con Child MCP prima del primo
UPDATE D1**. Non sarà invece provato che:
- la *serie completa* delle modifiche D1 sia generata
  autonomamente da Gemini;
- il Test Agent abbia autonomamente corretto un test
  errato e ottenuto Docker PASS;
- la nuova modalità rigorosa sappia fare CREATE post-FAIL,
  che rimane per scelta NO-GO;
- il workflow sia un successo funzionale end-to-end con PR;
- siano eliminabili i moduli Signed DAG ancora usati nei test.

I percorsi storici R375/R376/R3844 non sono accorciati,
non ricevono flag rigorosi impliciti e mantengono le
proprie asserzioni. Ogni nuova prova full native va eseguita
soltanto quando la SHA ha superato la Fast CI gratuita.
