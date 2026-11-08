/**
 * R402 conservative tracked-file reachability and security witness inventory.
 * STATIC analysis only. No code entrypoint evaluation, write/merge or inference.
 * Missing observed edges NEVER authorize deletion.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {posix,resolve} from "node:path";
import {SourceTextModule} from "node:vm";
import {fileURLToPath,pathToFileURL} from "node:url";
import {gitTrackedFiles,scanRuntimeIndirections} from "./r6-legacy-references.mjs";
import {LEGACY_MIGRATION_REVIEW,PRIVATE_MCP_KEEP}
 from "./r38516-human-gate-and-legacy-reachability.mjs";
const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const CODE=/\.(?:[cm]?js|jsx|tsx?)$/u;
const TEST=/(?:^|\/)(?:test|tests|native-test|__tests__)\/|\.test\.[cm]?[jt]sx?$/u;
const CONFIG=/(?:^|\/)package\.json$|^\.github\/workflows\/.*\.ya?ml$/u;
const CANONICAL=Object.freeze([
 "poc/apps/orchestrator/src/canonical-owner-deployment.mjs",
 "poc/apps/orchestrator/src/trusted-authority-only-owner-bootstrap.mjs",
 "poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs",
 "poc/apps/orchestrator/src/trusted-authority-only-operational-launcher.mjs",
 "poc/apps/orchestrator/src/start-trusted-engineer-service.mjs",
 "poc/packages/orchestrator-runtime/src/index.ts"
]);
export const SECURITY_WITNESSES=Object.freeze({
 engineer_approval:["poc/packages/orchestrator-runtime/test/signed-authority-only-store.test.ts"],
 native_gateway:["poc/apps/gateway/test/trusted-authority-only-host.test.ts"],
 root_scope:["poc/packages/plan-contracts/test/operational-epoch-scope.test.mjs"],
 project_test_scope:["poc/packages/plan-contracts/test/r3830-test-source-read-grant.test.mjs"],
 gitea_cas:["poc/apps/gateway/test/gitea-update-head-cas.test.ts","poc/apps/gateway/test/gitea-create-head-cas.test.ts"],
 signed_recovery:["poc/packages/orchestrator-runtime/test/trusted-native-d1-first-task-admission.test.ts"],
 real_docker_evidence:["poc/apps/test-runner-controller/test/failure-evidence-docker.test.ts"],
 human_gate:["poc/packages/orchestrator-runtime/test/merge-readiness.test.ts","poc/packages/orchestrator-runtime/test/trusted-security-ci-merge-readiness-link.test.ts"],
 private_crypto_mcp:["poc/mcp-shared/test/owner-private-native-crypto-stdio.test.ts"],
 adaptive_loop:["poc/packages/orchestrator-runtime/test/trusted-authority-only-adaptive-work-loop.test.mjs"],
 registered_card_planner:["poc/packages/orchestrator-runtime/test/trusted-adk-planner.test.ts"],
 legacy_retirement:["poc/apps/orchestrator/test/trusted-authority-only-legacy-retirement.test.mjs"]
});
const ordered=a=>[...a].sort();
function type(path){
 if(path.startsWith(".github/workflows/"))return "workflow";
 if(path.endsWith(".md"))return "documentation";
 if(TEST.test(path))return "test";
 if(path.endsWith("package.json"))return "package-config";
 if(CODE.test(path))return "source";
 return "build-or-asset";
}
function local(path,spec,files){
 if(typeof spec!=="string"||!/^\.{1,2}\//u.test(spec)||
    /[?#\0]/u.test(spec))return null;
 const target=posix.normalize(posix.join(posix.dirname(path),spec));
 if(target.startsWith("../")||target==="../"||target.startsWith("/"))return null;
 return files.has(target)?target:null;
}
function graphReach(seeds,edges){
 const seen=new Set(seeds),queue=[...seeds];
 for(let i=0;i<queue.length;i++)
  for(const edge of edges.get(queue[i])??[])
   if(!seen.has(edge.to)){seen.add(edge.to);queue.push(edge.to);}
 return seen;
}
function configMentions(path,bytes,files){
 let text=bytes;
 if(path.endsWith("package.json")){
  const obj=JSON.parse(bytes);
  text=Object.values(obj.scripts??{}).filter(x=>typeof x==="string").join("\n");
 }
 const results=new Set();
 const rx=/(?:^|[\s"'=(])((?:\.{1,2}\/)?(?:poc\/|\.github\/|src\/|scripts\/|packages\/|apps\/)[A-Za-z0-9_./@-]+\.(?:[cm]?js|tsx?|ya?ml|sh))(?=$|[\s"',):])/gmu;
 for(const found of text.matchAll(rx)){
  const raw=found[1];
  const root=raw.startsWith("poc/")||raw.startsWith(".github/")?".":posix.dirname(path);
  const to=posix.normalize(posix.join(root,raw));
  if(files.has(to)&&to!==path)results.add(to);
 }
 return ordered(results);
}
/** Pure read-only analysis with injected tracked manifest and byte provider. */
export function analyzeR402({tracked,read,strictWitnesses=false}){
 if(!Array.isArray(tracked)||typeof read!=="function")
  throw Error("R402 requires tracked filenames and read-only byte provider");
 const paths=ordered(new Set(tracked)),set=new Set(paths);
 const graph=new Map(paths.map(path=>[path,[]])),unresolved=[],parseFailures=[];
 const incoming=new Map(paths.map(path=>[path,[]]));
 const add=(source,to,kind)=>{
  if(!to||to===source||!set.has(to))return;
  if(graph.get(source).some(e=>e.to===to&&e.kind===kind))return;
  graph.get(source).push({to,kind});incoming.get(to).push({source,kind});
 };
 let parsed=0;
 for(const path of paths){
  if(!CODE.test(path)&&!CONFIG.test(path))continue;
  let bytes;
  try{bytes=read(path);}
  catch{unresolved.push({source:path,kind:"unreadable-tracked-file"});continue;}
  if(typeof bytes!=="string"){
   unresolved.push({source:path,kind:"non-text-file"});continue;
  }
  if(CODE.test(path)){
   let source=bytes;
   try{
    if(/\.tsx?$/u.test(path))source=stripTypeScriptTypes(source);
    const module=new SourceTextModule(source,{identifier:path});
    parsed++;
    for(const spec of module.dependencySpecifiers){
     if(!/^\.{1,2}\//u.test(spec))continue;
     const target=local(path,spec,set);
     if(target)add(path,target,"static-esm");
     else unresolved.push({source:path,kind:"unresolved-relative-static",specifier:spec});
    }
   }catch{
    parseFailures.push(path);
    unresolved.push({source:path,kind:"esm-parser-unavailable"});
   }
   const scan=scanRuntimeIndirections(source);
   for(const hint of scan.hints){
    if(!/^\.{1,2}\//u.test(hint.specifier))continue;
    const target=local(path,hint.specifier,set);
    if(target)add(path,target,hint.kind);
    else unresolved.push({source:path,kind:"unresolved-relative-indirection",specifier:hint.specifier});
   }
   for(const hint of scan.unresolved)
    unresolved.push({source:path,kind:hint.kind});
  }
  if(CONFIG.test(path)){
   try{for(const to of configMentions(path,bytes,set))
    add(path,to,"configuration-literal-mention");}
   catch{unresolved.push({source:path,kind:"configuration-parse-unavailable"});}
  }
 }
 const roots=paths.filter(p=>CANONICAL.includes(p)||CONFIG.test(p));
 const testRoots=paths.filter(p=>TEST.test(p)&&CODE.test(p));
 const potential=graphReach(roots,graph),tests=graphReach(testRoots,graph);
 let fastCi="";
 try{fastCi=read(".github/workflows/fast-ci.yml");}
 catch{unresolved.push({source:".github/workflows/fast-ci.yml",kind:"fast-ci-unavailable"});}
 const witnesses=Object.entries(SECURITY_WITNESSES).map(([property,required])=>{
  const present=required.filter(path=>set.has(path));
  return {property,required,present,
   mentionedInFastCi:present.filter(path=>fastCi.includes(path)),
   status:present.length===required.length?"SOURCE_PRESENT":"SOURCE_MISSING",
   assertionsReviewed:false,executedInThisAudit:false};
 });
 const missing=witnesses.filter(x=>x.status==="SOURCE_MISSING");
 if(strictWitnesses&&missing.length)
  throw Error("R402 security witnesses missing: "+missing.map(x=>x.property).join(","));
 const legacy=[...LEGACY_MIGRATION_REVIEW,...PRIVATE_MCP_KEEP].map(path=>({
  path,present:set.has(path),incoming:ordered((incoming.get(path)??[]).map(
   ({source,kind})=>kind+":"+source)),
  potentialEntrypointPath:potential.has(path),
  status:PRIVATE_MCP_KEEP.includes(path)?"KEEP_PRIVATE_CRYPTO_MCP":"REVIEW_CALLERS_FIRST",
  deletionAuthorized:false
 }));
 const summary={
  tracked:paths.length,code:paths.filter(x=>CODE.test(x)).length,
  parsed,parseFailures:parseFailures.length,
  workflowFiles:paths.filter(x=>x.startsWith(".github/workflows/")).length,
  testSources:testRoots.length,roots:roots.length,
  observedEdges:[...graph.values()].reduce((n,links)=>n+links.length,0),
  potentiallyReachable:potential.size,testGraphReachable:tests.size,
  noObservedEntrypointPath:paths.length-potential.size,
  unresolved:unresolved.length,
  missingSecurityWitnessGroups:missing.map(x=>x.property),
  legacyTargetsPresent:legacy.filter(x=>x.present&&x.status==="REVIEW_CALLERS_FIRST").length,
  protectedMcpTargetsPresent:legacy.filter(x=>x.present&&x.status==="KEEP_PRIVATE_CRYPTO_MCP").length
 };
 return {
  schema:"r402-tracked-static-v1",
  methodology:"Parsed static ESM and literal import/require/configuration hints; no external package resolution, execution, computed imports, coverage attestation or deletion authority",
  summary,roots,witnesses,legacy,unresolved,
  files:paths.map(path=>({
   path,kind:type(path),entryRoot:roots.includes(path),
   potentiallyReachable:potential.has(path),testGraphReachable:tests.has(path),
   incomingCount:(incoming.get(path)??[]).length,
   outgoing:graph.get(path)
  })),
  externalConsumersVerified:false,testCoverageAttested:false,
  runtimeReachabilityCertified:false,deletionAuthorized:false,
  paidInferenceCalls:0
 };
}
export function inventoryR402(root=ROOT){
 const tracked=gitTrackedFiles(root);
 return analyzeR402({tracked,read:path=>readFileSync(resolve(root,path),"utf8"),
  strictWitnesses:true});
}
function main(){
 const r=inventoryR402();
 const arg=process.argv.indexOf("--out");
 if(arg!==-1){
  if(!process.argv[arg+1])throw Error("R402 --out requires a path");
  writeFileSync(resolve(process.argv[arg+1]),JSON.stringify(r,null,2)+"\n");
 }
 console.log(JSON.stringify({event:"R402_STATIC_REACHABILITY",...r.summary,
  deletion_authorized:false,reachability_certified:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main();
