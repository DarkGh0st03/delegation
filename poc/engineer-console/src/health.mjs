/**
 * Read-only environment checks shown to the Engineer before any session.
 * Each check reports ok/fail and a short Italian hint; nothing is started.
 */
import {execFile} from "node:child_process";
import {existsSync} from "node:fs";

/** Load a native addon in a separate short-lived process: proves the file
 * exists AND links on this system (e.g. its shared libraries are present). */
export function loadAddonInChild(path) {
  return new Promise(resolvePromise => {
    execFile(process.execPath, ["-e", "require(process.argv[1])", path],
      {timeout: 15000}, (error, _stdout, stderr) => {
        if (!error) return resolvePromise({ok: true, detail: "caricato"});
        const line = String(stderr).split("\n").find(l => /Error:/u.test(l)) ?? error.message;
        resolvePromise({ok: false, detail: line.trim().slice(0, 200)});
      });
  });
}

async function timed(fn) {
  try { return await fn(); } catch (error) {
    return {ok: false, detail: error?.message ?? String(error)};
  }
}

async function rpc(fetchFn, url, method, params = []) {
  const response = await fetchFn(url, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
    signal: AbortSignal.timeout(3000)
  });
  const body = await response.json();
  if (body.error) throw Error(body.error.message ?? "RPC error");
  return body.result;
}

export async function checkEnvironment(config, {fetchFn = fetch, fileExists = existsSync,
  loadAddon = loadAddonInChild} = {}) {
  const checks = [];
  const restart = config.composeMode ? "riavvia lo stack: docker compose up -d"
    : "bash poc/scripts/phase1-up.sh";
  const rebuild = config.composeMode ? "ricostruisci l'immagine: docker compose build"
    : "bash poc/scripts/local-prepare.sh";
  const add = (id, label, result, hint) =>
    checks.push({id, label, ok: !!result.ok, detail: result.detail ?? "", hint: result.ok ? "" : hint});

  add("setup", "Configurazione locale privata",
    {ok: config.infraEnvPresent},
    "Configurazione mancante: " + restart);

  add("gitea", "Gitea (repository locali)", await timed(async () => {
    const r = await fetchFn(config.giteaUrl + "/api/healthz", {signal: AbortSignal.timeout(3000)});
    return {ok: r.ok, detail: "HTTP " + r.status};
  }), "Gitea non risponde: " + restart);

  add("opa", "OPA (motore delle policy)", await timed(async () => {
    const r = await fetchFn(config.opaUrl + "/health", {signal: AbortSignal.timeout(3000)});
    return {ok: r.ok, detail: "HTTP " + r.status};
  }), "OPA non risponde: " + restart);

  add("anvil", "Anvil (blockchain locale)", await timed(async () => {
    const id = parseInt(await rpc(fetchFn, config.anvilUrl, "eth_chainId"), 16);
    return {ok: id === config.chainId, detail: "chain id " + id};
  }), "Anvil non risponde: " + restart);

  add("contracts", "Registri on-chain (DID, Trust, Issuer)", await timed(async () => {
    const addresses = [config.didRegistryAddress, config.trustRegistryAddress,
      config.issuerRegistryAddress];
    if (addresses.some(a => !/^0x[0-9a-fA-F]{40}$/u.test(a)))
      return {ok: false, detail: "indirizzi mancanti in poc/infra/runtime/trust.env"};
    for (const address of addresses) {
      const code = await rpc(fetchFn, config.anvilUrl, "eth_getCode", [address, "latest"]);
      if (typeof code !== "string" || code === "0x")
        return {ok: false, detail: "nessun contratto a " + address};
    }
    return {ok: true, detail: "3 contratti presenti"};
  }), "Contratti assenti (Anvil riavviato?): " + restart);

  const addon = async path => fileExists(path) ? loadAddon(path)
    : {ok: false, detail: "file assente"};
  add("native-gateway", "Modulo Rust del Gateway (verifica)",
    await addon(config.nativeGatewayAddon), "Modulo non utilizzabile: " + rebuild);

  add("native-engineer", "Modulo Rust dell'Engineer (emissione)",
    await addon(config.nativeEngineerAddon), "Modulo non utilizzabile: " + rebuild);

  return {ready: checks.every(c => c.ok), checks};
}
