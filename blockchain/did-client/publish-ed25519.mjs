import { Contract, JsonRpcProvider, Wallet, encodeBytes32String } from "ethers";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const registryAddress = process.env.REGISTRY_ADDRESS;
const identityPrivateKey = process.env.IDENTITY_PRIVATE_KEY;
const ed25519JwkJson = process.env.ED25519_JWK;
const expectedChainId = BigInt(process.env.CHAIN_ID ?? "31337");
const validitySeconds = BigInt(process.env.VALIDITY_SECONDS ?? "31536000");

if (!registryAddress) throw new Error("REGISTRY_ADDRESS is required");
if (!identityPrivateKey) throw new Error("IDENTITY_PRIVATE_KEY is required");
if (!ed25519JwkJson) throw new Error("ED25519_JWK is required");

const jwk = JSON.parse(ed25519JwkJson);
if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
  throw new Error("ED25519_JWK must contain an OKP/Ed25519 public key");
}

const rawKey = Buffer.from(jwk.x, "base64url");
if (rawKey.length !== 32) {
  throw new Error(`Expected 32-byte Ed25519 public key, got ${rawKey.length}`);
}

const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
if (network.chainId !== expectedChainId) {
  throw new Error(
    `Unexpected chain ID ${network.chainId}; expected ${expectedChainId}`,
  );
}

const wallet = new Wallet(identityPrivateKey, provider);
const identity = await wallet.getAddress();
const registry = new Contract(
  registryAddress,
  [
    "function identityOwner(address identity) view returns (address)",
    "function setAttribute(address identity, bytes32 name, bytes value, uint256 validity)",
  ],
  wallet,
);

const owner = await registry.identityOwner(identity);
if (owner.toLowerCase() !== identity.toLowerCase()) {
  throw new Error(
    `Supplied key controls ${identity}, but current DID owner is ${owner}`,
  );
}

const attributeName = encodeBytes32String("did/pub/Ed25519/veriKey");
const tx = await registry.setAttribute(
  identity,
  attributeName,
  rawKey,
  validitySeconds,
);
const receipt = await tx.wait();

const networkId = `0x${expectedChainId.toString(16)}`;
console.log(`did=${`did:ethr:${networkId}:${identity}`}`);
console.log(`ed25519Tx=${receipt.hash}`);
