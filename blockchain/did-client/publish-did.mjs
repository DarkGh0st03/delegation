import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  encodeBytes32String,
  toUtf8Bytes,
} from "ethers";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const registryAddress = process.env.REGISTRY_ADDRESS;
const identityPrivateKey = process.env.IDENTITY_PRIVATE_KEY;
const expectedChainId = BigInt(process.env.CHAIN_ID ?? "31337");
const validitySeconds = BigInt(process.env.VALIDITY_SECONDS ?? "31536000");
const serviceEndpoint =
  process.env.DELEGATION_SERVICE_ENDPOINT ??
  "http://127.0.0.1:3000/delegation-material";

if (!registryAddress) {
  throw new Error("REGISTRY_ADDRESS is required");
}

if (!identityPrivateKey) {
  throw new Error("IDENTITY_PRIVATE_KEY is required");
}

const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();

if (network.chainId !== expectedChainId) {
  throw new Error(
    `Unexpected chain ID: connected to ${network.chainId}, expected ${expectedChainId}`,
  );
}

const signer = new Wallet(identityPrivateKey, provider);
const identityAddress = await signer.getAddress();

const registry = new Contract(
  registryAddress,
  [
    "function identityOwner(address identity) view returns (address)",
    "function setAttribute(address identity, bytes32 name, bytes value, uint256 validity)",
  ],
  signer,
);

const currentOwner = await registry.identityOwner(identityAddress);
if (currentOwner.toLowerCase() !== identityAddress.toLowerCase()) {
  throw new Error(
    `The supplied key controls ${identityAddress}, but current DID owner is ${currentOwner}`,
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const localDir = join(here, "local");
const privateJwkPath = join(localDir, "agent-ed25519-private.jwk.json");
const publicJwkPath = join(localDir, "agent-ed25519-public.jwk.json");

mkdirSync(localDir, { recursive: true });

let publicJwk;

if (existsSync(privateJwkPath) && existsSync(publicJwkPath)) {
  publicJwk = JSON.parse(readFileSync(publicJwkPath, "utf8"));
  console.log("Reusing local Ed25519 key material.");
} else {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const privateJwk = privateKey.export({ format: "jwk" });
  publicJwk = publicKey.export({ format: "jwk" });

  writeFileSync(privateJwkPath, JSON.stringify(privateJwk, null, 2) + "\n");
  writeFileSync(publicJwkPath, JSON.stringify(publicJwk, null, 2) + "\n");

  console.log("Generated a local Ed25519 key pair for the PoC.");
}

if (publicJwk.kty !== "OKP" || publicJwk.crv !== "Ed25519" || !publicJwk.x) {
  throw new Error("Unexpected Ed25519 public JWK");
}

const rawEd25519PublicKey = Buffer.from(publicJwk.x, "base64url");
if (rawEd25519PublicKey.length !== 32) {
  throw new Error(
    `Expected a 32-byte Ed25519 public key, got ${rawEd25519PublicKey.length}`,
  );
}

const ed25519AttributeName = encodeBytes32String(
  "did/pub/Ed25519/veriKey",
);

console.log("");
console.log("Publishing Ed25519 verification method...");
const keyTx = await registry.setAttribute(
  identityAddress,
  ed25519AttributeName,
  rawEd25519PublicKey,
  validitySeconds,
);
const keyReceipt = await keyTx.wait();

const serviceAttributeName = encodeBytes32String(
  "did/svc/DelegationService",
);

console.log("Publishing DelegationService endpoint...");
const serviceTx = await registry.setAttribute(
  identityAddress,
  serviceAttributeName,
  toUtf8Bytes(serviceEndpoint),
  validitySeconds,
);
const serviceReceipt = await serviceTx.wait();

const networkId = `0x${expectedChainId.toString(16)}`;
const did = `did:ethr:${networkId}:${identityAddress}`;

console.log("");
console.log("DID attributes published successfully.");
console.log(`DID: ${did}`);
console.log(`Identity/controller: ${identityAddress}`);
console.log(`Ed25519 public JWK: ${JSON.stringify(publicJwk)}`);
console.log(`DelegationService: ${serviceEndpoint}`);
console.log(`Ed25519 transaction: ${keyReceipt.hash}`);
console.log(`Service transaction: ${serviceReceipt.hash}`);
console.log("");
console.log(
  "The Ed25519 private JWK is stored only under did-client/local/ and is ignored by Git.",
);
