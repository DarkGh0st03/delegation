import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R240 Engineer root + native Orchestrator VP use no implicit HTTP Adapter config",()=>{
 const direct=read("poc/packages/orchestrator-runtime/src/trusted-engineer-direct-core-port.ts");
 const owner=read("poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts");
 const planning=read("poc/packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts");
 const transport=read("poc/packages/orchestrator-runtime/src/orchestrator-gateway-transport.ts");
 assert.match(direct,/Pick<AdapterClientConfig,"bearerToken">/u);
 assert.match(owner,/adapterBaseUrl\?:string/u);
 assert.match(owner,/Legacy HTTP Engineer fixture requires explicit Adapter URL/u);
 assert.match(planning,/adapterBaseUrl\?:string/u);
 assert.match(transport,/adapterBaseUrl\?: string/u);
 assert.match(transport,/Historical Orchestrator HTTP signing requires explicit Adapter URL/u);
 assert.match(transport,/Canonical signed DAG requires native Rust Orchestrator signer socket/u);
 const presentation=read("poc/packages/orchestrator-runtime/src/native-orchestrator-presentation.ts");
 assert.match(transport,/return await createNativeOrchestratorPresentation\(/u);
 assert.match(presentation,/createOwnerPrivateCryptographicMcpSession\("presentation_create"/u);
 assert.match(presentation,/invokeNativeCrypto\(config,"create_presentation",input\)/u);
 assert.doesNotMatch(presentation,/adapterBaseUrl|fetch\(/u);
});

test("R240 signed Child and repaired D1 use the same native Rust issuer with no Adapter URL",()=>{
 const child=read("poc/packages/orchestrator-runtime/src/trusted-child-crypto-port.ts");
 const issuer=read("poc/packages/orchestrator-runtime/src/trusted-approved-child-issuer.ts");
 const dispatcher=read("poc/packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts");
 const repairChild=read("poc/packages/orchestrator-runtime/src/trusted-admitted-repair-child.ts");
 const repairDag=read("poc/packages/orchestrator-runtime/src/trusted-repair-dag-controller.ts");
 assert.match(child,/adapterBaseUrl\?:string/u);
 assert.match(child,/createNativeRustChildCryptographyPort/u);
 assert.match(child,/Canonical signed Child DC requires native Rust issuer socket/u);
 assert.match(issuer,/adapterBaseUrl\?:string/u);
 assert.match(issuer,/\(!config\.privateCryptoPort&&!config\.adapterBaseUrl\)/u);
 assert.match(dispatcher,/adapter:\{adapterBaseUrl\?:string/u);
 assert.match(repairChild,/adapterBaseUrl\?:string/u);
 assert.match(repairChild,/\(!config\.adapterBaseUrl&&!process\.env\.ADAPTER_ENGINEER_NATIVE_SOCKET\)/u);
 assert.match(repairDag,/adapterBaseUrl\?:string/u);
});

test("R240 native Gitea/Docker Account Suspension E2E does not pass unused HTTP URLs to any native issuer",()=>{
 const main=read("poc/apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs");
 const workers=read("poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs");
 for(const source of [main,workers]){
  assert.match(source,/ENGINEER_CORE_NATIVE_MODE==="1"/u);
  assert.match(source,/\? \{\}:\{adapterBaseUrl:adapterUrl\}/u);
 }
 assert.match(main,/createTrustedEngineerCredentialPort\(/u);
 assert.match(main,/executeTrustedAdmittedRepairDag\(/u);
 assert.match(workers,/TrustedApprovedA2ADispatcher\.loadWithScopedChildAuthority\(/u);
 const native=read("poc/packages/orchestrator-runtime/test/direct-engineer-native-e2e.mjs");
 assert.doesNotMatch(native,/adapterBaseUrl:"http:\/\/127\.0\.0\.1:1"/u);
});
