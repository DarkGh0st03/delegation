/**
 * R404 — read-only audit of configured CI test/script invocations.
 * Configuration is not execution evidence, and absence of a literal
 * command is NEVER deletion approval. No provider/model invocation.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {posix,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {gitTrackedFiles} from "./r6-legacy-references.mjs";
import {SECURITY_WITNESSES} from "./r402-reachability-coverage-inventory.mjs";
const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const TEST=/(?:^|\/)(?:test|tests|native-test|__tests__)\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const WORKFLOW=/^\.github\/workflows\/[^/]+\.ya?ml$/u;
const MANIFEST=/(?:^|\/)package\.json$/u;
const SOURCE_PATH=/((?:\.{1,2}\/)?(?:poc\/|test\/|tests\/|scripts\/|src\/|apps\/|packages\/)[A-Za-z0-9_./*?-]+\.(?:[cm]?js|jsx|tsx?))/gu;
const ordered=x=>[...x].sort();
const lines=x=>x.replace(/\\\r?\n\s*/gu," ").split(/\r?\n/u)
 .map(v=>v.trim()).filter(v=>v&&!v.startsWith("#"));
function runs(text){
 const a=text.split(/\r?\n/u),out=[];
 for(let i=0;i<a.length;i++){
  const m=/^(\s*)(?:-\s*)?run:\s*(.*)$/u.exec(a[i]);
  if(!m)continue;
  const at=i+1,indent=m[1].length,commands=[];
  if(!/^[|>][-+]?\s*(?:#.*)?$/u.test(m[2])){
   if(m[2].trim())commands.push(m[2].trim());
  }else{
   while(i+1<a.length){
    const next=a[i+1],space=/^ */u.exec(next)[0].length;
    if(next.trim()&&space<=indent)break;
    commands.push(next.trim());i++;
   }
  }
  out.push({line:at,body:commands.join("\n")});
 }
 return out;
}
function pathsInCommand(line,cwd,tracked){
 const found=[];
 for(const match of line.matchAll(SOURCE_PATH)){
  const spec=match[1],target=posix.normalize(posix.join(cwd,spec));
  if(target===".."||target.startsWith("../")||target.startsWith("/"))continue;
  const glob=/[*?]/u.test(target);
  const escaped=[...target].map(c=>
   c==="*"?"[^/]*":c==="?"?"[^/]":
   /[.+^$(){}|\\[\]]/u.test(c)?"\\"+c:c).join("");
  const re=new RegExp("^"+escaped+"$","u");
  const candidates=glob?tracked.filter(p=>re.test(p)):
   tracked.filter(p=>p===target);
  found.push({spec,glob,targets:candidates});
 }
 return found;
}
function npmInvocation(line){
 const m=/\bnpm\s+(?:--prefix\s+(\S+)\s+)?(?:run\s+)?([\w:.-]+)(.*)$/u.exec(line);
 if(!m)return null;
 const workspace=/(?:^|\s)(?:-w|--workspace)\s+(\S+)/u.exec(m[3])?.[1]??null;
 return {prefix:m[1]??null,script:m[2],workspace};
}
export function analyzeR404({tracked,read,strictWitnesses=false}){
 if(!Array.isArray(tracked)||typeof read!=="function")throw Error("R404 requires tracked files and read");
 const all=ordered(new Set(tracked)),present=new Set(all);
 const workflows=all.filter(p=>WORKFLOW.test(p)),testPaths=all.filter(p=>TEST.test(p));
 const manifests=new Map(),named=new Map(),unresolved=[],invokedScripts=new Map();
 for(const path of all.filter(p=>MANIFEST.test(p))){
  try{
   const data=JSON.parse(read(path));
   const item={path,dir:posix.dirname(path),scripts:data.scripts??{}};
   manifests.set(path,item);
   if(typeof data.name==="string")named.set(data.name,item);
  }catch{unresolved.push({source:path,reason:"unreadable-manifest"});}
 }
 const witnesses=Object.entries(SECURITY_WITNESSES).map(([name,paths])=>({
  name,required:paths,missing:paths.filter(p=>!present.has(p)),
  configuredDoesNotProveExecution:true
 }));
 const missing=witnesses.filter(x=>x.missing.length);
 if(strictWitnesses&&missing.length)throw Error("R404 missing security witnesses: "+
   missing.map(x=>x.name).join(","));
 const calls=new Map(testPaths.map(p=>[p,[]])),scriptReferences=[];
 const add=(target,ref)=>{
  if(!calls.has(target)){scriptReferences.push({path:target,...ref});return;}
  const a=calls.get(target);
  if(!a.some(x=>x.workflow===ref.workflow&&x.via===ref.via&&
   x.specifier===ref.specifier&&x.mode===ref.mode))a.push(ref);
 };
 const visit=(text,cwd,workflow,via,depth,seen)=>{
  if(depth>4){unresolved.push({source:via,reason:"script-recursion-limit"});return;}
  for(const command of lines(text)){
   const npm=npmInvocation(command);
   if(npm){
    const root=npm.prefix?posix.normalize(posix.join(cwd,npm.prefix)):cwd;
    let packageInfo=manifests.get(posix.join(root,"package.json"));
    if(npm.workspace){
     packageInfo=named.get(npm.workspace);
     if(!packageInfo)unresolved.push({source:via,reason:"unknown-workspace",value:npm.workspace});
    }
    const key=packageInfo?.path+":"+npm.script;
    if(packageInfo&&typeof packageInfo.scripts[npm.script]==="string"&&!seen.has(key)){
     if(!invokedScripts.has(key))invokedScripts.set(key,new Set());
     invokedScripts.get(key).add(workflow);
     const next=new Set(seen);next.add(key);
     visit(packageInfo.scripts[npm.script],packageInfo.dir,workflow,via+" => "+key,
      depth+1,next);
    }else if(npm.script==="test"||command.includes("npm run ")){
     unresolved.push({source:via,reason:"npm-dispatch-not-resolved",value:command.slice(0,200)});
    }
   }
   const checked=/\bnode\b/u.test(command)&&/(?:^|\s)--check(?:\s|$)/u.test(command);
   const test=/\bnode\b/u.test(command)&&/(?:^|\s)--test(?:\s|$)/u.test(command)&&!checked;
   const mode=test?
    /(?:^|\s)--test-name-pattern(?:\s|=)/u.test(command)?
      "test-configured-filtered":"test-configured":
    checked?"syntax-only":"other-configured-reference";
   const mentions=pathsInCommand(command,cwd,all);
   for(const mention of mentions){
    if(!mention.targets.length)
     unresolved.push({source:via,reason:"command-path-not-resolved",specifier:mention.spec});
    for(const target of mention.targets)
     add(target,{workflow,via,specifier:mention.spec,
      glob:mention.glob,mode,executed:false});
   }
   if(test&&!mentions.length)
    unresolved.push({source:via,reason:"unbounded-test-discovery",command:command.slice(0,180)});
  }
 };
 const reuse=[];
 for(const path of workflows){
  let content;
  try{content=read(path)}catch{unresolved.push({source:path,reason:"workflow-unreadable"});continue}
  for(const block of runs(content))
   visit(block.body,".",path,path+":"+block.line,0,new Set());
  for(const m of content.matchAll(/^\s*uses:\s+\.\/(\.github\/workflows\/[^\s@#]+\.ya?ml)/gmu)){
   reuse.push({from:path,to:m[1],present:present.has(m[1])});
   if(!present.has(m[1]))unresolved.push({source:path,reason:"missing-reusable-workflow",value:m[1]});
  }
 }
 const hashes=new Map(),unreadable=[];
 for(const path of testPaths){
  try{
   const digest=createHash("sha256").update(read(path)).digest("hex");
   if(!hashes.has(digest))hashes.set(digest,[]);
   hashes.get(digest).push(path);
  }catch{unreadable.push(path)}
 }
 const exactDuplicateGroups=[...hashes].filter(([,paths])=>paths.length>1)
  .map(([sha256,paths])=>({sha256,paths:ordered(paths),deletionAuthorized:false}));
 const records=testPaths.map(path=>{
  const observed=calls.get(path),run=observed.filter(x=>x.mode.startsWith("test-configured")),
   checks=observed.filter(x=>x.mode==="syntax-only"),others=observed.filter(x=>x.mode==="other-configured-reference");
  const kind=run.length?
   run.every(x=>x.mode==="test-configured-filtered")?
    "FILTERED_TEST_CONFIGURED":"TEST_CONFIGURED":
   checks.length?"SYNTAX_ONLY":
   others.length?"REFERENCED_NO_TEST_EVIDENCE":"NO_CONFIGURED_TEST_OBSERVED";
  return {path,kind,configuredTestCalls:run,syntaxChecks:checks,
   otherMentions:others,
   workflows:ordered(new Set(observed.map(x=>x.workflow))),
   securityWitness:witnesses.some(x=>x.required.includes(path)),
   deletionAuthorized:false,executionAttested:false};
 });
 const categories=Object.fromEntries(ordered(new Set(records.map(x=>x.kind)))
  .map(kind=>[kind,records.filter(x=>x.kind===kind).length]));
 return {
  schema:"r404-configured-test-coverage-v1",
  summary:{tracked:all.length,workflows:workflows.length,
   manifests:manifests.size,testFiles:testPaths.length,
   configuredTestFiles:records.filter(x=>x.configuredTestCalls.length).length,
   syntaxOnly:records.filter(x=>x.kind==="SYNTAX_ONLY").length,
   filteredOnly:records.filter(x=>x.kind==="FILTERED_TEST_CONFIGURED").length,
   withoutConfiguredTest:records.filter(x=>!x.configuredTestCalls.length).length,
   identicalBytesGroups:exactDuplicateGroups.length,
   scriptsExpanded:invokedScripts.size,reusableWorkflowReferences:reuse.length,
   unresolved:unresolved.length,unreadableTestFiles:unreadable.length,
   missingSecurityWitnessGroups:missing.map(x=>x.name),categories},
  methodology:"Lexical workflow run steps, npm workspace scripts, exact/glob file names and Node flags. Workflow configuration is not execution evidence. Unparsed shell branches, external scripts, matrix calls, other language test runners and indirect runtime reachability remain unresolved.",
  records,reusableWorkflows:reuse,packageScripts:[...invokedScripts].map(([name,workflows])=>({name,workflows:ordered(workflows)})),
  scriptReferences,unresolved,exactDuplicateGroups,unreadable,witnesses,
  verifiedBehavioralDuplication:false,actualCIRunsCorrelated:false,
  automaticDeletionAuthorized:false,paidInferenceExecuted:false
 };
}
export function inventoryR404(root=ROOT){
 return analyzeR404({tracked:gitTrackedFiles(root),
  read:path=>readFileSync(resolve(root,path),"utf8"),strictWitnesses:true});
}
function main(){
 const report=inventoryR404();
 const at=process.argv.indexOf("--out");
 if(at>=0){
  if(!process.argv[at+1])throw Error("R404 --out requires path");
  writeFileSync(resolve(process.argv[at+1]),JSON.stringify(report,null,2)+"\n");
 }
 console.log(JSON.stringify({event:"R404_TEST_COVERAGE",
  ...report.summary,automaticDeletionAuthorized:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main();
