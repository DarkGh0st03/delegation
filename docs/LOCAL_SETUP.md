# Delegation in locale con Docker Compose

L'intero PoC si avvia con Docker. L'unico prerequisito è **Docker** (su Windows:
Docker Desktop). Vale anche come documento di consegna per chi lavora sul codice,
inclusa una sessione di Claude Code avviata in locale.

## Avvio

Dalla cartella della repository:

```bash
cp .env.example .env
```

Apri `.env` e scegli la password dell'Engineer (`ENGINEER_PASSWORD`, almeno 8
caratteri). Il file resta sul tuo computer: è escluso da Git.

```bash
docker compose up -d --build
```

La prima volta scarica le immagini e compila i moduli Rust: servono diversi
minuti. Le volte successive l'avvio è rapido. Poi apri
**http://127.0.0.1:8700** e accedi con `engineer` e la password scelta.

Altri comandi utili:

| Comando | Effetto |
|---|---|
| `docker compose ps -a` | stato dei servizi (i servizi di preparazione risultano `Exited (0)` quando hanno finito bene) |
| `docker compose logs -f app` | log della console |
| `docker compose logs gitea-bootstrap trust-bootstrap` | log della preparazione |
| `docker compose down` poi `docker compose up -d` | **riavvio corretto** (anche dopo aver riacceso il PC): ferma tutto e riparte da capo mantenendo i dati di Gitea |
| `docker compose down` | rimuove i container, mantiene i volumi (dati e configurazione) |
| `docker compose down -v` | **cancella tutto**, compresi Gitea, chiavi e configurazione |

## Architettura (tappa 1)

```
docker compose up
 │
 ├─ preparazione (una volta per avvio, poi terminano)
 │   ├─ setup            genera la configurazione privata nel volume "config"
 │   │                   (password di servizio casuali, login Engineer da .env)
 │   ├─ gitea-users      crea gli account Gitea (admin, gateway, runner)
 │   ├─ gitea-bootstrap  importa iam-console-poc al commit fissato, protegge
 │   │                   main, assegna i permessi, crea i token di servizio
 │   └─ trust-bootstrap  registra i contratti DID/Trust/Issuer su Anvil
 │
 ├─ infrastruttura
 │   ├─ gitea   127.0.0.1:3000   repository su cui lavorano gli agenti
 │   ├─ opa     127.0.0.1:8181   motore delle policy
 │   └─ anvil   127.0.0.1:8545   blockchain locale
 │
 ├─ app        127.0.0.1:8700    console dell'Engineer; per ogni sessione:
 │                               Gateway, Review Host, Orchestrator e agenti
 │                               Backend/Frontend/Test (A2A su loopback)
 └─ runner     (solo rete interna) esegue i test in container Docker usa e getta;
                                 è l'UNICO servizio con il socket Docker
```

Tutte le porte sono pubblicate solo su `127.0.0.1`: non sono raggiungibili da
altri computer della rete.

Immagini:

- `delegation-chain` (da `deploy/Dockerfile`, target `chain`): Foundry 1.8.4 e
  `solc` 0.8.24 dalle release ufficiali, verificati con SHA-256; contratti
  compilati durante la build. Usata da `anvil` e `trust-bootstrap`.
- `delegation-app` (target `app`): Node 22.15, dipendenze npm bloccate dai
  lockfile e i due moduli Rust nativi (emissione dell'Engineer, verifica del
  Gateway) compilati con Rust 1.99 e `Cargo.lock` bloccati.
- `gitea/gitea:28.0.0` e `openpolicyagent/opa:1.21.1` da Docker Hub.

Dati persistenti (volumi Docker): `delegation-config` (configurazione privata),
`delegation-gitea-data` (repository Gitea), `delegation-state` (policy e
richieste salvate dalla console). Anvil invece riparte da zero a ogni avvio e
`trust-bootstrap` registra di nuovo i contratti. **Blockchain e app vanno
sempre riavviate insieme**: all'avvio il core Rust dell'Engineer genera nuove
chiavi per gli accumulatori e registra le identità dei 5 ruoli (Engineer,
Orchestrator, Backend, Frontend, Test) su una catena pulita. Per questo `anvil`
e `app` non ripartono da soli: usa sempre `docker compose down` seguito da
`docker compose up -d`.

## Cosa fa oggi la console

La console si chiama **Sigillo** (di "Ardesia Labs", nomi di fantasia) ed è
una sola pagina principale più una pagina per ogni sessione:

| Dove | Cosa c'è |
|---|---|
| Accesso | Password con hash scrypt, cookie `HttpOnly`/`SameSite=Strict`, blocco dopo 5 tentativi |
| Home · Repository | Tabella delle repository (selezione con un clic, cestino per eliminarle da Gitea) e import **solo dal tuo account GitHub** (`GITHUB_OWNER` nel file `.env`; per le repository private un `GITHUB_TOKEN` di sola lettura, che resta nel server), con protezione del branch principale |
| Home · Configura policy | Popup con le regole pubblicate su OPA e applicate dal Gateway: branch protetti, percorsi non modificabili, Draft PR consentita. Il branch di lavoro `feature/<sessione>` è fisso |
| Home · Prompt | Campo di testo in stile chat per il requisito in linguaggio naturale. Le sessioni usano Gemini: inviare il prompt avvia la sessione, con i limiti di chiamate e token |
| Home · Sessioni recenti | Elenco delle sessioni con stato e numero della Draft PR. Le vecchie si archiviano (non si cancellano) con `docker compose exec app node poc/engineer-console/scripts/archive-sessions.mjs --keep 2` |
| Pagina della sessione | Avanzamento (Planning → Approvazione → Esecuzione → Test → Draft PR), attività in tempo reale (cronologia e decisioni del Gateway), popup di approvazione dei permessi con firma Ed25519, scheda della Draft PR, riepilogo, chiamate a Gemini, pulsante di stop |
| Impostazioni (ingranaggio) | Stato dell'ambiente: Gitea, OPA, Anvil, contratti, moduli Rust, core dell'Engineer e verificatore del Gateway. Il pallino sull'ingranaggio è verde quando è tutto pronto |

Il profilo dei test (immagine Docker, fasi, cartelle dei test) non si modifica
dalla console: per l'esempio è quello noto di `iam-console-poc`, per le altre
repository un modello npm (`npm ci`, `npm test`); resta comunque legato alla
firma dell'Engineer.

### Come funziona una sessione

1. **Planning.** La console pubblica la policy della repository su OPA, prende
   l'elenco dei percorsi alla commit fissata e avvia nel container un Gateway
   (verifica Rust della VP + OPA + Gitea). Il core Rust dell'Engineer emette una
   **Root preliminare di sola lettura**; il Planner legge i file solo tramite il
   Gateway e restituisce una proposta di permessi (operazione + ResourceURI sul
   branch `feature/<sessione>`), salvata come checkpoint firmato.
   Il Planner è Gemini (a pagamento, serve `GEMINI_API_KEY` nel file `.env`).
   Le modalità gratuite senza IA descritte sotto esistono solo per i test
   automatici e la sandbox (`DELEGATION_FREE_MODES=1`): la console non le offre.
2. **Revisione.** Nella finestra "Rivedi e approva i permessi" puoi solo
   **togliere** permessi, mai aggiungerne. Per firmare reinserisci la password:
   la console la passa al server di approvazione canonico della sessione
   (`engineer-approval-server.mjs`, solo su loopback), che verifica l'hash
   scrypt, firma il sottoinsieme con la chiave Ed25519 dell'Engineer e salva la
   ricevuta. "Rifiuta" revoca la Root preliminare senza emettere nulla.
3. **Esecuzione** (parte da sola dopo la firma). Il Review Host rilegge e
   verifica la ricevuta, revoca la Root preliminare ed emette la **Root
   operativa** con i soli permessi firmati; la sua durata non supera quella
   dell'approvazione (30 minuti dalla firma) e "Interrompi" la revoca subito.
   L'Orchestrator lavora **un Task alla volta**, con un flusso uguale per
   qualsiasi requisito: (1) crea il branch; (2) Backend e Frontend modificano i
   file dell'applicazione, un Task per file; (3) l'agente **Test legge** i file
   dell'applicazione modificati (un Task di sola lettura per file, solo tra
   quelli firmati dall'Engineer; al massimo 8 letture "osservate" per
   sessione); (4) il Test **scrive i test** per il comportamento nuovo (solo
   file di test); (5) esegue i test del progetto. Ogni Task ha una **Child DC**
   propria e ogni operazione passa dal Gateway: VP verificata dal core Rust,
   decisione di OPA, HEAD di Gitea controllata. I test girano nel servizio
   `runner`, in un container usa e getta. La **Draft PR** si crea solo se
   **tutte le fasi dei test del progetto** passano sul commit finale (non c'è
   più una suite di accettazione separata). A fine esecuzione la Root viene
   revocata.
   Nella cronologia della sessione ogni Task appare come "Orchestrator assegna
   un Task a …", seguito dalle operazioni dell'agente; dopo un FAIL dei test
   compare "Orchestrator riassegna a …".
   - *Simulato* (solo test e sandbox): gli agenti non usano IA. Ogni file approvato riceve solo un
     commento marcato `SIMULATA`: si vede tutta la catena di autorizzazione su
     un diff reale. Il requisito non è implementato; se i test del progetto
     passano nasce comunque una Draft PR etichettata `[SIMULATA]`.
   - *Soluzione di riferimento* (solo test e sandbox): gratuita e senza IA, solo per `iam-console-poc`
     al commit di base. Il Planner propone gli 11 file della soluzione nota del
     ricercatore (codice e test) e gli agenti la scrivono attraverso tutta la
     catena; nasce una Draft PR etichettata `[RIFERIMENTO]`. Non è codice
     generato da un modello.
   - *Gemini*: gli agenti scrivono il codice; la PR nasce solo se i test passano.

### Prova con Gemini (a pagamento)

1. Nel file `.env` imposta `GEMINI_API_KEY=` con la tua chiave (mai in chat né
   in Git) e, se vuoi, `GEMINI_MODEL=` (predefinito `gemini-3.8-flash`). Poi
   `docker compose down`, `docker compose build`, `docker compose up -d`.
   La chiave arriva solo al servizio `app`.
2. Nel Planning scegli **Gemini** e spunta il consenso ai costi. Prima di tutto
   la console fa un **controllo gratuito** (sola lettura, nessun token) di
   chiave e modello: se Google li rifiuta, la sessione si ferma subito.
3. Limiti di sicurezza (gli stessi del codice canonico): chiamate e token per
   fase e per ruolo, al massimo **160 chiamate e 1.000.000 di token riportati
   per sessione**; ogni risposta troncata, bloccata o fuori budget viene
   scartata e la Root revocata. **Non è un tetto in euro**: Google può
   addebitare anche chiamate scartate o fallite, quindi imposta un limite di
   spesa nel progetto Google.
4. Diagnostica: nella sessione la tabella **"Chiamate a Gemini"** mostra per
   ogni chiamata fase/ruolo, durata, token, motivo di fine, strumenti usati e
   un estratto della risposta, oppure l'errore esatto di Google (la chiave è
   sempre oscurata). Gli errori compaiono anche nella Cronologia e nella
   banner in cima alla pagina della sessione.

Limiti attuali, dichiarati:

- la chiave Ed25519 dell'Engineer è conservata dal container `app` (volume
  `config`) e sbloccata dalla password: è una firma *autenticata dalla
  password*, non da un dispositivo personale dell'Engineer;
- branch principale `main` e prefisso `feature/` sono ancora fissi nel codice
  canonico (il popup della policy non permette altri prefissi);
- dopo un riavvio dell'app le sessioni precedenti risultano "Non più attive",
  perché la blockchain locale riparte da zero;
- il Runner esegue i comandi di test del progetto `iam-console-poc` (`npm ci`,
  typecheck, `tests/backend`, `tests/frontend`, build, e2e) e il Test scrive
  solo in `tests/backend` e `tests/frontend`: altre repository richiedono di
  rendere configurabili questi due elementi (prossimo passo);
- il servizio `runner` ha il socket Docker dell'host, che equivale a privilegi
  di root sull'host: è isolato nella rete interna, conosce solo un token Gitea
  di sola lettura e accetta richieste solo dal Gateway (token privato). I
  container di test hanno rete (servono `npm ci` e Playwright);
- il primo `run_tests` scarica dipendenze e browser: può richiedere vari minuti.

## Prossimi passi

1. Prima esecuzione completa sul PC (simulata, gratuita), poi Gemini reale solo
   con consenso esplicito ai costi.
2. Tappa 2: Gateway, Orchestrator e agenti in container separati con reti
   isolate, così gli agenti non possono raggiungere Gitea se non tramite il Gateway.

## Problemi frequenti

- **Porta già in uso** (3000, 8181, 8545 o 8700): un altro programma la occupa,
  ad esempio un altro Gitea. Fermalo, oppure cambia la porta a sinistra nella
  riga `ports` del servizio in `compose.yaml`.
- **`ENGINEER_PASSWORD` mancante**: non hai creato `.env` da `.env.example`.
- **Un servizio di preparazione è `Exited (1)`**: guarda il suo log con
  `docker compose logs <nome>`. Rilanciare `docker compose up -d` è sicuro: la
  preparazione riusa ciò che esiste.

## Sviluppo senza Docker (facoltativo)

Per eseguire i test del codice direttamente su Linux/WSL:
`bash poc/scripts/local-prepare.sh` (dipendenze e moduli Rust) e
`npm --prefix poc run console:test`.

## Regole per chi lavora sul codice (anche Claude Code locale)

- Nessuna chiamata Gemini a pagamento senza consenso esplicito dello studente.
- Nessun merge automatico su `main`; il merge resta una decisione umana.
- Non indebolire le verifiche di Root, Child DC, VP, Gateway e OPA per far
  passare un test.
- Non esporre le chiavi (Gemini, Engineer, Gitea) agli agenti o al codice generato.
- Non committare `.env`, `poc/infra/.env`, `poc/infra/runtime/` né i moduli
  `.node` compilati (sono già esclusi da Git).
- Branch di lavoro: `refactor/post-prof-plan-contracts-20261021`.
