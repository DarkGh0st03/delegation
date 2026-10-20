# Delegation · Authorization Review UI (mock)

Frontend statico e interattivo per la revisione delle autorizzazioni del Software Engineer.

## Come aprirlo

Aprire direttamente il file poc/workflow-ui/index.html nel browser.
Le risorse sono locali, non ci sono dipendenze npm né chiamate di rete.

## Funzionalità realizzate

- Visualizzazione della repository Gitea e della revisione analizzata
- Visualizzazione dei Task proposti, agenti e dipendenze
- Revisione, modifica, inclusione, esclusione e aggiunta delle permission
- Conferma simulata ed esportazione JSON dei permessi confermati

IMPORTANTE: questa GUI e una demo. Non emette DC, non contatta Gateway,
MCP, Gitea o Gemini e non puo autorizzare una esecuzione reale.

## GitHub Actions

Il workflow workflow-ui-mock.yml verifica il frontend mediante test Node
senza chiamate al modello, poi pubblica un ZIP come artifact.
Dopo la run e possibile scaricare il ZIP e aprire index.html.

GitHub Actions non espone normalmente una pagina di approvazione interattiva
ospitata sul runner. L'approvazione reale richiedera un backend autenticato;
un clic del browser non costituisce di per se una autorizzazione.

## Integrazione successiva

Sostituire mock-plan.js con la risposta strutturata validata dall'Orchestrator.
Il backend trusted dovra validare repository, revisione, identita Engineer,
permessi approvati e loro vincolo al piano prima di utilizzare il modulo Rust
per emettere una credenziale operativa. L'importazione dinamica delle repository
e la preview applicativa locale restano successive alla validazione in CI.
