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
| `docker compose stop` | ferma tutto mantenendo i dati |
| `docker compose up -d` | riavvia |
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
                                 (+ Orchestrator, agenti, Gateway nei prossimi passi)
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
richieste salvate dalla console). Anvil invece riparte da zero a ogni riavvio:
`trust-bootstrap` registra di nuovo i contratti automaticamente.

## Cosa fa oggi la console

| Sezione | Stato |
|---|---|
| Login Engineer | Password con hash scrypt, cookie `HttpOnly`/`SameSite=Strict`, blocco dopo 5 tentativi |
| 1 · Ambiente | Gitea, OPA, Anvil, contratti, moduli Rust |
| 2 · Repository | Elenco e import da URL https pubblico, con protezione del branch principale |
| 3 · Policy | Parametri salvati per repository. **Non ancora applicati da OPA** |
| 4 · Requisito | Richiesta salvata con la commit di base fissata |
| 5 · Planning e permessi | Da realizzare |
| 6 · Esecuzione | Da realizzare |

## Prossimi passi

1. Policy OPA parametrica che legge i parametri della console (sostituisce i
   valori cablati `feature/account-suspension` e `iam-console-poc`).
2. Collegare la console al Review Host esistente
   (`poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs`):
   Root preliminare, Planning, revisione dei permessi (solo rimozione o
   restrizione), firma Ed25519, Root operativa, Execution, Draft PR.
3. Runner in un container dedicato: è l'unico servizio che riceverà l'accesso al
   socket Docker, per avviare i container di test (compromesso da dichiarare nel
   threat model).
4. Prima esecuzione senza Gemini (modelli scriptati), poi Gemini reale solo con
   consenso esplicito ai costi.
5. Tappa 2: Gateway, Orchestrator e agenti in container separati con reti
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
