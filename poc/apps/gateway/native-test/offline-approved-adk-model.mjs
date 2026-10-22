/**
 * Test-only, fixed tool-call schedule through real Google ADK LlmAgent/Runner.
 * Never contacts Gemini; the real Gateway checks each operation independently.
 * The generated calls are fixtures, not evidence of autonomous code design.
 */
import {BaseLlm} from "@google/adk";

export class OfflineApprovedAdkModel extends BaseLlm{
  #calls;
  #turn=0;
  constructor(role,calls){
    super({model:"offline-signed-approved-plan-"+role});
    if(!["backend","frontend","test"].includes(role)||
       !Array.isArray(calls)||calls.length<1||calls.length>30)
      throw Error("Invalid offline ADK Task script");
    this.#calls=structuredClone(calls);
  }
  get calls(){return this.#turn;}
  async *generateContentAsync(){
    const next=this.#calls[this.#turn++];
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
