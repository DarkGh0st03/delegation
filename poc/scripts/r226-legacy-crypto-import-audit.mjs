/**
 * R226: fail-closed production import graph audit for retired crypto HTTP.
 * This is a lexical import/require/export-edge check on tracked code, NOT
 * proof that every dynamic runtime dependency has been removed. Keep any
 * remaining legacy compatibility dependencies visible until deletion.
 */
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const RETIRED=Object.freeze([
 "trusted-crypto-mcp-bridge.ts",
 "private-mcp-worker-http.ts",
 "mcp-shared/src/http-server.ts",
 "mcp-shared/src/crypto-worker-router.ts"
]);
const COMPAT=Object.freeze(new Set());

export function auditLegacyCryptoEntrypoints(root=ROOT){
 const tracked=execFileSync("git",["ls-files","--cached","-z"],{
  cwd:root,encoding:"utf8"
 }).split("\0").filter(Boolean);
 const code=tracked.filter(f=>f.startsWith("poc/")&&
  /\.(?:ts|mjs|js)$/u.test(f));
 const references=[];
 const forbidden=[];
 for(const file of code){
  const content=readFileSync(resolve(root,file),"utf8");
  // Include ESM import/export and CJS require. Match only module specifiers,
  // not comments or historical names in documentation/test assertions.
  const edges=[...content.matchAll(
   /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/gu
  )];
  for(const match of edges){
   const specifier=match[1];
   if(!RETIRED.some(target=>specifier.endsWith(target)))continue;
   const edge={source:file,specifier,line:content.slice(0,match.index).split("\n").length};
   references.push(edge);
   const testOnly=/\/test\/|\/tests\/|\/native-test\/|\/scripts\/test\//u.test(file);
   if(!COMPAT.has(file)&&!testOnly)
    forbidden.push(edge);
  }
 }
 const productionBarrel=readFileSync(resolve(root,
  "poc/packages/agent-runtime/src/index.ts"),"utf8");
 if(/export\s+\*\s+from\s+["']\.\/trusted-crypto-mcp-bridge\.ts/u.test(productionBarrel))
  forbidden.push({source:"poc/packages/agent-runtime/src/index.ts",
   specifier:"legacy_remote_crypto_export",line:1});
 const deprecatedPackage=JSON.parse(readFileSync(resolve(root,
  "poc/mcp-shared/package.json"),"utf8"));
 if(Object.hasOwn(deprecatedPackage.scripts??{},"start"))
  forbidden.push({source:"poc/mcp-shared/package.json",
   specifier:"retired_shared_mcp_executable",line:1});
 return Object.freeze({scanned_files:code.length,references,forbidden});
}
