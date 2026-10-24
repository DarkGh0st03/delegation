/**
 * R6 read-only reference inventory for historical workflow and coordinator
 * entrypoints. This is NOT a dead-code detector: the source graph is broader
 * than literal references, and "not observed" is never deletion approval.
 *
 * Sources: tracked files, workspace scripts, workflow YAML, JS/TS/MJS, shell,
 * compose and documentation. Classify observation type without executing any
 * candidate, importing a model or accessing paid APIs.
 */
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {dirname,relative,resolve} from "node:path";
import {SourceTextModule} from "node:vm";
import {fileURLToPath,pathToFileURL} from "node:url";

export const R6_LEGACY_CANDIDATES=Object.freeze([
  "poc/packages/orchestrator-runtime/src/sequential-coordinator.ts",
  "poc/packages/orchestrator-runtime/src/legacy-authority-client.ts",
  "poc/packages/orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts",
  "poc/packages/orchestrator-runtime/src/orchestrator-gateway-transport.ts",
  "poc/packages/orchestrator-runtime/src/permission-templates.ts",
  "poc/packages/orchestrator-runtime/src/account-suspension-preflight.ts",
  "poc/packages/orchestrator-runtime/src/workflow.ts",
  "poc/packages/orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-smoke.mjs",
  "poc/apps/test-runner-controller/fixtures/account-suspension-reference.mjs",
  "poc/workflow-ui/mock-plan.js",
  ".github/workflows/gemini-paid-shared-mcp-final.yml",
  ".github/workflows/shared-mcp-production-coordinator.yml",
  ".github/workflows/shared-mcp-real-positive-e2e.yml"
]);

/**
 * R6 CI boundary: only five explicit historical modules may statically
 * import the old Account Suspension coordinator. Canonical production
 * code must use the signed approved-DAG dispatcher instead.
 * Parsed ESM static edges only; dynamic/external callers still need audit.
 */
export const R6_ALLOWED_SEQUENTIAL_IMPORTERS=Object.freeze([
  "poc/packages/orchestrator-runtime/test/sequential-coordinator.test.ts",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-smoke.mjs"
]);
export function unexpectedSequentialImporters(inventory,allowed=R6_ALLOWED_SEQUENTIAL_IMPORTERS){
  const target="poc/packages/orchestrator-runtime/src/sequential-coordinator.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 historical coordinator missing from tracked audit targets");
  const allowedSet=new Set(allowed);
  return Object.freeze(entry.staticImporters.filter(x=>!allowedSet.has(x.source)));
}

/**
 * Bounded second edge class: detect explicit runtime module references and
 * direct configured commands to the retired sequential coordinator.
 * Only a KNOWN historical module may retain a literal dynamic reference;
 * configuration commands cannot directly launch this unapproved coordinator.
 *
 * Computed calls and external loaders remain unresolved and cannot be used
 * to infer deletion safety. See scanRuntimeIndirections().
 */
export function unexpectedSequentialRuntimeReferences(
  inventory,allowed=R6_ALLOWED_SEQUENTIAL_IMPORTERS
){
  const target="poc/packages/orchestrator-runtime/src/sequential-coordinator.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 historical coordinator missing from tracked audit targets");
  const allowedSet=new Set(allowed);
  return Object.freeze([
    ...entry.runtimeIndirectionHints
      .filter(x=>!allowedSet.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind})),
    ...entry.configuredCallers
      .filter(x=>!allowedSet.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind}))
  ]);
}


/**
 * Keep Phase 9B's fixed Account Suspension state machine solely in the
 * historical sequential coordinator and its own regression test.
 * Canonical approved-plan code must never import it via the public barrel.
 */
export const R6_ALLOWED_HISTORICAL_WORKFLOW_CALLERS=Object.freeze([
  "poc/packages/orchestrator-runtime/src/sequential-coordinator.ts",
  "poc/packages/orchestrator-runtime/test/workflow.test.ts"
]);
export function unexpectedHistoricalWorkflowCallers(
  inventory, allowed=R6_ALLOWED_HISTORICAL_WORKFLOW_CALLERS
){
  const target="poc/packages/orchestrator-runtime/src/workflow.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 historical workflow missing from audit targets");
  const accepted=new Set(allowed);
  return Object.freeze([
    ...entry.staticImporters.filter(x=>!accepted.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:"static-import-or-reexport"})),
    ...entry.runtimeIndirectionHints.filter(x=>!accepted.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind})),
    ...entry.configuredCallers.filter(x=>!accepted.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind}))
  ]);
}


/**
 * A historical static-template child issuer is intentionally an explicit,
 * opt-in import. No approved-Plan runtime may import its wrapper.
 * Legacy classes are physically isolated in legacy-authority-client.ts;
 * neither is exported through the canonical runtime index.
 */
export const R6_ALLOWED_HISTORICAL_AUTHORITY_IMPORTERS=Object.freeze([
  "poc/packages/orchestrator-runtime/test/authority-client.test.ts",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-smoke.mjs",
]);
export function unexpectedHistoricalAuthorityCallers(
  inventory,allowed=R6_ALLOWED_HISTORICAL_AUTHORITY_IMPORTERS
){
  const entry=inventory.candidates.find(x=>x.target==="poc/packages/orchestrator-runtime/src/legacy-authority-client.ts");
  if(!entry)throw new Error("R6 historical authority wrapper missing from audit");
  const accepted=new Set(allowed);
  return Object.freeze([
    ...entry.staticImporters.filter(x=>!accepted.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:"static-import-or-reexport"})),
    ...entry.runtimeIndirectionHints.filter(x=>!accepted.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind})),
    ...entry.configuredCallers.filter(x=>!accepted.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind}))
  ]);
}


/**
 * Do not silently reintroduce the IAM Console role/skill permission matrix
 * into signed Planning/Execution or its public credential interface.
 * Other historical callers remain in the inventory; this is a carefully
 * scoped canonical-code boundary, not a dead-code or dependency-free claim.
 */
export function unexpectedTrustedTemplateCallers(inventory){
  const target="poc/packages/orchestrator-runtime/src/permission-templates.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 frozen permission-template candidate missing");
  const prefix="poc/packages/orchestrator-runtime/src/";
  const protectedNames=new Set([
    prefix+"index.ts",
    prefix+"authority-client.ts",
    prefix+"authority-adapter-transport.ts"
  ]);
  const protectedSource=source=>
    protectedNames.has(source)||
    (source.startsWith(prefix+"trusted-")&&source.endsWith(".ts"));
  return Object.freeze([
    ...entry.staticImporters.filter(e=>protectedSource(e.source))
      .map(e=>Object.freeze({...e,edgeType:"static-import-or-reexport"})),
    ...entry.runtimeIndirectionHints.filter(e=>protectedSource(e.source))
      .map(e=>Object.freeze({...e,edgeType:e.kind})),
    ...entry.configuredCallers.filter(e=>protectedSource(e.source))
      .map(e=>Object.freeze({...e,edgeType:e.kind}))
  ]);
}


/**
 * Explicitly historical branch/PR convenience client. The trusted Planning
 * port still imports the underlying read transport directly while it is
 * shared with legacy code; never permit a signed canonical caller to
 * import the legacy opt-in gateway wrapper.
 */
export const R6_ALLOWED_HISTORICAL_GATEWAY_IMPORTERS=Object.freeze([
  "poc/packages/orchestrator-runtime/test/orchestrator-gateway-client.test.ts",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-smoke.mjs",
  "poc/packages/agent-runtime/scripts/assert-current-authority-boundaries.mjs"
]);
export function unexpectedHistoricalGatewayCallers(
  inventory,allowed=R6_ALLOWED_HISTORICAL_GATEWAY_IMPORTERS
){
  const target="poc/packages/orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 historical Gateway wrapper missing from inventory");
  const approved=new Set(allowed);
  return Object.freeze([
    ...entry.staticImporters.filter(x=>!approved.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:"static-import-or-reexport"})),
    ...entry.runtimeIndirectionHints.filter(x=>!approved.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind})),
    ...entry.configuredCallers.filter(x=>!approved.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind}))
  ]);
}


/**
 * R6 SECURITY-SENSITIVE INVENTORY TARGET (not obsolete/deletion candidate).
 * The internal Gateway transport can request arbitrary tools and holds a
 * private Adapter bearer. Only two deliberately reviewed clients may import
 * it: the read-only Planning wrapper and the historical write wrapper.
 * This static safety net does NOT replace Gateway/Core Rust/OPA enforcement.
 */
export const R6_ALLOWED_PRIVATE_GATEWAY_TRANSPORT_CALLERS=Object.freeze([
  "poc/packages/orchestrator-runtime/src/orchestrator-gateway-client.ts",
  "poc/packages/orchestrator-runtime/src/legacy-orchestrator-gateway-client.ts"
]);
export function unexpectedPrivateGatewayTransportCallers(
  inventory,allowed=R6_ALLOWED_PRIVATE_GATEWAY_TRANSPORT_CALLERS
){
  const target="poc/packages/orchestrator-runtime/src/orchestrator-gateway-transport.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 private Gateway transport is missing from inventory");
  const approved=new Set(allowed);
  return Object.freeze([
    ...entry.staticImporters.filter(x=>!approved.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:"static-import-or-reexport"})),
    ...entry.runtimeIndirectionHints.filter(x=>!approved.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind})),
    ...entry.configuredCallers.filter(x=>!approved.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind}))
  ]);
}


/**
 * Historical, non-generalizable IAM lifecycle preflight is a regression-only
 * check. It must never become an approved-plan or generic agent policy gate.
 * Only the manually billed Account Suspension experiment and its regression
 * may import/load it. The file is retained, not a deletion candidate.
 */
export const R6_ALLOWED_ACCOUNT_SUSPENSION_PREFLIGHT_CALLERS=Object.freeze([
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",
  "poc/packages/orchestrator-runtime/test/account-suspension-preflight.test.ts"
]);
export function unexpectedHistoricalPreflightCallers(
  inventory,allowed=R6_ALLOWED_ACCOUNT_SUSPENSION_PREFLIGHT_CALLERS
){
  const target="poc/packages/orchestrator-runtime/src/account-suspension-preflight.ts";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 historical Account Suspension preflight missing from inventory");
  const accepted=new Set(allowed);
  return Object.freeze([
    ...entry.staticImporters.filter(e=>!accepted.has(e.source))
      .map(e=>Object.freeze({...e,edgeType:"static-import-or-reexport"})),
    ...entry.runtimeIndirectionHints.filter(e=>!accepted.has(e.source))
      .map(e=>Object.freeze({...e,edgeType:e.kind})),
    ...entry.configuredCallers.filter(e=>!accepted.has(e.source))
      .map(e=>Object.freeze({...e,edgeType:e.kind}))
  ]);
}


/**
 * Historical Account Suspension 11-file role/DC-scope contract CHECK.
 * Keep its exact four configured workflow callers, but do not introduce
 * new imports of a side-effect-only checker into signed ADK/DAG source.
 * An invocation checks fixed IAM fixtures; it does not authorize a tool.
 */
export const R6_ALLOWED_REFERENCE_SCOPE_WORKFLOWS=Object.freeze([
  ".github/workflows/cumulative-refactoring-offline.yml",
  ".github/workflows/shared-mcp-production-coordinator.yml",
  ".github/workflows/shared-mcp-real-positive-e2e.yml",
  ".github/workflows/gemini-paid-shared-mcp-final.yml",
  ".github/workflows/disposable-simulated-approval-merge.yml",
  ".github/workflows/poc-baseline.yml"
]);
export function unexpectedHistoricalReferenceScopeCallers(
  inventory,allowed=R6_ALLOWED_REFERENCE_SCOPE_WORKFLOWS
){
  const target="poc/packages/orchestrator-runtime/scripts/check-account-suspension-reference-scope.mjs";
  const entry=inventory.candidates.find(x=>x.target===target);
  if(!entry)throw Error("R6 Account Suspension reference scope checker missing from inventory");
  const accepted=new Set(allowed);
  return Object.freeze([
    ...entry.staticImporters
      .map(x=>Object.freeze({...x,edgeType:"static-import-or-reexport"})),
    ...entry.runtimeIndirectionHints
      .map(x=>Object.freeze({...x,edgeType:x.kind})),
    ...entry.configuredCallers.filter(x=>!accepted.has(x.source))
      .map(x=>Object.freeze({...x,edgeType:x.kind}))
  ]);
}

const TEXT_SOURCE=/\.(?:js|mjs|cjs|ts|tsx|json|ya?ml|sh|toml|md|Dockerfile)$/u;

/** A configured command mention is not automatically executed by a job. */
function configuredMatch(command,target){
  const leaf=target.split("/").at(-1);
  return command.includes(target)||command.includes(leaf);
}
function workflowCommands(contents){
  const lines=contents.split("\n");
  const collected=[];
  for(let i=0;i<lines.length;i++){
    const match=/^(\s*)(?:-\s*)?run:\s*(.*)$/u.exec(lines[i]);
    if(!match)continue;
    const indent=match[1].length;
    const command=[match[2]];
    if(/^(?:\||>)(?:[+-])?\s*$/u.test(match[2])){
      command.length=0;
      for(let j=i+1;j<lines.length;j++){
        const line=lines[j];
        if(line.trim()===""){command.push("");continue;}
        const space=/^\s*/u.exec(line)[0].length;
        if(space<=indent){i=j-1;break;}
        if(!line.trimStart().startsWith("#"))
          command.push(line.trim());
        if(j===lines.length-1)i=j;
      }
    }
    collected.push(command.join("\n"));
  }
  return collected;
}
/**
 * Record configured script/command references and one-hop npm workflow ->
 * workspace script chains. Never execute YAML, shell, package scripts, or
 * run the referenced files. Do NOT treat an absent match as dead-code proof.
 */
export function collectConfiguredEntrypoints(root,tracked,options={}){
  const candidates=options.candidates??R6_LEGACY_CANDIDATES;
  const result=new Map(candidates.map(x=>[x,[]]));
  const files=[...new Set(tracked)].sort();
  const scripts=[];
  for(const path of files.filter(p=>p.endsWith("package.json"))){
    const abs=resolve(root,path);
    if(!existsSync(abs))continue;
    const manifest=JSON.parse(readFileSync(abs,"utf8"));
    for(const [name,command] of Object.entries(manifest.scripts??{})){
      if(typeof command!=="string")continue;
      scripts.push({path,name,command,packageName:manifest.name??""});
      for(const target of candidates)if(configuredMatch(command,target))
        result.get(target).push(Object.freeze({
          source:path,kind:"npm-script",entrypoint:name
        }));
    }
  }
  for(const path of files){
    if(!/^(?:\.github\/workflows\/.*\.ya?ml|.*\.sh|.*docker-compose\.ya?ml)$/u.test(path))
      continue;
    const abs=resolve(root,path);
    if(!existsSync(abs))continue;
    const text=readFileSync(abs,"utf8");
    const commands=path.startsWith(".github/workflows/")
      ?workflowCommands(text)
      :text.split("\n").filter(x=>!x.trimStart().startsWith("#")).join("\n");
    for(const command of (Array.isArray(commands)?commands:[commands])){
      for(const target of candidates){
        if(configuredMatch(command,target))
          result.get(target).push(Object.freeze({
            source:path,
            kind:path.startsWith(".github/workflows/")?"github-actions-command":
              path.endsWith(".sh")?"shell-script-command":"compose-config",
            entrypoint:target.split("/").at(-1)
          }));
      }
      if(!path.startsWith(".github/workflows/"))continue;
      // Resolve explicit npm run steps to workspace scripts, preserving
      // the -w workspace selector. Unscoped workspaces are ambiguous and
      // intentionally omitted, NOT classified as unreferenced.
      const pattern=/\bnpm\s+(?:--prefix\s+\S+\s+)?run\s+([\w:.-]+)(?:\s+-w\s+([^\s;|&]+))?/gu;
      for(const call of command.matchAll(pattern)){
        const scriptName=call[1],workspace=call[2];
        const qualified=scripts.filter(x=>x.name===scriptName&&
          (workspace?workspace===x.packageName:
           x.path==="poc/package.json"));
        for(const script of qualified)for(const target of candidates){
          if(!configuredMatch(script.command,target))continue;
          result.get(target).push(Object.freeze({
            source:path,kind:"github-actions-via-npm-script",
            entrypoint:(script.packageName||script.path)+":"+script.name
          }));
        }
      }
    }
  }
  return Object.freeze(candidates.map(target=>Object.freeze({
    target,configuredCallers:Object.freeze(result.get(target))
  })));
}


/** Conservative lexical hints; these are NOT verified execution edges. */
export function scanRuntimeIndirections(text){
  const tokens=[];let i=0;
  const identifier=c=>/[A-Za-z_$]/u.test(c??"");
  const identifierTail=c=>/[A-Za-z0-9_$]/u.test(c??"");
  while(i<text.length){
    const c=text[i],next=text[i+1];
    if(/\s/u.test(c)){i++;continue;}
    if(c==="/"&&next==="/"){
      i+=2;while(i<text.length&&text[i]!=="\n")i++;continue;
    }
    if(c==="/"&&next==="*"){
      i+=2;while(i<text.length&&(text[i]!=="*"||text[i+1]!=="/"))i++;
      i=Math.min(i+2,text.length);continue;
    }
    if(c==="/"&&next!=="/"&&next!=="*"){
      const prev=tokens.at(-1);
      if(!prev||["=","(","[",":",",",";","return","=>"].includes(prev.value)){
        let j=i+1,escaped=false,inClass=false;
        while(j<text.length&&text[j]!=="\n"){
          const k=text[j];
          if(escaped){escaped=false;j++;continue;}
          if(k==="\\"){escaped=true;j++;continue;}
          if(k==="["){inClass=true;j++;continue;}
          if(k==="]"){inClass=false;j++;continue;}
          if(k==="/"&&!inClass)break;
          j++;
        }
        if(j<text.length&&text[j]==="/"){
          i=j+1;while(/[a-z]/iu.test(text[i]??""))i++;
          tokens.push({kind:"regex",value:"<regex>"});continue;
        }
      }
    }
    if(c==="'"||c==='"'||c.charCodeAt(0)===96){
      const quote=c;let value="",escaped=false,computed=false;
      i++;
      while(i<text.length){
        const k=text[i++];
        if(k==="\\"){escaped=true;if(i<text.length)value+=text[i++];continue;}
        if(k===quote)break;
        if(quote.charCodeAt(0)===96&&k==="$"&&text[i]==="{")
          computed=true;
        value+=k;
      }
      tokens.push({kind:computed?"computed":escaped?"escaped":"literal",value});
      continue;
    }
    if(identifier(c)){
      const start=i++;while(i<text.length&&identifierTail(text[i]))i++;
      tokens.push({kind:"id",value:text.slice(start,i)});continue;
    }
    tokens.push({kind:"punct",value:c});i++;
  }
  const hints=[],unresolved=[];
  for(let j=0;j<tokens.length;j++){
    const a=tokens[j],b=tokens[j+1],value=tokens[j+2],end=tokens[j+3];
    if((a.value==="import"||a.value==="require")&&b?.value==="("){
      const kind=a.value==="import"?"dynamic-import":"commonjs-require";
      if(value?.kind==="literal"&&[")",","].includes(end?.value))
        hints.push({kind,specifier:value.value});
      else unresolved.push({kind:"computed-"+kind});
    }
    if(a.value==="new"&&b?.value==="URL"&&value?.value==="("){
      const arg=tokens[j+3];
      if(arg?.kind==="literal"&&tokens[j+4]?.value===","&&
        tokens[j+5]?.value==="import"&&tokens[j+6]?.value==="."&&
        tokens[j+7]?.value==="meta"&&tokens[j+8]?.value==="."&&
        tokens[j+9]?.value==="url")
        hints.push({kind:"module-url",specifier:arg.value});
      else unresolved.push({kind:"unresolved-new-url"});
    }
  }
  return {hints,unresolved};
}

function type(path){
  if(path.startsWith(".github/workflows/"))return "workflow";
  if(path.endsWith("package.json"))return "package-script-or-config";
  if(/\.(?:js|mjs|cjs|ts|tsx)$/u.test(path))return "runtime-or-test-source";
  if(/\.(?:sh|Dockerfile|ya?ml|toml)$/u.test(path))
    return "deployment-or-build";
  if(path.endsWith(".md"))return "documentation-only";
  return "other-data";
}
/** Does not evaluate/resolve imports. No match is NOT evidence of dead code. */
export function collectLegacyReferences(root,tracked,options={}){
  const candidates=options.candidates??R6_LEGACY_CANDIDATES;
  const ignored=new Set([
    "poc/scripts/r6-legacy-references.mjs",
    "poc/scripts/test/check-local-imports.test.mjs"
  ]);
  const configured=new Map(collectConfiguredEntrypoints(root,tracked,{candidates})
    .map(x=>[x.target,x.configuredCallers]));
  const seen=new Map(candidates.map(path=>[path,[]]));
  const staticImporters=new Map(candidates.map(path=>[path,[]]));
  const runtimeIndirectionHints=new Map(candidates.map(path=>[path,[]]));
  const unresolvedRuntimeIndirections=[];
  const candidatesByAbsolutePath=new Map(candidates.map(path=>[
    resolve(root,path),path
  ]));
  const files=[...new Set(tracked)].sort();
  for(const source of files){
    if(ignored.has(source)||!TEXT_SOURCE.test(source))continue;
    const file=resolve(root,source);
    if(!existsSync(file))continue;
    const text=readFileSync(file,"utf8");
    if(/\.(?:ts|tsx|mjs|cjs|js)$/u.test(source)){
      // Reuse the same Node ESM parser strategy as check-local-imports.
      // Only static runtime import/export edges are proven. Literal
      // import(), require(), package aliases, codegen, CLI and Docker
      // callers remain separately unverified.
      let module;
      try{
        module=new SourceTextModule(
          /\.(?:ts|tsx)$/u.test(source)?stripTypeScriptTypes(text):text,
          {identifier:file}
        );
      }catch(error){
        throw Error("R6 cannot parse tracked source "+source,
          {cause:error});
      }
      const scanned=scanRuntimeIndirections(
        /\.(?:ts|tsx)$/u.test(source)?stripTypeScriptTypes(text):text);
      for(const hint of scanned.hints){
        if(!hint.specifier.startsWith("./")&&!hint.specifier.startsWith("../"))
          continue;
        const target=candidatesByAbsolutePath.get(
          resolve(dirname(file),hint.specifier));
        if(target&&target!==source)runtimeIndirectionHints.get(target).push(
          Object.freeze({source,kind:hint.kind,specifier:hint.specifier}));
      }
      for(const hint of scanned.unresolved)
        unresolvedRuntimeIndirections.push(Object.freeze({
          source,kind:hint.kind
        }));
      for(const specifier of module.dependencySpecifiers){
        if(!specifier.startsWith("./")&&!specifier.startsWith("../"))
          continue;
        const target=candidatesByAbsolutePath.get(
          resolve(dirname(file),specifier)
        );
        if(target&&target!==source){
          staticImporters.get(target).push(Object.freeze({
            source,specifier,referenceType:type(source)
          }));
        }
      }
    }
    for(const target of candidates){
      if(source===target)continue; // a file is not its own importer
      const leaf=target.split("/").at(-1);
      if(text.includes(target)||text.includes(leaf))
        seen.get(target).push(Object.freeze({
          source,referenceType:type(source)
        }));
    }
  }
  return Object.freeze({
    methodology:"Literal reference observations are not an import graph or deletion proof; staticImporters are independently parsed runtime ESM edges, not a complete dependency graph",
    unresolvedRuntimeIndirections:Object.freeze(unresolvedRuntimeIndirections),
    candidates:Object.freeze(candidates.map(target=>Object.freeze({
      target,
      exists:existsSync(resolve(root,target)),
      references:Object.freeze(seen.get(target)),
      staticImporters:Object.freeze(staticImporters.get(target)),
      runtimeIndirectionHints:Object.freeze(runtimeIndirectionHints.get(target)),
      configuredCallers:configured.get(target)
    })))
  });
}
export function gitTrackedFiles(root){
  return execFileSync("git",["ls-files","-z","--cached"],{
    cwd:root,encoding:"utf8",maxBuffer:4*1024*1024
  }).split("\0").filter(Boolean);
}
function main(){
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const result=collectLegacyReferences(root,gitTrackedFiles(root));
  if(process.argv.includes("--json")){
    console.log(JSON.stringify(result,null,2));
    return;
  }
  console.log("R6 literal reference inventory (NOT a dead-code test)");
  for(const candidate of result.candidates){
    const live=candidate.references.filter(r=>r.referenceType!=="documentation-only");
    console.log([
      candidate.exists?"PRESENT":"MISSING",
      candidate.target,
      "runtime/build text refs="+live.length,
      "docs text refs="+(candidate.references.length-live.length),
      "proven static importers="+candidate.staticImporters.length,
      "configured commands="+candidate.configuredCallers.length,
      "runtime indirection hints="+candidate.runtimeIndirectionHints.length
    ].join(" | "));
  }
  console.log("Unresolved runtime indirections="+
    result.unresolvedRuntimeIndirections.length);
  const forbidden=unexpectedSequentialImporters(result);
  for(const edge of forbidden)
    console.error("R6 blocked legacy coordinator import: "+edge.source+
      " -> "+edge.specifier+"; migrate to signed approved DAG");
  const indirect=unexpectedSequentialRuntimeReferences(result);
  for(const edge of indirect)
    console.error("R6 blocked legacy coordinator "+edge.edgeType+
      " caller: "+edge.source+"; migrate to signed approved DAG");
  const historicalWorkflowCallers=unexpectedHistoricalWorkflowCallers(result);
  for(const edge of historicalWorkflowCallers)
    console.error("R6 blocked historical workflow "+edge.edgeType+
      " caller: "+edge.source+"; use approved-plan DAG");
  const authorityCallers=unexpectedHistoricalAuthorityCallers(result);
  for(const edge of authorityCallers)
    console.error("R6 blocked legacy static authority "+
      edge.edgeType+" caller: "+edge.source);
  const templateCallers=unexpectedTrustedTemplateCallers(result);
  for(const edge of templateCallers)
    console.error("R6 blocked frozen IAM template "+edge.edgeType+
      " dependency in canonical trusted code: "+edge.source);
  const gatewayCallers=unexpectedHistoricalGatewayCallers(result);
  for(const edge of gatewayCallers)
    console.error("R6 blocked legacy branch/PR Gateway "+
      edge.edgeType+" caller: "+edge.source);
  const privateTransportCallers=unexpectedPrivateGatewayTransportCallers(result);
  for(const edge of privateTransportCallers)
    console.error("R6 blocked private Gateway transport "+
      edge.edgeType+" caller: "+edge.source+
      "; keep private VP/Adapter access out of new modules");
  const historicalPreflightCallers=unexpectedHistoricalPreflightCallers(result);
  for(const edge of historicalPreflightCallers)
    console.error("R6 blocked Account Suspension-only preflight "+
      edge.edgeType+" caller: "+edge.source+
      "; the approved-plan path requires generic plan-bound validation");
  const scopeCheckerCallers=unexpectedHistoricalReferenceScopeCallers(result);
  for(const edge of scopeCheckerCallers)
    console.error("R6 blocked historical 11-file scope checker "+
      edge.edgeType+" caller: "+edge.source+
      "; scope checker is a fixed IAM fixture, not signed-plan validation");
  if(forbidden.length>0||indirect.length>0||
     historicalWorkflowCallers.length>0||authorityCallers.length>0||
     templateCallers.length>0||gatewayCallers.length>0||
     privateTransportCallers.length>0||historicalPreflightCallers.length>0||
     scopeCheckerCallers.length>0||
     result.candidates.some(x=>!x.exists))
    process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main();
