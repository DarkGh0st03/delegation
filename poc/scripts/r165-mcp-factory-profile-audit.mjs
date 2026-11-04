/**
 * R165 fail-closed inventory of MCP HTTP factory call sites.
 *
 * The canonical ADK signed DAG uses crypto-only MCP and direct Gateway
 * FunctionTools. Historic A2A/ADK MCP routing survives only as explicitly
 * selected legacy fixtures, NOT an implicit fallback. This audit scans every
 * tracked JavaScript/TypeScript source (not just known test directories).
 *
 * Static lexical guard: not a full data-flow proof. Its purpose is to catch
 * new accidental legacy exposure before GitHub Actions executes any tool.
 */
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const FACTORY=/\bcreateSharedMcpHttpServer\s*\(\s*\{/gu;
const PROFILE=/\bprofile\s*:\s*(?:"(legacy|crypto)"|'(legacy|crypto)'|(toolProfile))/u;
const SCAN_BYTES=350;
const codeFile=path=>/^poc\//u.test(path)&&/\.(?:mjs|js|ts)$/u.test(path);

export function inspectMcpFactoryCalls(root){
 const tracked=execFileSync("git",["ls-files","--cached","-z"],{
  cwd:root,encoding:"utf8"
 }).split("\0").filter(codeFile).sort();
 const calls=[];
 const errors=[];
 for(const file of tracked){
  const source=readFileSync(resolve(root,file),"utf8");
  for(const match of source.matchAll(FACTORY)){
   const i=match.index+match[0].length;
   const lookahead=source.slice(i,i+SCAN_BYTES);
   const prof=lookahead.match(PROFILE);
   const profile=prof?.[1]??prof?.[2]??prof?.[3]??"missing";
   const line=source.slice(0,match.index).split("\n").length;
   calls.push({file,line,profile});
   if(profile==="missing")
    errors.push(file+":"+line+": missing explicit MCP profile");
   else if(profile==="toolProfile")
    errors.push(file+":"+line+": dynamic profile cannot activate retired Shared MCP launcher");
   else if(profile==="legacy")
    errors.push(file+":"+line+": obsolete repository MCP profile forbidden");
   else if(file==="poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs"&&profile!=="crypto")
    errors.push(file+":"+line+": signed DAG must use crypto-only MCP");
  }
 }
 // R209: the canonical DAG is now task-local MCP SDK, not Shared HTTP.
 // An accidental shared listener/worker must FAIL this audit.
 const dag=readFileSync(resolve(root,
  "poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs"),"utf8");
 const local=readFileSync(resolve(root,
  "poc/packages/agent-runtime/src/local-crypto-mcp-bridge.ts"),"utf8");
 if(calls.some(c=>c.file===
   "poc/apps/gateway/native-test/native-approved-planner-dag-positive.mjs"))
  errors.push("signed DAG must not instantiate Shared MCP HTTP");
 if(/\bCryptoWorkerRouter\b|\bcreateSharedMcpHttpServer\b|\bmcpCryptoUrl\b/u.test(dag))
  errors.push("signed DAG retained Shared MCP HTTP routing");
 if(!/cryptoProofCount/u.test(dag)||
    !/registerTool\("delegation_create_presentation"/u.test(local)||
    !/InMemoryTransport\.createLinkedPair\(/u.test(local))
  errors.push("signed DAG task-local crypto MCP proof path not found");
 // R221: the old executable is intentionally fail-closed. Historical
 // crypto HTTP factories can remain in explicitly isolated tests, but a
 // runnable Shared MCP entrypoint must NEVER reappear.
 const launcher=readFileSync(resolve(root,"poc/mcp-shared/src/main.ts"),"utf8");
 if(!launcher.includes('throw new Error("standalone_shared_mcp_launcher_retired")')||
    /\bcreateSharedMcpHttpServer\b|\bCryptoWorkerRouter\b|\.listen\(/u.test(launcher))
  errors.push("retired Shared MCP launcher must fail closed");
 if(calls.some(c=>c.file==="poc/mcp-shared/src/main.ts"))
  errors.push("retired Shared MCP launcher instantiated an HTTP listener");
 return {tracked:tracked.length,calls,errors};
}
function main(){
 const root=fileURLToPath(new URL("../../",import.meta.url));
 const result=inspectMcpFactoryCalls(root);
 for(const e of result.errors)console.error("R165 MCP boundary: "+e);
 console.log("R165 MCP profile call audit: "+result.tracked+
   " code files / "+result.calls.length+" call sites / "+
   result.calls.filter(c=>c.profile==="legacy").length+" explicit legacy");
 if(result.errors.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main();
