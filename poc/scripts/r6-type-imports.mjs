/**
 * R6 conservative named type-import integrity checker.
 * Checks local "import type", inline named type imports, and type re-exports
 * in the Orchestrator src/test subtree without evaluating any application code.
 * This is NOT a full TypeScript compiler or a dead-code proof.
 */
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,statSync} from "node:fs";
import {dirname,relative,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

function maskTrivia(source){
  let result="",mode="code";
  for(let i=0;i<source.length;i++){
    const c=source[i],next=source[i+1],blank=x=>x==="\n"?"\n":" ";
    if(mode==="code"){
      if(c==="/"&&next==="/"){result+="  ";i++;mode="line";continue;}
      if(c==="/"&&next==="*"){result+="  ";i++;mode="block";continue;}
      if(c.charCodeAt(0)===96){result+=" ";mode="template";continue;}
      if(c==='"'||c==="'"){mode=c;result+=c;continue;}
      result+=c;continue;
    }
    if(mode==="line"){result+=blank(c);if(c==="\n")mode="code";continue;}
    if(mode==="block"){
      if(c==="*"&&next==="/"){result+="  ";i++;mode="code";continue;}
      result+=blank(c);continue;
    }
    if(mode==="template"){
      if(c==="\\"&&i+1<source.length){result+=blank(c)+blank(next);i++;continue;}
      result+=blank(c);if(c.charCodeAt(0)===96)mode="code";continue;
    }
    result+=c;
    if(c==="\\"&&i+1<source.length){result+=source[++i];continue;}
    if(c===mode)mode="code";
  }
  return result;
}
function parseItems(input,allType){
  return input.split(",").map(x=>x.trim()).filter(Boolean)
    .map(x=>({type:allType||/^type\s+/u.test(x),
      symbol:x.replace(/^type\s+/u,"").split(/\s+as\s+/u)[0].trim()}))
    .filter(x=>x.type&&/^[A-Za-z_$][\w$]*$/u.test(x.symbol));
}
function typeEdges(text){
  const source=maskTrivia(text),result=[];
  const explicit=/(?:^|[;\n])\s*(?:import|export)\s+type\s*\{([^{}]*)\}\s*from\s*(["'])(\.[^"']+)\2/gu;
  const inline=/(?:^|[;\n])\s*import\s*\{([^{}]*)\}\s*from\s*(["'])(\.[^"']+)\2/gu;
  for(const match of source.matchAll(explicit))
    for(const item of parseItems(match[1],true))
      result.push({specifier:match[3],symbol:item.symbol});
  for(const match of source.matchAll(inline))
    for(const item of parseItems(match[1],false))
      result.push({specifier:match[3],symbol:item.symbol});
  return result;
}
function isFile(path){return existsSync(path)&&statSync(path).isFile();}
function hasNamedExport(file,symbol,visited){
  const key=file+"\0"+symbol;
  if(visited.has(key)||!isFile(file))return false;
  visited.add(key);
  const text=maskTrivia(readFileSync(file,"utf8"));
  if(new RegExp("\\bexport\\s+(?:(?:declare|abstract|async)\\s+)*(?:interface|type|class|enum|function|const|let|var)\\s+"+symbol+"(?![\\w$])","u").test(text))return true;
  const named=/\bexport\s+(?:type\s+)?\{([^{}]*)\}(?:\s*from\s*(["'])(\.[^"']+)\2)?/gu;
  for(const row of text.matchAll(named)){
    for(const part of row[1].split(",")){
      const tokens=part.trim().replace(/^type\s+/u,"").split(/\s+as\s+/u);
      if((tokens[1]||tokens[0])!==symbol)continue;
      if(!row[3]||hasNamedExport(resolve(dirname(file),row[3]),tokens[0],new Set(visited)))
        return true;
    }
  }
  const stars=/\bexport\s+(?:type\s+)?\*\s+from\s*(["'])(\.[^"']+)\1/gu;
  for(const row of text.matchAll(stars))
    if(hasNamedExport(resolve(dirname(file),row[2]),symbol,new Set(visited)))
      return true;
  return false;
}
export function checkR6TypeImports(root,tracked){
  const base=resolve(root),errors=[];
  const selected=tracked.filter(p=>
    /^poc\/packages\/orchestrator-runtime\/(?:src|test)\/[^/]+\.ts$/u.test(p)
  ).sort();
  let checkedImports=0;
  for(const path of selected){
    const file=resolve(base,path);
    if(!isFile(file))continue;
    for(const edge of typeEdges(readFileSync(file,"utf8"))){
      checkedImports++;
      const target=resolve(dirname(file),edge.specifier);
      if(!isFile(target))errors.push({source:path,...edge,reason:"missing module"});
      else if(!hasNamedExport(target,edge.symbol,new Set()))
        errors.push({source:path,...edge,target:relative(base,target),
          reason:"missing named export"});
    }
  }
  return {checkedFiles:selected.length,checkedImports,errors};
}
function main(){
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const tracked=execFileSync("git",["ls-files","-z","--cached"],{
    cwd:root,encoding:"utf8"
  }).split("\0").filter(Boolean);
  const report=checkR6TypeImports(root,tracked);
  for(const item of report.errors)
    console.error("R6 TypeScript contract: "+item.source+" -> "+
      item.specifier+" :: "+item.symbol+" ("+item.reason+")");
  if(report.errors.length>0)process.exitCode=1;
  else console.log("R6 type-only contract audit: "+report.checkedFiles+
    " files / "+report.checkedImports+" named type imports verified");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main();
