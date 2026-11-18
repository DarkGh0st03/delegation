import assert from "node:assert/strict";
import test from "node:test";
import {TrustedPlanningDiscoveryLedger}
  from "../src/trusted-planning-discovery-ledger.ts";
import {preliminaryReadPermissions} from "../src/trusted-engineer-authority.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"sample-app"};
const rootUri="gitea://gitea.local/thesis/sample-app";
const MAIN_FILE="apps/backend/user.ts";

function snapshot(){
  return {
    session_id:"session-s1",repository:repo,base_revision:"a".repeat(40),
    directories:["","apps","apps/backend"],files:[MAIN_FILE]
  };
}
test("preliminary root lists only exact read-only operations on main and is bounded",()=>{
  const perms=preliminaryReadPermissions(snapshot());
  assert.deepEqual(perms.map(x=>x.operation),[
    "read_repository","list_directory","list_directory","list_directory","read_file"
  ]);
  assert.deepEqual(perms.map(x=>x.resource),[
    rootUri,
    rootUri+"/branches/main/directories",
    rootUri+"/branches/main/directories/apps",
    rootUri+"/branches/main/directories/apps/backend",
    rootUri+"/branches/main/files/"+MAIN_FILE
  ]);
  for(const attack of [
    {...snapshot(),files:["../../secret"]},
    {...snapshot(),files:["/etc/shadow"]},
    {...snapshot(),directories:["","apps//backend"]},
    {...snapshot(),directories:["",""]},
    {...snapshot(),directories:["apps"]},
    {...snapshot(),files:["apps/%2e%2e/secret"]},
    {...snapshot(),base_revision:"main"}
  ])assert.throws(()=>preliminaryReadPermissions(attack));
});

test("explicit hierarchical Planning Root is bounded and strictly read-only",()=>{
  const files=Array.from({length:160},(_,i)=>`src/group/item-${i}.ts`);
  const large={...snapshot(),directories:["","src","src/group"],files};
  assert.throws(()=>preliminaryReadPermissions(large),/oversized file list/u);
  const scoped={...large,hierarchical_preliminary_read:true};
  const main=preliminaryReadPermissions(scoped);
  const rootScope=rootUri+"/branches/main/directories";
  assert.deepEqual(main,[
    {resource:rootUri,operation:"read_repository"},
    {resource:rootScope,operation:"list_directory"},
    {resource:rootScope,operation:"read_file"}
  ]);
  const feature=preliminaryReadPermissions({
    ...scoped,planning_branch:"feature/planning-explicit"
  });
  const featureScope=rootUri+"/branches/feature%2Fplanning-explicit/directories";
  assert.deepEqual(feature,[
    {resource:featureScope,operation:"list_directory"},
    {resource:featureScope,operation:"read_file"}
  ]);
  assert.ok(!feature.some(p=>p.resource.includes("/branches/main/")));
  assert.ok([...main,...feature].every(p=>![
    "update_file","create_file","run_tests","create_branch","create_pull_request"
  ].includes(p.operation)));
  for(const invalid of [
    {...scoped,hierarchical_preliminary_read:"yes"},
    {...scoped,files:[...files,"../../private"]},
    {...scoped,directories:["","src","src//private"]},
    {...scoped,directories:["src"]},
    {...scoped,files:Array.from({length:4097},(_,i)=>`src/item-${i}.ts`)}
  ])assert.throws(()=>preliminaryReadPermissions(invalid as never));
});


test("only original trusted owner can select bounded dynamic discovery roots",()=>{
 const base={...snapshot(),hierarchical_preliminary_read:true};
 const valid={...base,dynamic_discovery_roots:["apps/backend"]};
 assert.deepEqual(preliminaryReadPermissions(valid),preliminaryReadPermissions(base),
   "new tool-visible discovery roots must never add signed Root permission rows");
 for(const invalid of [
  {...snapshot(),dynamic_discovery_roots:["apps/backend"]},
  {...base,dynamic_discovery_roots:["apps/secrets"]},
  {...base,dynamic_discovery_roots:["apps/backend","apps/backend"]},
  {...base,dynamic_discovery_roots:["../secret"]},
  {...base,dynamic_discovery_roots:["/apps/backend"]},
  {...base,dynamic_discovery_roots:["apps/%2E%2E"]},
  {...base,dynamic_discovery_roots:[]},
  {...base,dynamic_discovery_roots:["","","","","","","","",""]},
  {...base,dynamic_discovery_roots:"apps/backend"}
 ])assert.throws(()=>preliminaryReadPermissions(invalid as never),
   /Invalid trusted Planning dynamic discovery roots/u);
});

test("discovery ledger accepts only verified direct children and commits no partial listing",()=>{
 const ledger=new TrustedPlanningDiscoveryLedger({
  ...snapshot(),hierarchical_preliminary_read:true,
  dynamic_discovery_roots:["apps/backend"]
 });
 const file="apps/backend/feature.ts", nested="apps/backend/spec";
 assert.equal(ledger.hasFile(file),false);
 ledger.observeListings([{path:"apps/backend",entries:[
  {path:file,type:"file"},
  {path:nested,type:"dir"}
 ]}]);
 assert.equal(ledger.hasFile(file),true);
 assert.equal(ledger.hasDirectory(nested),true);
 ledger.observeListings([{path:nested,entries:[
  {path:nested+"/check.ts",type:"file"}
 ]}]);
 assert.equal(ledger.hasFile(nested+"/check.ts"),true);
 const previous=ledger.files();
 for(const forged of [
  [{path:"apps/backend/new.ts",type:"file"},
   {path:"apps/backend/../secrets.ts",type:"file"}],
  [{path:"apps/backend/new.ts",type:"file"},
   {path:"apps/backend/nested/deep.ts",type:"file"}],
  [{path:"apps/backend/new.ts",type:"file"},
   {path:"apps/backend/new.ts",type:"file"}],
  [{path:"apps/backend/new.ts",type:"file"},
   {path:"apps/backend/x",type:"symlink"}],
  [{path:"apps/backend/new.ts",type:"file"},
   {path:"apps/backend/%2E%2E",type:"dir"}]
 ])assert.throws(()=>ledger.observeListings([{path:"apps/backend",entries:forged}]));
 assert.deepEqual(ledger.files(),previous,
   "partial file discovery must not survive an invalid listing");
 // Source listing outside the independently selected subtree can be shown
 // to the model but cannot grow the trusted discovery catalog.
 ledger.observeListings([{path:"apps",entries:[
  {path:"apps/other",type:"dir"},{path:"apps/secret.ts",type:"file"}
 ]}]);
 assert.equal(ledger.hasDirectory("apps/other"),false);
 assert.equal(ledger.hasFile("apps/secret.ts"),false);
});
