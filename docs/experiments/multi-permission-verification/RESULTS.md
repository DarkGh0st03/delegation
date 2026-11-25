# Fase 1 — Verifica multi-permesso: risultati

**Esecuzione:** 25/11/2026, `raw/default/` (feature di default, come il binding di produzione).
**Codice misurato:** core `97547d24`; benchmark al commit `29edb9e8` del branch `experiment/multi-permission-verification-benchmark`.
**Ambiente:** VM KVM con Intel Xeon @ 2,30 GHz, 4 vCPU, 16 GB; rustc 1.97.0; build `--release` (`raw/default/environment.json`).
**Protocollo:** 3 warm-up scartati + 30 ripetizioni; 3 configurazioni × 8 valori di k × 2 modalità = **1.440 prove, tutte riuscite** con la profondità attesa. 840 prove negative (750 richieste non valide, tutte respinte, e 90 controlli validi, tutti accettati; 84 gruppi). Metodologia: `METHODOLOGY.md`. Tabelle complete: `raw/default/summary.md`.

## 1. Natura delle misure

| Misura | Natura |
|---|---|
| Tempo di generazione della VP (selective disclosure + firma Ed25519) | **Misurato** |
| Tempo di verifica crittografica (firma, witness BN254, metadati, gerarchia, covers, Status List JWT) | **Misurato**, con sorgenti del trust layer in memoria |
| Dimensione della VP | **Misurato** |
| Chiamate alle interfacce del trust layer | **Contato** esattamente |
| Richieste RPC reali, risoluzioni `did:ethr`, latenza della blockchain | **Non misurato** (§5) |
| Tempo complessivo del Gateway operativo (Prepare, OPA, binding, provider) | **Non misurato** |

## 2. Risultato principale: costo crittografico

Mediane di 30 ripetizioni; tra parentesi l'intervallo bootstrap **appaiato** al 95% del rapporto (2.000 ricampionamenti delle ripetizioni; le prove singola e multipla della stessa ripetizione restano accoppiate).

| Config | k | VP separate: verifica (ms) | VP unica: verifica (ms) | Speedup verifica | Speedup totale (generazione + verifica) |
|---|---:|---:|---:|---|---|
| Root (profondità 0) | 5 | 20,94 | 11,39 | 1,84 (1,83–1,85) | 1,97 (1,97–1,98) |
| | 10 | 41,97 | 20,42 | 2,06 (2,05–2,06) | 2,25 (2,24–2,26) |
| | 15 | 62,81 | 29,42 | 2,14 (2,13–2,14) | 2,35 (2,35–2,36) |
| | 128 | 538,01 | 237,38 | 2,27 (2,26–2,28) | 2,53 (2,53–2,55) |
| Child (profondità 1) | 5 | 41,30 | 22,67 | 1,82 (1,80–1,84) | 1,90 (1,88–1,91) |
| | 10 | 82,48 | 40,94 | 2,01 (1,97–2,03) | 2,12 (2,08–2,14) |
| | 15 | 124,73 | 59,63 | 2,09 (2,05–2,13) | 2,21 (2,16–2,25) |
| | 128 | 1.073,93 | 487,15 | 2,20 (2,15–2,26) | 2,35 (2,29–2,41) |
| Child con Root a directory | 5 | 40,99 | 22,56 | 1,82 (1,80–1,83) | 1,89 (1,87–1,91) |
| | 10 | 82,06 | 40,37 | 2,03 (2,02–2,08) | 2,14 (2,13–2,19) |
| | 15 | 123,65 | 58,36 | 2,12 (2,10–2,15) | 2,24 (2,22–2,27) |
| | 128 | 1.075,12 | 469,58 | 2,29 (2,25–2,31) | 2,44 (2,39–2,46) |

Per k = 1 le due modalità coincidono (rapporto 1,00), come atteso.

**Scomposizione del costo** (regressione lineare sulle mediane, R² ≥ 0,9998):

| Config | VP separate | VP unica | Lettura |
|---|---|---|---|
| Root | 4,21 ms × k | 2,05 + 1,84 ms × k | circa 2,4 ms fissi per VP; **1,84 ms per permesso** (un pairing) |
| Child | 8,39 ms × k | 3,00 + 3,76 ms × k | circa 4,6 ms fissi per VP; **3,76 ms per permesso** (witness proprio + witness dell'antenato) |
| Child, Root a directory | 8,39 ms × k | 4,18 + 3,63 ms × k | come Child |

Interpretazione: la VP unica **elimina la parte fissa per VP** (firma, metadati, Status List, catena), ma **il costo dei witness resta lineare in k**. Per questo lo speedup puramente crittografico tende a un tetto di circa 2,2–2,3× e non cresce con k. Lo scope a directory della Root non ha costi apprezzabili.

**Generazione della VP:** quasi costante con la VP unica (0,52–0,88 ms da k = 1 a 128); lineare con le VP separate (circa 0,55 ms per VP).

**Dimensione:**

| Config | k = 10, VP separate (totale) | k = 10, VP unica | k = 128, VP separate | k = 128, VP unica |
|---|---:|---:|---:|---:|
| Root | 14.240 B | 3.344 B | 182.272 B | 28.518 B |
| Child | 23.620 B | 6.202 B | 302.336 B | 56.548 B |

## 3. Chiamate alle interfacce del trust layer

Il numero per VP **non dipende da k**: 10 con la Root, 16 con la Child, identico in tutte le 30 ripetizioni. Con le VP separate si moltiplica per k.

| Config | Per VP | k = 5 | k = 10 | k = 15 | Riduzione con la VP unica |
|---|---|---:|---:|---:|---|
| Root | 10 (6 letture di contratto, 2 chiavi DID, 2 artefatti) | 50 → 10 | 100 → 10 | 150 → 10 | 1 − 1/k (80%, 90%, 93%) |
| Child | 16 (9 letture di contratto, 3 chiavi DID, 4 artefatti) | 80 → 16 | 160 → 16 | 240 → 16 | 1 − 1/k |

Corrispondenza con il deployment reale (verificata nel codice):

| Interfaccia (contatore) | Root / Child per VP | In produzione |
|---|---|---|
| `TrustChainReader` + `StatusListAnchorReader` (`q_chain_reads`) | 6 / 9 | 1 `eth_call` ciascuna (`evm_registry_reader.rs:134-232`) |
| `VerificationKeyProvider` (`q_verification_key`) | 2 / 3 | 1 **processo `node`** ciascuna, che a sua volta fa più RPC al DID registry (`did_ethr_verification_key_provider.rs:46`) |
| `AccumulatorMaterialProvider`, `StatusListCredentialProvider` | 2 / 4 | lettura di file locali |

Quindi le chiamate alle interfacce **non coincidono** con le richieste RPC. Con la Root sono 6 `eth_call` più 2 processi di risoluzione DID (con un numero di RPC interne non misurato) più 2 letture di file.

## 4. Casi negativi

**84 gruppi** (10 ripetizioni ciascuno, k ∈ {1, 10, 128}, tre configurazioni): **75 gruppi di richieste non valide, 750 prove, tutte respinte per il motivo specifico atteso**; **9 gruppi di controllo valido, 90 prove, tutte accettate**.

| Caso | Motivo del rifiuto (messaggio del core) | Mediana, Child, k = 10 |
|---|---|---:|
| Requisito non delegato / non divulgato / escalation di operazione / permesso non posseduto | `Required permissions not disclosed in the VP: <permesso>` — prima di qualsiasi pairing | 0,28–0,30 ms |
| VP rifirmata dal titolare con un permesso aggiunto e un witness riusato | `Could not verify membership for element v1:…deploy_key.pem…` | 22,14 ms |
| VP rifirmata con due witness scambiati | `Could not verify membership for element v1:…module_000.ts…` | 24,25 ms |
| Challenge errata | `VP challenge does not match the authorization context challenge` | 0,27 ms |
| Root revocata | `Credential urn:delegation:bench:root is revoked` | 20,52 ms |
| Child revocata | `Credential urn:delegation:bench:child is revoked` | 40,60 ms |
| 129 requisiti | `Authorization context exceeds 128 required permissions` — prima della crittografia | 0,00 ms |

Osservazioni:
- Il batch è **atomico**: un solo requisito non valido fa respingere l'intera richiesta; non esiste un risultato parziale.
- Il rifiuto per copertura è **immediato**. Contraffazione dei witness e revoca vengono invece scoperte durante la verifica crittografica, quindi il loro costo cresce con k.
- `retain_only` ignora in silenzio un permesso richiesto ma non posseduto: il wallet non segnala l'errore, ma la VP non contiene quel permesso e la verifica la respinge. Non è una vulnerabilità; è un comportamento da conoscere.
- Un titolare malevolo che modifica e rifirma la propria VP ottiene una firma valida, ma viene comunque bloccato dall'accumulatore.

## 5. Che cosa NON dimostra (e stima del deployment reale)

Nel benchmark storico Phase 12C (`cbadb544`, architettura precedente) la verifica SSI/EVM costava in media circa 1,6 s per operazione Gitea. Qui la parte crittografica costa circa 4–8 ms per VP. **Ne segue (ipotesi, non misura)** che nel deployment reale la latenza è dominata dalle interrogazioni del trust layer, in particolare dalle risoluzioni `did:ethr` tramite processi `node`, che sono **fisse per VP**. In quel regime lo speedup reale tenderebbe a k, molto oltre il tetto crittografico di circa 2,2×.

Questa stima non va riportata come risultato: va misurata con una campagna sul trust layer reale (§6).

## 6. Prossimo passo proposto (non eseguito)

**Fase 1b — trust layer reale, senza modificare il workflow:** stessa matrice di prove con il verificatore composto da `EvmRegistryReader` (Anvil `delegation-chain:local`, immagine già in cache), `FilePublicArtifactStore` e `DidEthrVerificationKeyProvider` (risolutore `node`). Credenziali e materiali pubblicati sulla catena locale con lo stesso bootstrap del progetto. Misurerebbe la latenza per tipo di interrogazione e lo speedup reale per k = 5, 10, 15.

La variante con `parallel_verification` (non usata in produzione) non è stata eseguita. Se servirà, andrà eseguita e riportata separatamente (`raw/parallel_verification/`).

## 7. File

- `raw/default/positive.csv`: 1.440 righe, una per prova (tempi in µs, byte, 10 contatori, esito)
- `raw/default/negative.csv`: 840 righe (caso, esito, latenza, motivo)
- `raw/default/summary.md`, `summary.csv`, `negative-summary.csv`: statistiche (mediana, p5, p25, p75, p95, media, deviazione standard)
- `raw/default/run-meta.json`, `environment.json`, `progress.log`
