# R385.7 — Recovery adattivo guidato dal sorgente: integrazione offline con veri test Node

Data: 8 novembre 2026. PR #38 Draft, branch
`refactor/post-prof-plan-contracts-20261021`. Nessun merge,
nessun provider a pagamento, nessun nuovo privilegio.

## Obiettivo e delimitazione verificabile

R385.6 ha introdotto nel Review Host authority-only una policy *opt-in*
che blocca gli UPDATE dopo un Runner FAIL se non è stato completato
un Task `read_file` distinto, autorizzato dalla Root Engineer originale,
registrato in un'epoch successiva al FAIL, con evidenza del Gateway
coerente con HEAD, ruolo e ResourceURI del file da riparare.

L'E2E gratuita R385.5 provava il percorso Rust/EVM/OPA/Gitea/MCP/
A2A/Docker/PR ma la correzione era **scritta dalla fixture** e il
recovery non richiedeva una lettura diagnostica post-fallimento.
Per questo R385.7 introduce **una prova ripetibile più stretta**,
senza attribuirle capacità che non ha.

## Nuovo test eseguibile

`poc/packages/orchestrator-runtime/test/r3857-source-grounded-adaptive-repair.test.mjs`

- Crea una directory completamente temporanea con una funzione
  `suspend(user)` volutamente difettosa e un test Node `node --test`.
- Esegue davvero il primo test nel subprocess Node: deve **FAIL**.
  Il mock owner registra il FAIL come task **non completato**.
- Una scelta ADK offline propone un Task Backend separato e solo
  `read_file`, seguito dalla lettura effettiva del file in quella
  directory. La prova di sorgente entra nel contesto ADK solo
  dopo il completamento simulato del Task e con digest/HEAD.
- La successiva decisione offline sceglie **un'espressione esatta
  diversa in base ai byte del sorgente ricevuti**. Nessuna delle due
  varianti sorgente è inserita nel costruttore del modello offline.
  La richiesta di UPDATE contiene una trasformazione puntuale
  derivata dalla lettura, non l'intero file finale precostruito.
- La modalità rigorosa `requireVerifiedRepairDiagnostic:true`
  esegue il gate R385.6 **prima** di applicare la modifica.
  Il worker di test richiede match univoco dell'espressione,
  HEAD invariata e grant read/update già presenti nella
  Root di prova; la modifica è limitata al file osservato.
- Il test `node --test` viene eseguito nuovamente su quel file
  modificato e deve **PASS**. Il solo PASS corrente autorizza
  la readiness `ready_for_pr`, **non** la creazione di una PR.
- Due varianti di difetto e metadati diversi impediscono di
  scambiare la correzione con una patch completa preconfezionata.
  Un caso con digest Gateway deliberatamente falso deve
  rifiutare l'UPDATE **prima** del CAS e ritirare la Root simulata.

Il test gira in Fast CI usando le dipendenze ADK installate,
senza alcuna chiave Gemini/OpenAI. Non chiama GitHub API,
non crea branch remoti e non avvia Docker.

## Cosa attesta e cosa no

Questo è un **test di integrazione offline che esegue realmente
un subprocess del test runner Node**, usando il vero
`runTrustedAuthorityOnlyAdaptiveWorkLoop`,
il vero `TrustedAuthorityOnlyAdkDecisionProposer` e il selettore
`selectTrustedRepairDiagnosticRead`. Il modello è un
`BaseLlm` deterministico **senza inferenza generativa**,
condizionato alla sorgente osservata. Le attestazioni
Task, Gateway, Root, ricevute e HEAD sono **simulate dal
test**. Le scritture usano il filesystem temporaneo,
non Gitea CAS/MAC e non il Test Runner Docker reale.

**Non equivale all'E2E nativo** Rust/EVM/OPA/Gitea/MCP/A2A/
Docker né dimostra ancora capacità autonoma di un LLM
di interpretare bug generici o di un Test Agent reale di
riparare il proprio file. L'ultima prova nativa completa
continua a essere R385.5 sulla SHA `339a8b1`;
le successive modifiche R385.6 e R385.7 non possono
ereditarne automaticamente il PASS sulla loro SHA.

## Gate successivo

1. Fast CI sulla SHA finale R385.7: tutti i nuovi test
   e le regressioni di sicurezza devono essere SUCCESS.
2. Introdurre lo stesso percorso **realmente nativo**:
   owner protected, Runner FAIL autenticato, Child MCP
   `read_file` solo post-fallimento, osservatore Gitea,
   scelta ADK sulla lettura, CAS MAC e Docker retest.
3. Ripetere la catena con un Test Agent che ripari
   un test generato realmente difettoso, senza interpretare
   il testo del provider come un'autorizzazione.
4. Solo dopo gli altri gate gratuiti, decidere un pilot
   Gemini sul launcher authority-only con **consenso
   esplicito per i costi**. Non fare merge automatici.

Il nuovo test non altera le API crittografiche, gli approval
Ed25519, la policy OPA o i limiti di credenziali.
