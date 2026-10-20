import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const base=new URL("../",import.meta.url);
const read=(name)=>readFileSync(new URL(name,base),"utf8");
test("mock plan has reviewable tasks and permissions",()=>{
  const sandbox={};runInNewContext(read("mock-plan.js"),sandbox);
  const p=sandbox.DELEGATION_MOCK_PLAN;
  assert.equal(p.schema_version,"0.1-mock");
  assert.match(p.base_revision,/^[0-9a-f]{40}$/);
  assert.ok(p.tasks.length>=3);
  assert.ok(p.permissions.length>=5);
  assert.ok(p.permissions.every(x=>x.id&&x.role&&x.resource&&x.operation));
});
test("frontend explicitly distinguishes mock confirmation from real authority",()=>{
  const html=read("index.html"),js=read("app.js");
  assert.match(html,/DATI SIMULATI/);
  assert.match(html,/Nessuna credenziale viene emessa/);
  assert.match(html,/id="approve"/);
  assert.match(html,/id="download"/);
  assert.match(js,/approved_permissions/);
  assert.match(js,/simulated:true/);
  assert.doesNotMatch(js,/\bfetch\s*\(/);
});
test("standalone assets have no dependency on a build step",()=>{
  assert.match(read("styles.css"),/\.permission/);
  assert.match(read("index.html"),/mock-plan\.js/);
  assert.match(read("README.md"),/GitHub Actions/);
});