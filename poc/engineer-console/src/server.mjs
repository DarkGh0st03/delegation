/**
 * Start the Engineer console.
 *
 * Normally started by Docker Compose (service "app"): it listens inside the
 * container and Compose publishes it on 127.0.0.1:8700 of the host only.
 * For development on the host it binds 127.0.0.1 (see docs/LOCAL_SETUP.md).
 */
import {createServer} from "node:http";
import {ConsoleAuth, readUserFile} from "./auth.mjs";
import {createConsoleHandler} from "./app.mjs";
import {loadLocalConfig} from "./env.mjs";
import {GiteaAdmin} from "./gitea.mjs";
import {checkEnvironment} from "./health.mjs";
import {ConsoleStore} from "./store.mjs";
import {startTrustedCore} from "./trusted-core.mjs";

const config = loadLocalConfig();
const users = readUserFile(config.usersPath);
if (Object.keys(users).length === 0) {
  process.stderr.write(
    "Nessun utente Engineer configurato.\n" +
    (config.composeMode ? "Imposta ENGINEER_PASSWORD nel file .env e riavvia.\n"
      : "Crealo con: node poc/engineer-console/scripts/create-user.mjs engineer\n"));
  process.exit(1);
}
if (!config.infraEnvPresent) {
  process.stderr.write("Configurazione locale mancante: avvia con docker compose up\n");
  process.exit(1);
}

// Native Rust components start in the background (Compose deployment only);
// their status is shown on the environment page until they are ready.
const core = {engineer: {ok: false, detail: "avvio in corso..."},
  verifier: {ok: false, detail: "in attesa del core dell'Engineer"}};
if (config.composeMode) {
  startTrustedCore(config).then(result => {
    Object.assign(core, result);
    process.stdout.write(`Core Engineer: ${result.engineer.ok ? "OK" : "ERRORE"} - ${result.engineer.detail}\n` +
      `Verificatore Gateway: ${result.verifier.ok ? "OK" : "ERRORE"} - ${result.verifier.detail}\n`);
  });
}

const handler = createConsoleHandler({
  auth: new ConsoleAuth({users}),
  gitea: new GiteaAdmin({
    baseUrl: config.giteaUrl, adminUser: config.giteaAdminUser,
    adminPassword: config.giteaAdminPassword, org: config.giteaOrg,
    gatewayUser: config.giteaGatewayUser, runnerUser: config.giteaRunnerUser
  }),
  store: new ConsoleStore(config.stateDir),
  health: () => checkEnvironment(config, config.composeMode ? {trustedCore: core} : {}),
  port: config.consolePort
});

const server = createServer(handler);
server.listen(config.consolePort, config.consoleHost, () => {
  process.stdout.write(
    `Engineer console: http://127.0.0.1:${config.consolePort}\n` +
    "(Ctrl+C per fermarla)\n");
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
