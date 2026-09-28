import { Resolver } from "did-resolver";
import { getResolver } from "ethr-did-resolver";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const registryAddress = process.env.REGISTRY_ADDRESS;
const did = process.env.DID;
const chainId = Number(process.env.CHAIN_ID ?? "31337");

if (!registryAddress) {
  throw new Error("REGISTRY_ADDRESS is required");
}
if (!did) {
  throw new Error("DID is required");
}

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
if (result.didResolutionMetadata?.error || !result.didDocument) {
  throw new Error(
    `DID resolution failed for ${did}: ${result.didResolutionMetadata?.error ?? "missing didDocument"}`,
  );
}

process.stdout.write(JSON.stringify(result.didDocument));
