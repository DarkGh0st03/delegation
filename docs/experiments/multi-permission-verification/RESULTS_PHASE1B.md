# Fase 1b — Verifica multi-permesso sul trust layer reale: risultati

**Esecuzione:** 25/11/2026. Core `97547d24`; benchmark `examples/multi_permission_benchmark_evm.rs` sul branch `experiment/multi-permission-verification-benchmark`. Nessuna modifica al core, al workflow, alle credenziali o agli smart contract; `main` invariato; nessuna API a pagamento.

**Trust layer reale:**
- Anvil dall'immagine del progetto `delegation-chain:local`, avviato da zero a ogni esecuzione;
- i tre contratti deployati con `blockchain/scripts/deploy-local.sh`;
- chiavi Ed25519 pubblicate nei DID Document con `publish-ed25519.mjs`;
- iscrizione delle identità e trust anchor tramite la governance;
- materiale degli accumulatori ancorato in `IssuerRegistry` e scritto in `FilePublicArtifactStore`;
- Status List firmate JWT, registrate e aggiornate on-chain.

Il verificatore è **ricostruito a ogni verifica** come `verify_real` del binding del Gateway: `EvmRegistryReader::connect`, `open_read_only`, `DidEthrVerificationKeyProvider` (un processo `node` per ogni risoluzione).

**Ambiente:** VM KVM con Intel Xeon @ 2,30 GHz, 4 vCPU, 16 GB; rustc 1.97.0; Node 22; release build, feature di default.

## 1. Protocollo e fonti dei dati

| Esecuzione | Cartella | Cosa fornisce |
|---|---|---|
| 1 — latenza | `raw/real-evm/` | **600 prove** sul percorso **diretto** verso Anvil (3 configurazioni × k ∈ {1, 2, 5, 10, 15} × 2 modalità × 20 ripetizioni), 2 ripetizioni di warm-up scartate, ordine casuale tra le 30 condizioni a ogni ripetizione. Tutte riuscite |
| 2 — conteggi e casi negativi | `raw/real-evm-counts/` | 90 prove attraverso il **proxy** che conta le RPC (3 ripetizioni) e 60 prove negative; catena nuova |

**Perché due percorsi.** Il proxy di conteggio aggiunge circa 25–30 ms per richiesta, che su una VP sono circa 0,5 s. Per questo le latenze vengono **solo** dal percorso diretto e i conteggi RPC **solo** dal proxy, dove sono deterministici: identici in tutte le ripetizioni.

**Incidente documentato.** Nell'esecuzione 1 le Child del benchmark avevano una validità di 3.600 s, ma l'esecuzione è durata 4.052 s. Le Child sono scadute durante la fase proxy: 45 righe proxy delle Child non sono valide. È un errore di progettazione del benchmark, non un difetto del framework. Conteggi e casi negativi sono stati rimisurati nell'esecuzione 2 con validità di 7.200 s (`raw/real-evm/README.md`). Le latenze dell'esecuzione 1 non sono toccate: tutte le 600 righe dirette sono valide.

Intervalli: bootstrap **appaiato** al 95% (2.000 ricampionamenti delle ripetizioni; le prove singola e multipla della stessa ripetizione restano accoppiate).

## 2. Risultato principale: speedup sul trust layer reale

Tempo per autorizzare k permessi (generazione + verifica), mediane di 20 ripetizioni.

| Config | k | VP separate (s) | VP unica (s) | **Speedup** (IC 95% appaiato) | Tempo risparmiato (s) |
|---|---:|---:|---:|---|---:|
| Root | 1 | 1,010 | 1,015 | 1,00 (0,97–1,03) | 0,00 |
| | 2 | 2,025 | 1,023 | 1,98 (1,95–2,02) | 1,00 |
| | **5** | 5,104 | 1,029 | **4,96 (4,82–5,06)** | 4,07 |
| | **10** | 10,228 | 1,040 | **9,83 (9,71–10,02)** | 9,19 |
| | **15** | 15,250 | 1,026 | **14,86 (14,76–14,99)** | 14,22 |
| Child | 1 | 1,549 | 1,516 | 1,02 (0,99–1,05) | 0,03 |
| | 2 | 3,047 | 1,535 | 1,98 (1,95–2,03) | 1,51 |
| | **5** | 7,645 | 1,546 | **4,94 (4,81–5,04)** | 6,10 |
| | **10** | 15,293 | 1,555 | **9,84 (9,68–9,98)** | 13,74 |
| | **15** | 23,025 | 1,593 | **14,45 (14,24–14,71)** | 21,43 |
| Child, Root a directory | 5 | 7,645 | 1,535 | 4,98 (4,95–5,06) | 6,11 |
| | 10 | 15,244 | 1,561 | 9,77 (9,60–9,89) | 13,68 |
| | 15 | 22,810 | 1,599 | 14,27 (14,12–14,60) | 21,21 |

**Lo speedup è praticamente uguale a k** (circa il 96–99% di k). Con le VP separate il costo cresce linearmente; con la VP unica resta quasi costante: da 1,02 a 1,04 s con la Root e da 1,52 a 1,60 s con la Child, per k da 1 a 15.

## 3. Da dove viene il costo (una verifica, VP unica, mediane)

| Config | k | Verifica (ms) | Risoluzioni `did:ethr` (n / ms) | Letture dei registry (n / ms) | File (n / ms) | Crittografia + parsing (ms, residuo) |
|---|---:|---:|---|---|---|---:|
| Root | 1 | 1.014 | 2 / 1.002 | 7 / 4,8 | 2 / 0,9 | 5,1 |
| | 10 | 1.039 | 2 / 1.007 | 7 / 4,9 | 2 / 0,8 | 22,6 |
| | 15 | 1.026 | 2 / 987 | 7 / 4,9 | 2 / 0,9 | 32,0 |
| Child | 1 | 1.516 | 3 / 1.496 | 10 / 6,6 | 4 / 1,8 | 10,6 |
| | 10 | 1.554 | 3 / 1.496 | 10 / 6,5 | 4 / 1,8 | 51,1 |
| | 15 | 1.592 | 3 / 1.513 | 10 / 7,0 | 4 / 1,8 | 65,3 |

- Le **risoluzioni `did:ethr` pesano il 97–98% della verifica**: circa 500 ms ciascuna, 2 per VP con la Root e 3 con la Child, **indipendentemente da k**.
- Il tempo trascorso dentro Anvil, misurato a monte dal proxy, è di **16 ms per VP con la Root e 23–24 ms con la Child**. *Inferenza:* quasi tutto il costo di una risoluzione è fuori dalla catena, cioè nell'avvio del processo `node` e nel caricamento delle librerie del resolver. La scomposizione interna al processo non è stata misurata.
- Le letture dei registry costano 5–7 ms per VP. Il residuo crittografico cresce con k (da 5 a 32 ms con la Root, da 11 a 65 ms con la Child), coerente con la Fase 1, ma qui conta solo per l'1–4%.
- *Lettura:* il beneficio dipende dal fatto che il costo dominante è **fisso per VP**. Se in futuro le risoluzioni DID diventassero molto più economiche (per esempio con una cache o un resolver in-process), lo speedup scenderebbe verso il tetto crittografico misurato nella Fase 1 (circa 2,2×).

## 4. Richieste RPC effettive (esecuzione 2, identiche in tutte le ripetizioni)

Per **una VP**: richieste HTTP / chiamate JSON-RPC (`eth_call`, `eth_getLogs`, `eth_chainId`, altre).

| Config | Per VP | k = 5, VP separate | k = 10, VP separate | k = 15, VP separate | VP unica (ogni k) |
|---|---|---|---|---|---|
| Root | 19 / 27 (8, 2, 13, 4) | 95 / 135 | 190 / 270 | 285 / 405 | 19 / 27 |
| Child (entrambe le varianti) | 28 / 40 (12, 3, 19, 6) | 140 / 200 | 280 / 400 | 420 / 600 | 28 / 40 |

Riduzione con la VP unica: **1 − 1/k** (80% con k = 5, 90% con k = 10, 93% con k = 15).

Distinzione richiesta tra interfacce del trust layer e RPC reali:

| Livello | Root per VP | Child per VP |
|---|---|---|
| Chiamate alle interfacce (Fase 1): letture di contratto / chiavi DID / artefatti | 6 / 2 / 2 | 9 / 3 / 4 |
| Chiamate misurate in questa fase su `TrustChainReader` + `connect` / risoluzioni DID / file | 7 / 2 / 2 | 10 / 3 / 4 |
| **Chiamate JSON-RPC reali** | **27** | **40** |

La differenza tra interfacce e RPC è sostanziale. `eth_chainId` è il metodo più frequente: lo chiamano sia ogni processo del resolver DID sia il controllo del chain id di `connect`. Le altre richieste RPC vengono da `ethr-did-resolver` (`eth_getLogs` e chiamate al registry DID).

## 5. Casi negativi sul trust layer reale (esecuzione 2, k = 10, 5 ripetizioni × 3 configurazioni)

**45 richieste non valide, tutte respinte per il motivo specifico atteso; 15 controlli validi, tutti accettati.**

| Caso | Motivo | Mediana (s) |
|---|---|---:|
| Requisito non delegato | `Required permissions not disclosed in the VP: …deploy_key.pem#read_file` | 0,67–0,71 |
| Challenge errata | `VP challenge does not match the authorization context challenge` | 0,68–0,71 |
| Root revocata **on-chain** (Status List riscritta e `updateStatusList` su IssuerRegistry) | `Credential urn:delegation:bench1b:root is revoked` (`root-dir` nella variante a directory) | 1,50–1,57 |
| Controllo valido dopo il ripristino on-chain | accettato | 1,51 (Root), 2,29–2,31 (Child) |

La revoca registrata sulla catena è osservata dalla verifica immediatamente successiva, senza ritardi né cache. I rifiuti per copertura e per challenge costano circa 0,7 s, cioè una sola risoluzione DID (la chiave del presentatore per verificare la firma della VP), perché avvengono prima della verifica della catena.

## 6. Limiti

- **Non misura il Gateway completo:** Prepare, OPA, binding, journal e provider Gitea sono esclusi. In un'operazione reale lo speedup sull'intera richiesta sarà inferiore a k, perché quelle parti non si condividono tra VP. Nel benchmark storico OPA costava circa 2 ms, mentre il provider Gitea circa 50–300 ms per operazione.
- **Anvil locale** su loopback: la latenza di rete di un nodo remoto renderebbe le RPC più costose. Il numero di RPC fisso per VP renderebbe in quel caso il vantaggio del raggruppamento ancora maggiore (ipotesi).
- **Validità delle credenziali di benchmark** (7.200 s) diversa da quella delle Child del PoC (1.200 s): non influisce sul costo della verifica.
- Ambiente VM condiviso; mitigato con warm-up, ordine casuale, mediane e bootstrap appaiato.
- k limitato a {1, 2, 5, 10, 15}, cioè i valori rappresentativi del workflow; la Fase 1 copre fino a 128 per la sola parte crittografica.

## 7. Riproduzione

```bash
cargo build --release --example multi_permission_benchmark_evm
docs/experiments/multi-permission-verification/run_phase1b.sh docs/experiments/multi-permission-verification/raw/real-evm --reps 20 --warmup 2 --proxy-reps 3 --neg-reps 5
python3 -I docs/experiments/multi-permission-verification/analyze_phase1b.py docs/experiments/multi-permission-verification/raw/real-evm docs/experiments/multi-permission-verification/raw/real-evm-counts
```

File: `raw/real-evm/` (`positive.csv`, `summary.md`, `summary.csv`, `chain.env`, `run-meta.json`, `progress.log`, `README.md`); `raw/real-evm-counts/` (`positive.csv`, `negative.csv`, `chain.env`, `run-meta.json`, `progress.log`).
