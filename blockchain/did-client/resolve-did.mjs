import { Resolver } from "did-resolver";
import { getResolver } from "ethr-did-resolver";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const registryAddress = process.env.REGISTRY_ADDRESS;
const identityAddress = process.env.IDENTITY_ADDRESS;
const chainId = 31337;

if (!registryAddress) {
  throw new Error("REGISTRY_ADDRESS is required");
}

if (!identityAddress) {
  throw new Error("IDENTITY_ADDRESS is required");
}

const networkId = `0x${chainId.toString(16)}`;
const did = `did:ethr:${networkId}:${identityAddress}`;

const resolver = new Resolver(
  getResolver({
    networks: [
      {
        name: "local",
        chainId,
        rpcUrl,
        registry: registryAddress,
      },
    ],
  }),
);

const result = await resolver.resolve(did);

if (result.didResolutionMetadata?.error) {
  console.error("DID resolution failed:");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(`Resolved DID: ${did}`);
console.log("");
console.log(JSON.stringify(result, null, 2));
