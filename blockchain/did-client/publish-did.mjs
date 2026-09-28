import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resolver } from "did-resolver";
import { getResolver } from "ethr-did-resolver";
import {
  Contract,
  JsonRpcProvider,
  NonceManager,
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

const wallet = new Wallet(identityPrivateKey, provider);
const identityAddress = await wallet.getAddress();
const signer = new NonceManager(wallet);

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

const networkId = `0x${expectedChainId.toString(16)}`;
const did = `did:ethr:${networkId}:${identityAddress}`;

const didResolver = new Resolver(
  getResolver({
    networks: [
      {
        name: "local",
        chainId: expectedChainId,
        rpcUrl,
        registry: registryAddress,
      },
    ],
  }),
);

const before = await didResolver.resolve(did);
if (before.didResolutionMetadata?.error) {
  throw new Error(
    `Unable to resolve DID before update: ${before.didResolutionMetadata.error}`,
  );
}

const existingVerificationMethods =
  before.didDocument?.verificationMethod ?? [];
const existingServices = before.didDocument?.service ?? [];

const alreadyHasEd25519 = existingVerificationMethods.some(
  (method) => method.type === "Ed25519VerificationKey2020",
);

const alreadyHasDelegationService = existingServices.some(
  (service) =>
    service.type === "DelegationService" &&
    service.serviceEndpoint === serviceEndpoint,
);

const ed25519AttributeName = encodeBytes32String(
  "did/pub/Ed25519/veriKey",
);
const serviceAttributeName = encodeBytes32String(
  "did/svc/DelegationService",
);

let keyReceipt = null;
let serviceReceipt = null;

console.log("");

if (alreadyHasEd25519) {
  console.log(
    "Ed25519 verification method already present in the resolved DID Document; skipping publication.",
  );
} else {
  console.log("Publishing Ed25519 verification method...");
  const keyTx = await registry.setAttribute(
    identityAddress,
    ed25519AttributeName,
    rawEd25519PublicKey,
    validitySeconds,
  );
  keyReceipt = await keyTx.wait();
}

if (alreadyHasDelegationService) {
  console.log(
    "DelegationService endpoint already present in the resolved DID Document; skipping publication.",
  );
} else {
  console.log("Publishing DelegationService endpoint...");
  const serviceTx = await registry.setAttribute(
    identityAddress,
    serviceAttributeName,
    toUtf8Bytes(serviceEndpoint),
    validitySeconds,
  );
  serviceReceipt = await serviceTx.wait();
}

console.log("");
console.log("DID publication step completed.");
console.log(`DID: ${did}`);
console.log(`Identity/controller: ${identityAddress}`);
console.log(`Ed25519 public JWK: ${JSON.stringify(publicJwk)}`);
console.log(`DelegationService: ${serviceEndpoint}`);

if (keyReceipt) {
  console.log(`Ed25519 transaction: ${keyReceipt.hash}`);
}

if (serviceReceipt) {
  console.log(`Service transaction: ${serviceReceipt.hash}`);
}

if (!keyReceipt && !serviceReceipt) {
  console.log("No transaction was needed; both DID attributes were already present.");
}

console.log("");
console.log(
  "The Ed25519 private JWK is stored only under did-client/local/ and is ignored by Git.",
);
