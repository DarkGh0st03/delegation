"use strict";
// Untrusted offline prototype: NO credential issuance and NO backend/network calls.
(function () {
  const fixture = globalThis.DELEGATION_MOCK_PLAN;
  const operations = globalThis.DELEGATION_MOCK_OPERATION_CHOICES;
  const model = globalThis.DELEGATION_REVIEW_MODEL;
  const $ = (id) => document.getElementById(id);
  if (!fixture || !model || !Array.isArray(operations)) {
    document.body.textContent = "Dati demo non disponibili.";
    return;
  }
  const agents = ["orchestrator",...fixture.candidate_agents.map((a)=>a.agent_id)];
  let state, renderedGeneration = 0;

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function select(options, chosen, onChange, ariaLabel) {
    const field = element("select");
    field.setAttribute("aria-label", ariaLabel);
    for (const item of options) {
      const option = element("option", "", item.label);
      option.value = item.value;
      field.append(option);
    }
    field.value = chosen;
    field.addEventListener("change", () => onChange(field.value));
    return field;
  }
  function label(text, field) {
    const node=element("label","field-label");
    node.append(element("span","",text),field);
    return node;
  }
  function textInput(value, description, onInput) {
    const input=element("input");
    input.type="text";
    input.value=value;
    input.setAttribute("aria-label",description);
    input.addEventListener("change",()=>onInput(input.value));
    return input;
  }
  function status(message, error = false) {
    $("status").textContent = message;
    $("status").className = error ? "status error" : "status";
  }
  function runChange(callback, { taskList = false, permissionList = false } = {}) {
    try {
      callback();
      refresh({ taskList, permissionList });
      status("Modifiche da verificare. La conferma precedente non è più valida.");
    } catch (error) {
      status(error.message || "Modifica non valida.",true);
    }
  }
  function renderTasks() {
    const node=$("tasks");
    node.replaceChildren();
    for (const task of state.plan.tasks) {
      const card=element("article","task");
      const heading=element("div","task-head");
      heading.append(element("h3","",task.title),element("span","role "+task.agent_id,task.agent_id.toUpperCase()));
      card.append(heading, element("p","",task.description));
      const assignment=select(agents.map((a)=>({value:a,label:a})),task.agent_id,
        (agentId)=>runChange(()=>model.setTaskAgent(state,task.id,agentId),
          {taskList:true,permissionList:true}),
        "Agente assegnato al Task "+task.id);
      card.append(label("Agente assegnato a "+task.id,assignment));
      if (task.depends_on.length) card.append(element("p","task-meta","Dipende da: "+task.depends_on.join(", ")));
      const resources=element("details","task-resources");
      resources.append(element("summary","","Risorse previste ("+task.resources.length+")"));
      for (const resource of task.resources) resources.append(element("code","uri",resource));
      card.append(resources);
      node.append(card);
    }
  }
  function renderPermissions() {
    const node=$("permissions");
    node.replaceChildren();
    const tasks=state.plan.tasks.map((t)=>({value:t.id,label:t.id+" ("+t.agent_id+")"}));
    for(const p of state.plan.requested_permissions) {
      const row=element("div","permission");
      const title=element("div","permission-head");
      const checked=element("input");
      checked.type="checkbox";
      checked.checked=state.included.has(p.id);
      checked.setAttribute("aria-label","Includi permission "+p.id);
      checked.addEventListener("change",()=>runChange(
        ()=>model.togglePermission(state,p.id,checked.checked)));
      title.append(checked,element("strong","",p.id),element("span","tag",p.agent_id));
      const remove=element("button","delete-permission","Rimuovi");
      remove.type="button";
      remove.setAttribute("aria-label","Rimuovi permission "+p.id);
      remove.addEventListener("click",()=>runChange(
        ()=>model.removePermission(state,p.id), {taskList:true,permissionList:true}));
      title.append(remove);
      row.append(title);
      const fields=element("div","permission-fields");
      fields.append(label("Task",select(tasks,p.task_id,
        (value)=>runChange(()=>model.editPermission(state,p.id,"task_id",value),
          {permissionList:true}),"Task per permission "+p.id)));
      fields.append(label("Operazione",select(
        operations.map((op)=>({value:op,label:op})),p.operation,
        (value)=>runChange(()=>model.editPermission(state,p.id,"operation",value)),
        "Operazione per permission "+p.id)));
      fields.append(label("Risorsa URI",textInput(p.resource,"Risorsa permission "+p.id,
        (value)=>runChange(()=>model.editPermission(state,p.id,"resource",value),{taskList:true}))));
      fields.append(label("Motivazione",textInput(p.reason,"Motivazione permission "+p.id,
        (value)=>runChange(()=>model.editPermission(state,p.id,"reason",value)))));
      row.append(fields);
      node.append(row);
    }
  }
  function renderDifferences() {
    const diff=model.differences(state);
    const node=$("changes"); node.replaceChildren();
    if (!diff.length) {
      node.append(element("p","hint","Nessuna modifica rispetto alla proposta iniziale."));
      return;
    }
    const list=element("ul","difference-list");
    for(const item of diff) list.append(element("li","",item));
    node.append(list);
  }
  async function refreshDigest(generation) {
    $("plan-digest").textContent="Calcolo SHA-256…";
    try {
      const d=await model.digest(state.plan,globalThis.crypto);
      if (generation === renderedGeneration) $("plan-digest").textContent=d;
    } catch (error) {
      if(generation===renderedGeneration) {
        $("plan-digest").textContent="Non disponibile";
        status(error.message,true);
      }
    }
  }
  function refresh({taskList=true,permissionList=true} = {}) {
    const generation=++renderedGeneration;
    $("repo").value=state.plan.repository.owner+"/"+state.plan.repository.repository;
    $("revision").value=state.plan.base_revision;
    $("requirement").value=state.plan.requirement;
    $("plan-id").textContent=state.plan.plan_id;
    $("session-id").textContent=state.plan.session_id;
    $("schema-version").textContent=state.plan.schema_version;
    $("plan-version").textContent=String(state.plan.version);
    $("agents").textContent=String(state.plan.candidate_agents.length);
    $("selected").textContent=String(state.included.size);
    $("count").textContent=state.plan.requested_permissions.length+" permission";
    $("download").disabled=!state.review;
    if(taskList) renderTasks();
    if(permissionList) renderPermissions();
    renderDifferences();
    void refreshDigest(generation);
  }
  function reset() {
    state=model.createState(fixture);
    refresh();
    status("Piano dimostrativo pronto. Puoi rivedere Task e permission.");
  }
  async function confirm() {
    const generation=renderedGeneration;
    $("approve").disabled=true;
    status("Validazione e digest della revisione mock in corso…");
    try {
      const reviewed=await model.makeMockReview(state,operations,globalThis.crypto);
      if (generation!==renderedGeneration) throw Error("Piano modificato; confermare nuovamente.");
      $("download").disabled=false;
      status("Selezione confermata localmente (MOCK): versione "+
        reviewed.plan.version+". Nessuna DC emessa.");
    } catch(error) {
      status(error.message||"Revisione non valida.",true);
      $("download").disabled=true;
    } finally {
      $("approve").disabled=false;
    }
  }
  function download() {
    if(!state.review) return;
    const blob=new Blob([JSON.stringify(state.review,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const link=element("a");
    link.href=url;
    link.download="delegation-plan-review-mock.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  $("reset").addEventListener("click",reset);
  $("approve").addEventListener("click",()=>{void confirm();});
  $("download").addEventListener("click",download);
  $("add").addEventListener("click",()=>runChange(
    ()=>model.addPermission(state),{permissionList:true,taskList:true}));
  $("requirement").addEventListener("change",()=>runChange(
    ()=>model.setRequirement(state,$("requirement").value)));
  reset();
})();
