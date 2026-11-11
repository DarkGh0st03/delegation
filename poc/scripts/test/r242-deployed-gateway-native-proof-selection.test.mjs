import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R242 deployed Gateway selects the sole Engineer issuer status socket and independent Core Rust root VP verifier",()=>{
 const deployed=read("poc/apps/gateway/src/trusted-plan-deployment.ts");
 assert.match(deployed,/const directCore=process\.env\.ENGINEER_CORE_NATIVE_MODE==="1"/u);
 assert.match(deployed,/issuerSocket=directCore/u);
 assert.match(deployed,/process\.env\.ADAPTER_ENGINEER_NATIVE_SOCKET/u);
 assert.match(deployed,/process\.env\.ADAPTER_CALLER_GATEWAY/u);
 assert.match(deployed,/nativeSocketPath:issuerSocket!/u);
 assert.match(deployed,/verifier:directCore\s*\?loadDirectCoreRustVerifier\(\)/u);
 assert.match(deployed,/Native root status requires signed epoch journal and authenticated Rust issuer transport/u);
 assert.match(deployed,/Direct Engineer deployment requires independent Core Rust Gateway verifier/u);
 const native=read("poc/apps/gateway/src/trusted-gateway-native-root-status.ts");
 assert.match(native,/invokeNativeCrypto\(/u);
 assert.match(native,/read_issued_root/u);
 assert.match(native,/read_credential_status/u);
});

test("R242 canonical deployed Gateway cannot downgrade native VP verification to HTTP Adapter",()=>{
 const config=read("poc/apps/gateway/src/config.ts");
 assert.match(config,/ENGINEER_CORE_NATIVE_MODE==="1"&&verifierMode!=="core-rust"/u);
 assert.match(config,/Direct Engineer Core cannot use legacy Adapter Gateway verifier/u);
 const deployment=read("poc/apps/gateway/src/trusted-plan-deployment.ts");
 assert.match(deployment,/loadDirectCoreRustVerifier\(\)/u);
 assert.match(deployment,/new AdapterVerifierClient/u);
 assert.match(deployment,/directCore\s*\?loadDirectCoreRustVerifier\(\)/u);
 assert.doesNotMatch(deployment,/verifier:new AdapterVerifierClient\(/u);
});
