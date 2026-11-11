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
 └─ app        127.0.0.1:8700    console dell'Engineer
                                 + Gateway e Review Host per ogni sessione
                                 (agenti nei prossimi passi)
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

| Sezione | Stato |
|---|---|
| Login Engineer | Password con hash scrypt, cookie `HttpOnly`/`SameSite=Strict`, blocco dopo 5 tentativi |
| 1 · Ambiente | Gitea, OPA, Anvil, contratti, moduli Rust, avvio del core dell'Engineer (identità on-chain) e del verificatore del Gateway |
| 2 · Repository | Elenco e import da URL https pubblico, con protezione del branch principale |
| 3 · Policy | Parametri per repository pubblicati su OPA e applicati dal Gateway (branch protetti, branch di lavoro firmato, percorsi non modificabili, profilo dei test, Draft PR) |
| 4 · Requisito | Richiesta salvata con la commit di base fissata |
| 5 · Planning e permessi | Root preliminare di sola lettura, Planner (simulato gratuito o Gemini con consenso), letture tramite il Gateway reale, finestra di revisione dei permessi, firma Ed25519 con password, Root operativa |
| 6 · Esecuzione | Elenco delle Root operative attive e pulsante di stop (revoca). Avvio degli agenti: da realizzare |

### Come funziona una sessione

1. **Planning.** La console pubblica la policy della repository su OPA, prende
   l'elenco dei percorsi alla commit fissata e avvia nel container un Gateway
   (verifica Rust della VP + OPA + Gitea). Il core Rust dell'Engineer emette una
   **Root preliminare di sola lettura**; il Planner legge i file solo tramite il
   Gateway e restituisce una proposta di permessi (operazione + ResourceURI sul
   branch `feature/<sessione>`), salvata come checkpoint firmato.
   - *Simulato*: gratuito e senza IA. Sceglie i file confrontando le parole del
     requisito con i percorsi; la proposta lo dichiara esplicitamente.
   - *Gemini*: a pagamento. Disponibile solo se `GEMINI_API_KEY` è nel file
     `.env` e serve spuntare il consenso ai costi a ogni sessione.
2. **Revisione.** Nella finestra "Rivedi e approva i permessi" puoi solo
   **togliere** permessi, mai aggiungerne. Per firmare reinserisci la password:
   la console la passa al server di approvazione canonico della sessione
   (`engineer-approval-server.mjs`, solo su loopback), che verifica l'hash
   scrypt, firma il sottoinsieme con la chiave Ed25519 dell'Engineer e salva la
   ricevuta. "Rifiuta" revoca la Root preliminare senza emettere nulla.
3. **Root operativa.** Il Review Host rilegge e verifica la ricevuta, revoca la
   Root preliminare ed emette la Root operativa con i soli permessi firmati. La
   sua durata non supera quella dell'approvazione (30 minuti dalla firma).
   "Interrompi" la revoca subito.

Limiti attuali, dichiarati:

- la chiave Ed25519 dell'Engineer è conservata dal container `app` (volume
  `config`) e sbloccata dalla password: è una firma *autenticata dalla
  password*, non da un dispositivo personale dell'Engineer;
- branch principale `main` e prefisso `feature/` sono ancora fissi nel codice
  canonico (la pagina Policy non permette altri prefissi);
- dopo un riavvio dell'app le sessioni precedenti risultano "Non più attive",
  perché la blockchain locale riparte da zero.

## Prossimi passi

1. Esecuzione dalla console: Child DC per ruolo, Task degli agenti tramite il
   Gateway, test nel Runner Docker, Draft PR.
2. Runner in un container dedicato: è l'unico servizio che riceverà l'accesso al
   socket Docker, per avviare i container di test (compromesso da dichiarare nel
   threat model).
3. Prima esecuzione senza Gemini (modelli scriptati), poi Gemini reale solo con
   consenso esplicito ai costi.
4. Tappa 2: Gateway, Orchestrator e agenti in container separati con reti
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
