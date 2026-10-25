"use strict";
// Explicitly separated from the offline mock. Never holds signer keys or DCs.
(function(){
  const $=(id)=>document.getElementById(id);
  let plan=null,csrf=null,digest=null,lock=false;
  function status(msg,failed=false){
    $("status").textContent=msg;
    $("status").style.color=failed?"#a13232":"#1b665e";
  }
  function node(tag,value){
    const el=document.createElement(tag);
    if(value!==undefined)el.textContent=String(value);
    return el;
  }
  async function api(path,options={}){
    const response=await fetch(path,{
      cache:"no-store",credentials:"same-origin",
      ...options,headers:{"Content-Type":"application/json",...(options.headers||{})}
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Richiesta rifiutata");
    return data;
  }
  function display(data){
    plan=data.plan;digest=data.plan_digest;csrf=data.csrf_token;
    $("login").hidden=true;$("approval").hidden=false;
    $("rejection-actions").hidden=data.reject_enabled!==true;
    $("reject-confirmation").value="";
    $("identity").textContent=data.engineer_did;
    $("repository").textContent=
      plan.repository.owner+"/"+plan.repository.repository+" @ "+plan.base_revision;
    $("plan").textContent=plan.plan_id+" · v"+plan.version;
    $("requirement-view").textContent=plan.requirement;
    $("digest").textContent=digest;
    $("confirmation").value="";
    $("tasks").replaceChildren();$("permissions").replaceChildren();
    for(const task of plan.tasks){
      const p=node("p",task.id+" · "+task.agent_id+" · "+task.title);
      $("tasks").append(p);
    }
    for(const p of plan.requested_permissions){
      const label=node("label");
      const input=node("input");
      input.type="checkbox";input.checked=true;input.value=p.id;
      input.className="approval-permission";
      label.append(input,node("span"," "+p.id+" · "+p.agent_id+
        " · "+p.operation+" · "+p.resource+" ("+p.reason+")"));
      $("permissions").append(label);
    }
  }
  async function refresh(){
    try{display(await api("/api/plan"));}catch{
      $("approval").hidden=true;$("login").hidden=false;
    }
  }
  $("login-button").addEventListener("click",async()=>{
    if(lock)return;lock=true;
    try{
      await api("/api/login",{method:"POST",body:JSON.stringify({
        password:$("password").value
      })});
      $("password").value="";
      display(await api("/api/plan"));
      status("Autenticazione riuscita. Esamina e conferma il piano.");
    }catch(e){status(e.message,true);}
    finally{lock=false;}
  });
  $("approve-button").addEventListener("click",async()=>{
    if(lock||!plan)return;lock=true;
    try{
      const ids=[...document.querySelectorAll("input.approval-permission:checked")]
        .map(x=>x.value);
      const response=await api("/api/approve",{
        method:"POST",headers:{"X-CSRF-Token":csrf},
        body:JSON.stringify({
          plan_digest:digest,approved_permission_ids:ids,
          confirmation:$("confirmation").value
        })
      });
      $("approval").hidden=true;plan=null;csrf=null;digest=null;
      status("Ricevuta Ed25519 firmata: "+response.decision_id+
        ". Nessuna root DC emessa.");
    }catch(e){status(e.message,true);}
    finally{lock=false;}
  });
  $("reject-button").addEventListener("click",async()=>{
    if(lock||!plan)return;lock=true;
    try{
      const result=await api("/api/reject",{
        method:"POST",headers:{"X-CSRF-Token":csrf},
        body:JSON.stringify({
          plan_digest:digest,confirmation:$("reject-confirmation").value
        })
      });
      $("approval").hidden=true;plan=null;csrf=null;digest=null;
      status(result.provisional_credential_revoked?
        "Piano rifiutato. Credenziale preliminare revocata.":
        "Revoca non confermata: riconciliazione manuale obbligatoria.",
        !result.provisional_credential_revoked);
    }catch(e){status(e.message,true);}
    finally{lock=false;}
  });
  $("logout-button").addEventListener("click",async()=>{
    try{await api("/api/logout",{
      method:"POST",headers:{"X-CSRF-Token":csrf},body:"{}"
    });}catch(e){status(e.message,true);return;}
    csrf=null;plan=null;digest=null;$("approval").hidden=true;
    $("login").hidden=false;status("Sessione terminata.");
  });
  void refresh();
})();
