import test from "node:test";
import assert from "node:assert/strict";
import {stat} from "node:fs/promises";
import {BaseLlm} from "@google/adk";
import {startSpecializedAgentServer} from "../src/server.ts";
class UnusedModel extends BaseLlm{
 constructor(){super({model:"offline-bootstrap-only"});}
 async *generateContentAsync(){throw Error("No model call during bootstrap");}
 connect():never{throw Error("No model connection during bootstrap");}
}
const discovery={planTaskId:"discovery",childCredentialId:"urn:child:discovery",
 presenterId:"did:example:backend",branch:"feature/invoice-approval",
 path:"src/invoices.ts",
 resource:"gitea://gitea.local/sample/invoice-service/branches/feature%2Finvoice-approval/files/src/invoices.ts",
 repository:{authority:"gitea.local",owner:"sample",repository:"invoice-service"},
 audience:"cloud-access-gateway" as const,isTaskActive:()=>true};
const adk=()=>({model:new UnusedModel(),gatewayBaseUrl:"http://gateway.local",
 adapterBaseUrl:"http://adapter.local",adapterToken:"private-backend-bearer"});
test("Backend A2A host owns private discovery lifetime without publishing its selectors",async t=>{
 const server=await startSpecializedAgentServer({role:"backend",port:0,
  adk:adk(),backendDiscovery:discovery});
 t.after(()=>server.close());
 const ports=server.privateDiscoveryPorts!;
 assert.ok(ports);
 assert.equal((await stat(ports.ownerBinding.secretFile)).mode&0o777,0o600);
 const card=JSON.stringify(server.card);
 assert.equal(card.includes(ports.ownerBinding.socketPath),false);
 assert.equal(card.includes(ports.gatewaySigner.secretFile),false);
 assert.equal(card.includes("private-backend-bearer"),false);
 await Promise.all([server.close(),server.close()]);
 await assert.rejects(stat(ports.ownerBinding.secretFile),{code:"ENOENT"});
 await assert.rejects(stat(ports.gatewaySigner.secretFile),{code:"ENOENT"});
});
test("Frontend cannot install the private Backend discovery host",async()=>{
 await assert.rejects(startSpecializedAgentServer({role:"frontend",port:0,
  adk:adk(),backendDiscovery:discovery}),/one Backend ADK signing source/);
});
