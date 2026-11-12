# R402 — Inventario di raggiungibilità e test di sicurezza

Data: **8 novembre 2026**. Branch: \`refactor/post-prof-plan-contracts-20261021\`. PR #38 Draft; \`main\` invariato.

## Scopo

Costruire prima della pulizia di sorgenti e test un inventario **conservativo** di tutti i file tracciati. R402 non elimina alcun file e non autorizza cancellazioni sulla base dell'assenza di import osservati.

La nuova utility \`poc/scripts/r402-reachability-coverage-inventory.mjs\`:

1. legge esclusivamente \`git ls-files\` e il contenuto locale dei file, senza importare/eseguire i componenti dell'applicazione;
2. costruisce un grafo per \`import\` e \`export\` statici ESM tramite il parser Node; aggiunge gli import dinamici letterali, i \`require\` e i \`new URL\` riconoscibili dall'audit R6;
3. registra i **riferimenti testuali alla configurazione** di package scripts e workflow (non ne presume l'esecuzione); considera tutti i workflow, compresi quelli manuali, come possibili entry point;
4. mantiene un inventario distinto dei test e dei moduli da preservare, e marca come **incertezza** import calcolati, parser non disponibili, moduli senza risoluzione letterale e consumer esterni;
5. produce un JSON per-voce attraverso \`--out\` con i campi \`potentiallyReachable\`, \`testGraphReachable\`, \`incomingCount\`, \`outgoing\`, \`legacy\`, \`unresolved\`, e \`witnesses\`.

Comando senza spese o accessi provider:
\`\`\`bash
node --experimental-vm-modules --test poc/scripts/test/r402-reachability-coverage-inventory.test.mjs
node --experimental-vm-modules poc/scripts/r402-reachability-coverage-inventory.mjs --out /tmp/r402-static-inventory.json
\`\`\`

Fast CI genera l'artefatto scaricabile **\`r402-static-inventory\`**, associato alla SHA del workflow. Non occorre avviare alcuna inferenza Gemini.

## Limiti da NON confondere

- Una catena import ESM statica è un **riferimento osservato**, non la prova che un percorso operativo sia stato eseguito.
- Una menzione nella configurazione non implica un comando eseguito: include possibili commenti, job disabilitati e argomenti shell.
- Il grafo non risolve tutti gli alias, import calcolati, codice generato, caricamenti Docker, processi esterni, entry point Rust o consumer di librerie.
- La presenza di un file test è un **test witness**, non dimostra che sia eseguito in CI, che copra davvero la proprietà dichiarata o che abbia avuto esito positivo.
- La presenza di un file non raggiunto non significa che sia morto.
- \`deletionAuthorized:false\` e \`runtimeReachabilityCertified:false\` restano sempre falsi anche con zero caller visibili.

## Decisioni per la fase successiva

I cinque moduli storici dell'audit R385.18 restano *REVIEW_CALLERS_FIRST*. I quattro moduli MCP crittografici privati restano *KEEP_PRIVATE_CRYPTO_MCP*. I test che attestano autorizzazioni, immutabilità della root, Gateway, CAS, recovery, Docker, Card, Human Gate e isolamento legacy devono conservare casi positivi e negativi unici.

Prima di ogni cancellazione: classificare il caller non-test, verificare entrypoint/alias non risolti, trasferire la copertura negativa necessaria a un test canonico, aggiornare i gate che ancora richiedono l'esistenza del modulo storico; infine validare sulla stessa SHA. Questa fase è **solo inventario**, non cleanup di runtime.
