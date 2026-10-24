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
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

export const R6_LEGACY_CANDIDATES=Object.freeze([
  "poc/packages/orchestrator-runtime/src/sequential-coordinator.ts",
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
const TEXT_SOURCE=/\.(?:js|mjs|cjs|ts|tsx|json|ya?ml|sh|toml|md|Dockerfile)$/u;
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
  const seen=new Map(candidates.map(path=>[path,[]]));
  const files=[...new Set(tracked)].sort();
  for(const source of files){
    if(ignored.has(source)||!TEXT_SOURCE.test(source))continue;
    const file=resolve(root,source);
    if(!existsSync(file))continue;
    const text=readFileSync(file,"utf8");
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
    methodology:"Literal path/basename observations, not an import graph or deletion proof",
    candidates:Object.freeze(candidates.map(target=>Object.freeze({
      target,
      exists:existsSync(resolve(root,target)),
      references:Object.freeze(seen.get(target))
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
      "runtime/build refs="+live.length,
      "docs refs="+(candidate.references.length-live.length)
    ].join(" | "));
  }
  if(result.candidates.some(x=>!x.exists))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main();
