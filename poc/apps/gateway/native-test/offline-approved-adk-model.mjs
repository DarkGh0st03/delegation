/**
 * Test-only, fixed tool-call schedule through real Google ADK LlmAgent/Runner.
 * Never contacts Gemini; the real Gateway checks each operation independently.
 * The generated calls are fixtures, not evidence of autonomous code design.
 */
import {BaseLlm} from "@google/adk";

export class OfflineApprovedAdkModel extends BaseLlm{
  #calls;
  #turn=0;
  #callIndex=0;
  #groupIndex=0;
  #withinGroup=0;
  #groups;
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
    this.#calls=structuredClone(calls);
  }
  get calls(){return this.#turn;}
  async *generateContentAsync(){
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
