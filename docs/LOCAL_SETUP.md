# Delegation in locale (Windows + WSL2)

Guida per eseguire il PoC sul proprio PC, senza GitHub Actions. Vale anche come
documento di consegna per una sessione di Claude Code avviata in locale.

## Architettura locale

Tutto gira dentro WSL (Ubuntu). Due tipi di componenti:

```
┌──────────────────── PC → WSL (Ubuntu) ───────────────────────────┐
│ ① IN DOCKER (poc/infra/docker-compose.yml)                       │
│    • Gitea  127.0.0.1:3000  repository su cui lavorano gli agenti│
│    • OPA    127.0.0.1:8181  motore delle policy                  │
│    • Anvil  127.0.0.1:8545  blockchain locale (DID, trust, revoca)│
│    • container di test usa e getta, creati dal Runner            │
│                                                                  │
│ ② PROCESSI NODE + RUST                                           │
│    • Console dell'Engineer  127.0.0.1:8700 (poc/engineer-console)│
│    • modulo Rust dell'Engineer: chiavi, Root DC, revoca          │
│    • Orchestrator (Gemini/ADK): Planning ed Execution            │
│    • Gateway: verifica Rust diretta + OPA → Gitea / Runner       │
│    • agenti Backend, Frontend, Test (A2A)                        │
│    • MCP crittografico privato: Child DC e VP                    │
│    • Runner: test sulla SHA esatta in Docker                     │
└──────────────────────────────────────────────────────────────────┘
        solo in modalità reale → API Gemini (Google)
```

Tutti i servizi ascoltano solo su `127.0.0.1`.

## Prerequisiti

- La repository va clonata **nel filesystem Linux** (es. `~/delegation`), non in
  `/mnt/c/...`: i controlli sui permessi `0600` e i socket Unix non funzionano
  sul disco Windows.
- Docker Desktop con integrazione WSL attiva per Ubuntu.
- Versioni usate dal progetto: Node 22.15, Rust 1.99, Foundry 1.8.4.

## Primo avvio (una volta sola)

Dalla cartella della repository, in un terminale WSL:

```bash
cd ~/delegation
git pull
```

1. **Preparazione**: dipendenze Node e compilazione dei moduli Rust
   (la prima volta richiede alcuni minuti).

   ```bash
   bash poc/scripts/local-prepare.sh
   ```

2. **Infrastruttura**: genera la configurazione locale (`poc/infra/.env`,
   ignorata da Git), avvia Gitea, OPA e Anvil, importa la repository di esempio
   `iam-console-poc` con il branch `main` protetto, crea gli account di servizio
   e registra i contratti on-chain.

   ```bash
   bash poc/scripts/phase1-up.sh
   ```

3. **Utente Engineer** della console (la password non viene mostrata mentre la
   scrivi e viene salvata solo come hash).

   ```bash
   node poc/engineer-console/scripts/create-user.mjs engineer
   ```

## Uso normale

```bash
bash poc/scripts/phase1-up.sh
npm --prefix poc run console
```

Poi apri **http://127.0.0.1:8700** nel browser di Windows ed entra con l'utente
creato. `phase1-up.sh` si può rilanciare: riutilizza ciò che esiste. Va
rilanciato dopo un riavvio del PC, perché Anvil perde lo stato e i contratti
devono essere registrati di nuovo.

Per fermare: `Ctrl+C` nel terminale della console, poi
`bash poc/scripts/phase1-down.sh`. **Non** usare `--volumes`, che cancella i
dati di Gitea.

## Cosa fa oggi la console

| Sezione | Stato |
|---|---|
| Login Engineer | Funzionante: password con scrypt, cookie `HttpOnly`/`SameSite=Strict`, blocco dopo 5 tentativi |
| 1 · Ambiente | Funzionante: Gitea, OPA, Anvil, contratti, moduli Rust |
| 2 · Repository | Funzionante: elenco, import da URL https pubblico (con protezione del branch principale) |
| 3 · Policy | Parametri salvati per repository. **Non ancora applicati da OPA** |
| 4 · Requisito | Richiesta salvata con la commit di base fissata |
| 5 · Planning e permessi | Da realizzare |
| 6 · Esecuzione | Da realizzare |

## Prossimi passi dello sviluppo

1. Policy OPA parametrica che legge i parametri della console (sostituisce i
   valori cablati `feature/account-suspension` e `iam-console-poc`).
2. Collegare la console al Review Host esistente
   (`poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs`):
   Root preliminare, Planning, finestra di revisione dei permessi (solo
   rimozione o restrizione), firma Ed25519, Root operativa, Execution.
3. Prima esecuzione **senza Gemini** (modelli scriptati), poi Gemini reale solo
   con consenso esplicito ai costi.
4. Separare Gateway, agenti ed Engineer in processi distinti.

## Problemi frequenti

- **La porta 3000 è già occupata** (ad esempio da un altro Gitea): aggiungi
  `GITEA_HOST_PORT=3001` in `poc/infra/.env` e rilancia `phase1-up.sh`.
- **`docker` non risponde in WSL**: Docker Desktop → Settings → Resources → WSL
  Integration → attiva Ubuntu.
- **Contratti assenti** nella pagina Ambiente: Anvil è stato riavviato, rilancia
  `phase1-up.sh`.

## Regole per chi lavora sul codice (anche Claude Code locale)

- Nessuna chiamata Gemini a pagamento senza consenso esplicito dello studente.
- Nessun merge automatico su `main`; il merge resta una decisione umana.
- Non indebolire le verifiche di Root, Child DC, VP, Gateway e OPA per far
  passare un test.
- Non esporre le chiavi (Gemini, Engineer, Gitea) agli agenti o al codice generato.
- Non committare `poc/infra/.env`, `poc/infra/runtime/` né i moduli `.node`
  compilati (sono già esclusi da Git).
- Branch di lavoro: `refactor/post-prof-plan-contracts-20261021`.
