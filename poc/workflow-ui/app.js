"use strict";
// Mock-only frontend: no network and no authority issuance.
(function(){
  const fixture=globalThis.DELEGATION_MOCK_PLAN;
  const $=(id)=>document.getElementById(id);
  const roles=["orchestrator","backend","frontend","test"];
  const operations=["read_repository","list_directory","read_file","create_file","update_file","delete_file","create_branch","create_pull_request","run_tests"];
  let plan, approval=null;
  function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function select(values,value,changed){const s=el("select");for(const v of values){const o=el("option","",v);o.value=v;s.append(o);}s.value=value;s.addEventListener("change",()=>{changed(s.value);dirty();});return s;}
  function dirty(){approval=null;$("download").disabled=true;$("status").textContent="Modifiche non ancora confermate.";$("status").className="status";stats();}
  function stats(){$("selected").textContent=String(plan.permissions.filter(p=>p.enabled).length);$("count").textContent=String(plan.permissions.length)+" permission";}
  function tasks(){const node=$("tasks");node.replaceChildren();for(const t of plan.tasks){const card=el("article","task");const head=el("div","task-head");head.append(el("h3","",t.title),el("span","role "+t.agent,t.agent.toUpperCase()));card.append(head,el("p","",t.description));if(t.depends_on.length)card.append(el("p","","Dipendenze: "+t.depends_on.join(", ")));node.append(card);}}
  function permissions(){const node=$("permissions");node.replaceChildren();for(const p of plan.permissions){const row=el("div","permission");const check=el("input");check.type="checkbox";check.checked=p.enabled;check.setAttribute("aria-label","Seleziona permission "+p.id);check.addEventListener("change",()=>{p.enabled=check.checked;dirty();});
    const role=select(roles,p.role,v=>p.role=v);role.setAttribute("aria-label","Soggetto");const op=select(operations,p.operation,v=>p.operation=v);op.setAttribute("aria-label","Operazione");
    const res=el("input");res.type="text";res.value=p.resource;res.setAttribute("aria-label","Risorsa");res.addEventListener("input",()=>{p.resource=res.value;dirty();});
    const del=el("button","","×");del.type="button";del.setAttribute("aria-label","Rimuovi "+p.id);del.addEventListener("click",()=>{plan.permissions=plan.permissions.filter(x=>x.id!==p.id);dirty();permissions();});
    row.append(check,role,op,res,del);node.append(row);}
    stats();}
  function reset(){plan=structuredClone(fixture);approval=null;$("repo").value=plan.repository;$("revision").value=plan.base_revision.slice(0,12);$("requirement").value=plan.requirement;$("agents").textContent=String(new Set(plan.tasks.map(t=>t.agent)).size);$("status").textContent="Piano dimostrativo pronto. Puoi modificare i permessi.";$("status").className="status";$("download").disabled=true;tasks();permissions();}
  function confirm(){
    const included=plan.permissions.filter(p=>p.enabled);
    if(!included.length){$("status").textContent="Seleziona almeno un permesso.";$("status").className="status error";return;}
    for(const p of included){if(!p.resource.trim()||p.resource.includes("../")||p.resource.includes("..\\")||p.resource.includes("...")||p.resource.startsWith("/")){$("status").textContent="Risorsa non valida: "+p.id;$("status").className="status error";return;}}
    approval={kind:"mock_authorization_review",simulated:true,schema_version:plan.schema_version,repository:plan.repository,base_revision:plan.base_revision,requirement:$("requirement").value,tasks:structuredClone(plan.tasks),approved_permissions:structuredClone(included),excluded_permissions:plan.permissions.filter(p=>!p.enabled).map(p=>p.id)};
    $("status").textContent="Selezione confermata localmente (MOCK). Nessuna DC emessa.";$("status").className="status";$("download").disabled=false;
  }
  function download(){if(!approval)return;const blob=new Blob([JSON.stringify(approval,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="delegation-approval-mock.json";document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);}
  $("reset").addEventListener("click",reset);$("approve").addEventListener("click",confirm);$("download").addEventListener("click",download);
  $("add").addEventListener("click",()=>{plan.permissions.push({id:"manual-"+Date.now(),role:"backend",operation:"read_file",resource:"",enabled:true});dirty();permissions();});
  $("requirement").addEventListener("input",dirty);
  if(!fixture)document.body.textContent="Piano dimostrativo non disponibile.";else reset();
})();