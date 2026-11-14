/**
 * Staging deployer service entrypoint (see deployer.mjs).
 * Reads the read-only Gitea "deployer" token from the config volume and
 * reconciles every few seconds. It holds the Docker socket (like the
 * Runner) but never passes the token to the app containers.
 */
import {readFileSync} from "node:fs";
import {parseEnvFile} from "../../poc/engineer-console/src/env.mjs";
import {StagingDeployer} from "./deployer.mjs";

const local = parseEnvFile(readFileSync("/config/local.env", "utf8"));
const gitea = parseEnvFile(readFileSync("/config/gitea.env", "utf8"));
if (!gitea.GITEA_DEPLOYER_TOKEN) {
  console.error("Staging: GITEA_DEPLOYER_TOKEN mancante in /config (gitea-bootstrap non completato)");
  process.exit(1);
}
const env = process.env;
const deployer = new StagingDeployer({
  stagingDir: env.STAGING_DIR ?? "/staging",
  gitea: {baseUrl: env.GITEA_URL ?? "http://gitea:3000", org: local.GITEA_ORG,
    token: gitea.GITEA_DEPLOYER_TOKEN},
  network: env.STAGING_NETWORK ?? "delegation-staging",
  bindAddress: env.STAGING_BIND_ADDRESS ?? "127.0.0.1",
  hostPorts: [Number(env.STAGING_FIRST_PORT ?? 8801), Number(env.STAGING_LAST_PORT ?? 8899)],
  // Optional corporate-proxy support for the build step only (same idea as
  // the "extra_ca" build secret of deploy/Dockerfile). Empty by default.
  buildEnv: {HTTP_PROXY: env.STAGING_BUILD_HTTP_PROXY, HTTPS_PROXY: env.STAGING_BUILD_HTTPS_PROXY,
    http_proxy: env.STAGING_BUILD_HTTP_PROXY, https_proxy: env.STAGING_BUILD_HTTPS_PROXY},
  extraCaPath: env.STAGING_BUILD_EXTRA_CA || undefined
});

const intervalMs = Math.max(2, Number(env.STAGING_POLL_SECONDS ?? 5)) * 1000;
let stopping = false, timer;
async function loop() {
  if (stopping) return;
  try { await deployer.tick(); }
  catch (error) { console.error("Staging:", error.message); }
  if (!stopping) timer = setTimeout(loop, intervalMs);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true; clearTimeout(timer);
    await deployer.shutdown().catch(() => {});
    process.exit(0);
  });
}
console.log(`Staging deployer: controllo di main ogni ${intervalMs / 1000} s`);
loop();
