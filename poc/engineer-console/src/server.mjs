/**
 * Start the Engineer console on 127.0.0.1 only.
 *
 *   node poc/engineer-console/src/server.mjs
 *
 * Prerequisites: local infrastructure prepared with poc/scripts/phase1-up.sh
 * and at least one Engineer user (poc/engineer-console/scripts/create-user.mjs).
 */
import {createServer} from "node:http";
import {join} from "node:path";
import {ConsoleAuth, readUserFile} from "./auth.mjs";
import {createConsoleHandler} from "./app.mjs";
import {CONSOLE_DIR, loadLocalConfig} from "./env.mjs";
import {GiteaAdmin} from "./gitea.mjs";
import {checkEnvironment} from "./health.mjs";
import {ConsoleStore} from "./store.mjs";

const config = loadLocalConfig();
const usersPath = join(CONSOLE_DIR, "users.json");
const users = readUserFile(usersPath);
if (Object.keys(users).length === 0) {
  process.stderr.write(
    "Nessun utente Engineer configurato.\n" +
    "Crealo con: node poc/engineer-console/scripts/create-user.mjs engineer\n");
  process.exit(1);
}
if (!config.infraEnvPresent) {
  process.stderr.write(
    "Manca poc/infra/.env: prepara prima l'ambiente con bash poc/scripts/phase1-up.sh\n");
  process.exit(1);
}

const handler = createConsoleHandler({
  auth: new ConsoleAuth({users}),
  gitea: new GiteaAdmin({
    baseUrl: config.giteaUrl, adminUser: config.giteaAdminUser,
    adminPassword: config.giteaAdminPassword, org: config.giteaOrg,
    gatewayUser: config.giteaGatewayUser, runnerUser: config.giteaRunnerUser
  }),
  store: new ConsoleStore(CONSOLE_DIR),
  health: () => checkEnvironment(config),
  port: config.consolePort
});

const server = createServer(handler);
server.listen(config.consolePort, "127.0.0.1", () => {
  process.stdout.write(
    `Engineer console: http://127.0.0.1:${config.consolePort}\n` +
    "(Ctrl+C per fermarla)\n");
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
