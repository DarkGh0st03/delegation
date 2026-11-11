/** Offline-only regression: the Engineer must see the entire proposed
 * work, dependencies and model uncertainties before signing.
 * Model-authored text is never parsed as HTML in the authenticated UI.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("authenticated Engineer review shows exact trusted plan details and uncertainty",async()=>{
  const [html,script]=await Promise.all([
    readFile(new URL("../../../workflow-ui/authenticated.html",import.meta.url),"utf8"),
    readFile(new URL("../../../workflow-ui/authenticated.js",import.meta.url),"utf8")
  ]);
  for(const id of ["requirement-view","digest","tasks","permissions",
    "assumptions","uncertainties","approve-button","reject-button"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing review UI field "+id);
  }
  assert.match(script,/task\.description/);
  assert.match(script,/input\.checked=false/);
  assert.match(script,/task\.depends_on/);
  assert.match(script,/plan\.assumptions/);
  assert.match(script,/plan\.uncertainties/);
  assert.match(script,/textContent\s*=/);
  assert.doesNotMatch(script,/\.(?:innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(script,/insertAdjacentHTML\s*\(/);
  assert.match(html,/rifiuta il piano e richiedi una nuova proposta/i);
  assert.match(script,/confirmation:\$\("confirmation"\)\.value/);
});

test("legacy authenticated review still renders Tasks and submits only the legacy digest",async()=>{
  const elements=new Map<string,any>(),requests:any[]=[];
  const element=()=>({hidden:false,value:"",children:[] as any[],listeners:{} as Record<string,any>,
    style:{},textContent:"",append(...items:any[]){this.children.push(...items);},
    replaceChildren(){this.children=[];},addEventListener(name:string,fn:any){this.listeners[name]=fn;}});
  const get=(id:string)=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const digest="b".repeat(64);
  const packet={protocol:"legacy-signed-dag",plan_digest:digest,csrf_token:"csrf",
    engineer_did:"did:thesis:engineer",reject_enabled:true,plan:{
      repository:{owner:"thesis",repository:"repo"},base_revision:"a".repeat(40),
      plan_id:"plan",version:1,requirement:"Suspend accounts",
      tasks:[{id:"task-1",agent_id:"backend",title:"Implement",description:"Exact task",depends_on:[]}],
      assumptions:["Existing authentication"],uncertainties:["Review policy"],
      requested_permissions:[{id:"permission-1",agent_id:"backend",operation:"update_file",resource:"gitea://scope",reason:"Implement"}]}};
  const script=await readFile(new URL("../../../workflow-ui/authenticated.js",import.meta.url),"utf8");
  runInNewContext(script,{document:{getElementById:get,createElement:element,
    querySelectorAll:()=>[{value:"permission-1"}]},fetch:async(path:string,options:any)=>{
      requests.push({path,options});return Response.json(path==="/api/review"?packet:{decision_id:"decision"});
    }});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(get("execution-plan-details").hidden,false);
  assert.equal(get("tasks").children[0].children[1].textContent,"Exact task");
  assert.equal(get("assumptions").children[0].children[0].textContent,"Existing authentication");
  assert.equal(get("uncertainties").children[0].children[0].textContent,"Review policy");
  assert.equal(get("permissions").children[0].children[0].checked,false);
  get("confirmation").value="APPROVE "+digest;
  await get("approve-button").listeners.click();
  const request=requests.find(row=>row.path==="/api/approve");
  assert.equal(request.options.headers["X-CSRF-Token"],"csrf");
  assert.deepEqual(JSON.parse(request.options.body),{
    plan_digest:digest,approved_permission_ids:["permission-1"],confirmation:"APPROVE "+digest});
});
