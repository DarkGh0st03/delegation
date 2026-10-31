/**
 * Test-only, fixed tool-call schedule through real Google ADK LlmAgent/Runner.
 * Never contacts Gemini; the real Gateway checks each operation independently.
 * The generated calls are fixtures, not evidence of autonomous code design.
 */
import {BaseLlm} from "@google/adk";

const TYPECHECK_FAULT='\nconst __delegation_typecheck_probe: "ACTIVE" | "SUSPENDED" = "SUSPEND";\n';
const SHA=/^[a-f0-9]{40}$/u;
function trustedToolEffect(request,tool,branch,path){
 const responses=(request?.contents??[]).flatMap(c=>c.parts??[])
  .filter(p=>p.functionResponse?.name===tool)
  .map(p=>p.functionResponse.response);
 const wrapper=responses.at(-1);
 const output=wrapper?.structuredContent??wrapper?.result?.structuredContent??wrapper;
 const effect=output?.result;
 if(output?.ok!==true||effect?.provider!=="gitea"||
    effect.performed!==true||effect.tool!==tool||
    effect.branch!==branch||effect.path!==path)
  throw Error("Offline D1 missing independently confirmed Gitea effect");
 return effect;
}

export class OfflineApprovedAdkModel extends BaseLlm{
  #calls;
  #turn=0;
  #callIndex=0;
  #groupIndex=0;
  #withinGroup=0;
  #groups;
  #role;
  #d1TestArmed=false;
  #d1Repair=null;
  #d1RepairArmed=false;
  constructor(role,calls){
    super({model:"offline-signed-approved-plan-"+role});
    if(!["backend","frontend","test"].includes(role)||
       !Array.isArray(calls)||calls.length<1||calls.length>30)
      throw Error("Invalid offline ADK Task script");
    const groups=calls.approved_task_groups;
    if(groups!==undefined){
      if(!Array.isArray(groups)||groups.length<1||groups.length>30||
         groups.some(g=>!g||
           typeof g.task_id!=="string"||!g.task_id||
           !Number.isSafeInteger(g.call_count)||g.call_count<1)||
         new Set(groups.map(g=>g.task_id)).size!==groups.length||
         groups.reduce((sum,g)=>sum+g.call_count,0)!==calls.length)
        throw Error("Invalid signed offline ADK Task boundaries");
      this.#groups=structuredClone(groups);
    }
    this.#role=role;
    this.#calls=structuredClone(calls);
  }
  get calls(){return this.#turn;}
  /**
   * R150.9: owner-only zero-billing continuation. The ORIGINAL signed Test
   * A2A Task must be terminal before this separate, newly signed D1 Task
   * gets one fresh run_tests operation. This changes no Gateway privileges.
   * The owner independently pins the repaired Gitea SHA and obtains the
   * real Rust Child DC before A2A sends; this model supplies tool intent only.
   */
  armTrustedD1TestRun({branch,taskId}={}){
    if(this.#role!=="test"||this.#d1TestArmed||!this.#groups||
       this.#groupIndex!==this.#groups.length||
       this.#withinGroup!==0||this.#callIndex!==this.#calls.length||
       typeof branch!=="string"||!/^feature\/[A-Za-z0-9._/-]+$/u.test(branch)||
       branch.split("/").some(s=>s==="."||s==="..")||
       typeof taskId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(taskId))
      throw Error("R150.9 Test Task cannot reuse the original signed A2A run");
    this.#calls.push(Object.freeze({
      name:"run_tests",args:Object.freeze({branch,profile:"poc-default"})
    }));
    this.#groups.push(Object.freeze({task_id:taskId,call_count:1}));
    this.#d1TestArmed=true;
  }
  /** Nonbillable Frontend fault repair, armed only by the original signed
   * owner after a fresh Child DC. No source bytes are prepackaged. */
  armTrustedD1TypecheckRepair({branch,path,failedSha,taskId}={}){
   if(this.#role!=="frontend"||this.#d1RepairArmed||this.#d1Repair||
      this.#d1TestArmed||!this.#groups||
      this.#groupIndex!==this.#groups.length||
      this.#withinGroup!==0||this.#callIndex!==this.#calls.length||
      typeof branch!=="string"||!/^feature\/[A-Za-z0-9._/-]+$/u.test(branch)||
      typeof path!=="string"||
      !/^apps\/frontend\/src\/[A-Za-z0-9._/-]+\.tsx?$/u.test(path)||
      path.split("/").some(x=>x==="."||x==="..")||
      !SHA.test(failedSha??"")||
      typeof taskId!=="string"||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(taskId))
    throw Error("Offline D1 Frontend repair requires a new signed Task");
   this.#d1Repair={branch,path,failedSha,taskId,stage:0};
   this.#d1RepairArmed=true;
  }
  async *generateContentAsync(request){
    const repair=this.#d1Repair;
    if(repair){
      this.#turn++;
      if(repair.stage===0){
        repair.stage=1;
        yield {content:{role:"model",parts:[{functionCall:{
          id:"offline-d1-frontend-read",name:"read_file",
          args:{branch:repair.branch,path:repair.path}
        }}]}};return;
      }
      if(repair.stage===1){
        const data=trustedToolEffect(request,"read_file",repair.branch,repair.path);
        if(data.revision!==repair.failedSha||
           typeof data.content!=="string"||
           data.content.split(TYPECHECK_FAULT).length!==2)
          throw Error("Offline D1 Frontend source is not failed pinned TypeScript");
        repair.stage=2;
        yield {content:{role:"model",parts:[{functionCall:{
          id:"offline-d1-frontend-update",name:"update_file",
          args:{branch:repair.branch,path:repair.path,
            content:data.content.replace(TYPECHECK_FAULT,"\n")}
        }}]}};return;
      }
      const written=trustedToolEffect(request,"update_file",repair.branch,repair.path);
      if(!SHA.test(written.commit_sha??"")||
         written.commit_sha===repair.failedSha)
        throw Error("Offline D1 Frontend mutation was not committed");
      this.#d1Repair=null;
      yield {content:{role:"model",parts:[{
        text:"Frontend D1 updated the signed source through Gateway."
      }]}};return;
    }
    const group=this.#groups?.[this.#groupIndex];
    if(this.#groups&&!group)
      throw Error("Signed offline ADK Task schedule exhausted");
    // ADK ends this A2A task on a final text response. A subsequent signed
    // A2A task (same role/model) starts at the NEXT group, never the next
    // operation in the current task.
    if(group&&this.#withinGroup===group.call_count){
      this.#groupIndex++;
      this.#withinGroup=0;
      this.#turn++;
      yield {content:{role:"model",parts:[{
        text:"Completed only this signed Task's controlled operations."
      }]}};
      return;
    }
    const next=this.#calls[this.#callIndex++];
    this.#turn++;
    if(next)this.#withinGroup++;
    if(next){
      yield {content:{role:"model",parts:[{
        functionCall:{
          id:"approved-adk-"+this.#turn,
          name:next.name,args:next.args
        }
      }]}};
    }else{
      yield {content:{role:"model",parts:[{
        text:"Completed only confirmed, authorized tool operations."
      }]}};
    }
  }
  connect(){throw Error("Live model connections prohibited in native offline CI");}
}
