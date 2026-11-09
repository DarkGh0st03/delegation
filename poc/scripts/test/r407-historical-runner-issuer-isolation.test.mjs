/**
 * R407 offline tests. No Gitea, OPA, Docker, HTTP, tokens or paid models.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {SourceTextModule} from "node:vm";
import {scanRuntimeIndirections} from "../r6-legacy-references.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const file="poc/apps/test-runner-controller/scripts/approved-gateway-runner-session.mjs";
const content=()=>readFileSync(resolve(root,file),"utf8");
/**
 * R430: Runner native EVM may still use the public Adapter for Child and VP,
 * but Software Engineer Root issuance/revocation is always Rust native.
 * A scripted non-native Runner never constructs this credential port.
 */
test("R430 Runner EVM issuer uses canonical Rust only; historical gate is retired",()=>{
 const src=content(),parsed=new SourceTextModule(src,{identifier:file});
 const legacy="../../../packages/orchestrator-runtime/src/authority-client.ts";
 assert.ok(!parsed.dependencySpecifiers.includes(legacy));
 assert.doesNotMatch(src,/SoftwareEngineerAuthorityBootstrap|authority-client\.ts|approved-runner-historical-issuer-gate\.mjs/u);
 const hints=scanRuntimeIndirections(src).hints.filter(x=>
  x.kind==="dynamic-import"&&x.specifier===legacy);
 assert.deepEqual(hints,[]);
 assert.match(src,/import \{createTrustedEngineerCredentialPort\} from/u);
 const entry=src.indexOf("    if(native){");
 const checked=src.indexOf('process.env.ADAPTER_TRUST_PROFILE!=="evm"',entry);
 const issuer=src.indexOf("createTrustedEngineerCredentialPort({",checked);
 assert.ok(entry>=0&&checked>entry&&issuer>checked,
  "Native Root issuance must be Rust only, behind an EVM trust check");
 assert.ok(!existsSync(resolve(root,
  "poc/apps/test-runner-controller/scripts/approved-runner-historical-issuer-gate.mjs")));
 assert.doesNotMatch(src,/DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE/u);
});
test("R430 native Runner no longer accepts historical HTTP issuer selector flags",()=>{
 const src=content();
 assert.doesNotMatch(src,/assertHistoricalRunnerEvmIssuerAllowed/u);
 assert.match(src,/createTrustedEngineerCredentialPort\(\{/u);
 const native=readFileSync(resolve(root,
  "poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts"),"utf8");
 assert.match(native,/Canonical Engineer root requires native Rust issuer socket/u);
 assert.doesNotMatch(native,/authority-client\.ts|createLegacyOwnerPrivateMcpEngineerCredentialPort/u);
});
