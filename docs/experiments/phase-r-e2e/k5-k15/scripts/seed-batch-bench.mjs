// Creates the local Gitea benchmark repository thesis/batch-bench (Phase R E2E).
// Runs INSIDE the app container; reads admin credentials from /config, prints none.
import {readFileSync} from "node:fs";
const env=f=>Object.fromEntries(readFileSync(f,"utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
async function call(method,path,body,ok=[200]){
  const r=await fetch(BASE+path,{method,headers:{authorization:auth,"content-type":"application/json",accept:"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(!ok.includes(r.status))throw Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0,200)}`);
  const t=await r.text();return t?JSON.parse(t):undefined;
}
const mod=(area,name,i)=>`"use strict";\n// ${area} module: ${name}\nfunction ${name}(list) {\n  return list.map(x => ({...x, ${name}: ${i}}));\n}\nmodule.exports = {${name}};\n`;
const ledger=["entries","balance","journal","statements"];
const inventory=["stock","items","locations","suppliers","orders","returns","transfers","counts",
  "pricing","barcodes","alerts","reports","batches","audit"];
const files={
  "README.md":"# Batch bench\n\nSmall Node.js library used by the Phase R benchmark.\n",
  "package.json":JSON.stringify({name:"batch-bench",version:"1.0.0",private:true,
    scripts:{test:"node --test"},license:"MIT"},null,2)+"\n",
  "package-lock.json":JSON.stringify({name:"batch-bench",version:"1.0.0",lockfileVersion:3,requires:true,
    packages:{"":{name:"batch-bench",version:"1.0.0",license:"MIT"}}},null,2)+"\n"
};
ledger.forEach((n,i)=>files[`src/ledger/${n}.js`]=mod("Ledger",n,i));
inventory.forEach((n,i)=>files[`src/inventory/${n}.js`]=mod("Inventory",n,i));
const testOf=(area,dir,names)=>`"use strict";\nconst test = require("node:test");\nconst assert = require("node:assert/strict");\n`+
  names.map(n=>`const {${n}} = require("../src/${dir}/${n}.js");\n`).join("")+
  `\ntest("${area} modules tag every item", () => {\n`+
  names.map(n=>`  assert.equal(${n}([{id: 1}])[0].id, 1);\n`).join("")+"});\n";
files["test/ledger.test.js"]=testOf("Ledger","ledger",ledger);
files["test/inventory.test.js"]=testOf("Inventory","inventory",inventory);
if(process.argv[2]==="--write"){
  const {mkdirSync,writeFileSync}=await import("node:fs");const {dirname,join}=await import("node:path");
  for(const[k,v]of Object.entries(files)){mkdirSync(dirname(join(process.argv[3],k)),{recursive:true});writeFileSync(join(process.argv[3],k),v);}
  process.exit(0);}
const local=env("/config/local.env"), gitea=env("/config/gitea.env");
const BASE=(process.env.GITEA_URL??"http://gitea:3000")+"/api/v1", ORG=local.GITEA_ORG, NAME="batch-bench";
const auth="Basic "+Buffer.from(local.GITEA_ADMIN_USER+":"+local.GITEA_ADMIN_PASSWORD).toString("base64");

const exists=await fetch(`${BASE}/repos/${ORG}/${NAME}`,{headers:{authorization:auth}});
if(exists.status===200){
  if(process.argv[2]!=="--recreate"){console.log("exists");process.exit(0);}
  await call("DELETE",`/repos/${ORG}/${NAME}`,undefined,[204]);console.log("deleted old",NAME);
}
await call("POST",`/orgs/${ORG}/repos`,{name:NAME,private:true,auto_init:true,default_branch:"main",readme:"Default"},[201]);
await call("POST",`/repos/${ORG}/${NAME}/contents`,{branch:"main",message:"Batch bench",
  files:Object.entries(files).map(([path,c])=>({operation:path==="README.md"?"update":"create",path,
    content:Buffer.from(c).toString("base64"),
    ...(path==="README.md"?{}:{})}))},[201]).catch(async e=>{
  // README.md created by auto_init needs its sha for an update.
  if(!/sha/i.test(e.message))throw e;
  const readme=await call("GET",`/repos/${ORG}/${NAME}/contents/README.md?ref=main`);
  await call("POST",`/repos/${ORG}/${NAME}/contents`,{branch:"main",message:"Batch bench",
    files:Object.entries(files).map(([path,c])=>({operation:path==="README.md"?"update":"create",path,
      content:Buffer.from(c).toString("base64"),...(path==="README.md"?{sha:readme.sha}:{})}))},[201]);
});
await call("POST",`/repos/${ORG}/${NAME}/branch_protections`,{branch_name:"main",enable_push:false,
  enable_force_push:false,required_approvals:1,block_admin_merge_override:true,
  dismiss_stale_approvals:true,block_on_outdated_branch:true},[201]);
await call("PUT",`/repos/${ORG}/${NAME}/collaborators/${gitea.GITEA_GATEWAY_USER}`,{permission:"write"},[204]);
await call("PUT",`/repos/${ORG}/${NAME}/collaborators/${gitea.GITEA_RUNNER_USER}`,{permission:"read"},[204]);
console.log("created",ORG+"/"+NAME,Object.keys(files).length,"files");
