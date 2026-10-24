/**
 * R6 named runtime ESM imports of historic A2A and human merge entrypoints.
 * Static, read-only source inspection. Never import or execute these scripts.
 * Not a full JavaScript/TypeScript linker or proof of provider availability.
 */
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,statSync} from "node:fs";
import {dirname,relative,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

export const HISTORICAL_RUNTIME_ENTRYPOINTS=Object.freeze([
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-real-positive.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-pr-open-smoke.mjs",
  "poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-isolated-smoke.mjs",
  "poc/packages/orchestrator-runtime/scripts/human-merge.mjs"
]);

function isFile(p){return existsSync(p)&&statSync(p).isFile();}
function withoutComments(text){
  let out="",state="code",i=0;
  const blank=c=>c==="\n"?"\n":" ";
  while(i<text.length){
    const c=text[i],n=text[i+1];
    if(state==="code"){
      if(c==="/"&&n==="/"){out+="  ";i+=2;state="line";continue;}
      if(c==="/"&&n==="*"){out+="  ";i+=2;state="block";continue;}
      if(c===String.fromCharCode(96)){out+=" ";i++;state="template";continue;}
      if(c==="'"||c==='"'){out+=c;i++;state=c;continue;}
      out+=c;i++;continue;
    }
    if(state==="line"){out+=blank(c);i++;if(c==="\n")state="code";continue;}
    if(state==="block"){
      if(c==="*"&&n==="/"){out+="  ";i+=2;state="code";continue;}
      out+=blank(c);i++;continue;
    }
    if(state==="template"){
      if(c==="\\"&&n!==undefined){out+=blank(c)+blank(n);i+=2;continue;}
      out+=blank(c);i++;
      if(c===String.fromCharCode(96))state="code";
      continue;
    }
    out+=c;i++;
    if(c==="\\"&&n!==undefined){out+=n;i++;continue;}
    if(c===state)state="code";
  }
  return out;
}
function names(text){
  return text.split(",").map(x=>x.trim())
    .filter(x=>/^[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$/u.test(x))
    .map(x=>x.split(/\s+as\s+/u)[0]);
}
function importedRuntimeNames(source){
  const code=withoutComments(source),out=[];
  const regex=/(?:^|[;\n])\s*import\s*\{([^{}]*)\}\s*from\s*(["'])(\.[^"']+)\2/gu;
  for(const m of code.matchAll(regex))
    for(const symbol of names(m[1]))out.push({specifier:m[3],symbol});
  return out;
}
function hasValueExport(file,name,visited=new Set()){
  if(!isFile(file))return false;
  const key=file+"\0"+name;
  if(visited.has(key))return false;
  const seen=new Set(visited);seen.add(key);
  // The source may contain regex literals with quote/backtick characters.
  // Masking with an incomplete JS lexer can erase subsequent real exports.
  // Match declarations at statement starts in raw source instead; never
  // treat an unanchored string or prose mention as an exported value.
  const text=readFileSync(file,"utf8");
  const escaped=name.replace(/[$]/gu,"\\$&");
  const direct=new RegExp(
    "(?:^|[;\\n])\\s*export\\s+(?:(?:async|abstract)\\s+)*(?:class|function|const|let|var|enum)\\s+"+
    escaped+"(?![\\w$])","u");
  if(direct.test(text))return true;
  const named=/(?:^|[;\n])\s*export\s+(type\s+)?\{([^{}]*)\}(?:\s*from\s*(["'])([^"']+)\3)?/gu;
  for(const m of text.matchAll(named)){
    if(m[1])continue;
    for(const raw of m[2].split(",")){
      const term=raw.trim();
      if(/^type\s+/u.test(term))continue;
      const parts=term.split(/\s+as\s+/u),original=parts[0],exported=parts[1]||parts[0];
      if(exported!==name)continue;
      if(m[4]?.startsWith(".")){
        if(hasValueExport(resolve(dirname(file),m[4]),original,seen))
          return true;
      }else if(!m[4]){
        const local=new RegExp(
          "\\b(?:(?:async|abstract)\\s+)*(?:class|function|const|let|var|enum)\\s+"+
          original.replace(/[$]/gu,"\\$&")+"(?![\\w$])","u");
        if(local.test(text))return true;
      }
    }
  }
  const star=/(?:^|[;\n])\s*export\s+\*\s+from\s*(["'])(\.[^"']+)\1/gu;
  for(const m of text.matchAll(star))
    if(hasValueExport(resolve(dirname(file),m[2]),name,seen))
      return true;
  return false;
}
export function checkHistoricalRuntimeNamedImports(root,tracked,
  entrypoints=HISTORICAL_RUNTIME_ENTRYPOINTS){
  const base=resolve(root),trackedSet=new Set(tracked),errors=[];
  let checkedImports=0;
  for(const source of entrypoints){
    const file=resolve(base,source);
    if(!trackedSet.has(source)||!isFile(file)){
      errors.push({source,reason:"missing audited script"});continue;
    }
    for(const edge of importedRuntimeNames(readFileSync(file,"utf8"))){
      checkedImports++;
      const targetFile=resolve(dirname(file),edge.specifier);
      const target=relative(base,targetFile).split("\\").join("/");
      if(!trackedSet.has(target)||!isFile(targetFile))
        errors.push({source,...edge,target,reason:"missing local module"});
      else if(!hasValueExport(targetFile,edge.symbol))
        errors.push({source,...edge,target,reason:"missing runtime named export"});
    }
  }
  return {checkedFiles:entrypoints.length,checkedImports,errors};
}
function main(){
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const tracked=execFileSync("git",["ls-files","-z","--cached"],{
    cwd:root,encoding:"utf8"
  }).split("\0").filter(Boolean);
  const report=checkHistoricalRuntimeNamedImports(root,tracked);
  for(const issue of report.errors)
    console.error("R6 historical runtime ESM contract: "+issue.source+
      " -> "+(issue.specifier??"script")+" :: "+
      (issue.symbol??"-")+" ("+issue.reason+")");
  if(report.errors.length)process.exitCode=1;
  else console.log("R6 historical named runtime imports verified: "+
    report.checkedFiles+" entrypoints / "+report.checkedImports+" symbols");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main();
