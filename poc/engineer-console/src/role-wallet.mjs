/**
 * MCP-wallet process of ONE role (Orchestrator, Backend, Frontend or Test).
 *
 * Started by the trusted owner with an environment that contains only this
 * role's secrets (its EVM account key and its caller token) and public data
 * (chain addresses, the other roles' DIDs). The Rust runtime generates the
 * role's delegation signing key IN THIS PROCESS, publishes only its public
 * key on-chain, and serves this role's operations (VPs; Child DCs for the
 * Orchestrator) on a private socket. The key never leaves this process.
 */
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const role = process.env.ADAPTER_SIGNING_ROLE;
try {
  const native = require("../../packages/orchestrator-runtime/src/native/delegation-engineer.node");
  if (typeof native.start_role_wallet !== "function") throw Error("addon without wallet support");
  native.start_role_wallet();
  process.stdout.write(`WALLET_READY ${role}\n`);
} catch (error) {
  process.stderr.write(`WALLET_FAILED ${role}: ${error?.message ?? error}\n`);
  process.exit(1);
}
// Keep serving until the owner stops this process.
setInterval(() => {}, 1 << 30);
process.on("SIGTERM", () => process.exit(0));
