import {repairAcceptanceFault} from "./offline-acceptance-repair-fixture.mjs";
/**
 * Test-only scripted ADK Backend model. One update_file is derived from
 * the actual trusted read_file result plus rules in the signed Task.
 * All other edits remain prepackaged offline fixtures.
 */
import {BaseLlm} from "@google/adk";
import {createHash} from "node:crypto";
import {applyApprovedControllerInstructions,parseApprovedControllerInstructions}
  from "./source-derived-controller-edits.mjs";
import {applyApprovedStatusRule,parseApprovedStatusRule}
  from "./source-derived-status-edits.mjs";
const ROUTE=/^ROUTE (GET|POST|PATCH|PUT|DELETE) (\/[a-z0-9:_/-]+) ([A-Za-z_$][\w$]*) (BEFORE|AFTER) (GET|POST|PATCH|PUT|DELETE) (\/[a-z0-9:_/-]+)$/u;
const EXISTING=/^(\s*)router\.(get|post|patch|put|delete)\("([^"]+)",\s*controller\.([A-Za-z_$][\w$]*)\);\s*$/u;
const SHA=/^[a-f0-9]{40}$/u;
function deny(reason){throw Error("Block B source-derived routes NO-GO: "+reason);}
const record=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function routeRules(tasks){
  if(!Array.isArray(tasks)||tasks.length!==1||
     typeof tasks[0].description!=="string")
    deny("missing signed Task instructions");
  const lines=tasks[0].description.split(/\r?\n/u).filter(x=>x.startsWith("ROUTE "));
  if(lines.length<1||lines.length>6)deny("route rule count");
  const rules=lines.map(line=>{
    const m=line.match(ROUTE);
    if(!m)deny("malformed Task route rule");
    return {method:m[1].toLowerCase(),path:m[2],handler:m[3],
      side:m[4],anchorMethod:m[5].toLowerCase(),anchorPath:m[6]};
  });
  if(new Set(rules.map(x=>x.method+"\0"+x.path)).size!==rules.length)
    deny("duplicate Task route");
  return rules;
}
export function applyApprovedRouteRules(source,rules){
  if(typeof source!=="string"||!source||source.length>200000||
     !Array.isArray(rules)||rules.length<1||rules.length>6||
     !source.includes("return router;")||
     !source.includes("const controller = createUserController("))
    deny("unrecognized router file or rules");
  const lines=source.split("\n");
  for(const rule of rules){
    const routes=lines.map((line,i)=>{
      const m=line.match(EXISTING);
      return m?{i,indent:m[1],method:m[2],path:m[3]}:null;
    }).filter(Boolean);
    if(routes.some(x=>x.method===rule.method&&x.path===rule.path))
      deny("route exists already");
    const anchors=routes.filter(x=>x.method===rule.anchorMethod&&
      x.path===rule.anchorPath);
    if(anchors.length!==1)deny("anchor missing or ambiguous");
    const position=anchors[0].i+(rule.side==="AFTER"?1:0);
    const inserted=anchors[0].indent+"router."+rule.method+
      '("'+rule.path+'", controller.'+rule.handler+');';
    lines.splice(position,0,inserted);
  }
  return lines.join("\n");
}
function grant(context,tool,branch,path){
  const suffix="/branches/"+encodeURIComponent(branch)+"/files/"+
    path.split("/").map(encodeURIComponent).join("/");
  return context.approved_permissions.some(p=>
    p.operation===tool&&typeof p.resource==="string"&&
    p.resource.endsWith(suffix));
}
function confirmedReadEffect(request,branch,path){
  const responses=(request?.contents??[]).flatMap(c=>c.parts??[])
    .filter(p=>p.functionResponse?.name==="read_file")
    .map(p=>p.functionResponse.response);
  if(!responses.length)deny("no ADK read response");
  const envelope=responses.at(-1);
  const result=record(envelope?.structuredContent)
    ?envelope.structuredContent
    :record(envelope?.result?.structuredContent)
      ?envelope.result.structuredContent:envelope;
  if(!record(result)||result.ok!==true||!record(result.result))
    deny("unconfirmed read");
  const data=result.result;
  if(data.provider!=="gitea"||data.performed!==true||
     data.tool!=="read_file"||data.branch!==branch||
     data.path!==path||!SHA.test(data.revision??"")||
     typeof data.content!=="string"||data.content.length>200000)
    deny("foreign or oversized read result");
  return data;
}
function confirmedRead(request,branch,path){
  return confirmedReadEffect(request,branch,path).content;
}
function confirmedRepairWrite(request,repair){
  const responses=(request?.contents??[]).flatMap(c=>c.parts??[])
    .filter(p=>p.functionResponse?.name==="update_file")
    .map(p=>p.functionResponse.response);
  const envelope=responses.at(-1);
  const result=record(envelope?.structuredContent)
    ?envelope.structuredContent
    :record(envelope?.result?.structuredContent)
      ?envelope.result.structuredContent:envelope;
  const effect=result?.result;
  if(result?.ok!==true||!record(effect)||
     effect.provider!=="gitea"||effect.performed!==true||
     effect.tool!=="update_file"||effect.branch!==repair.branch||
     effect.path!==repair.path||!SHA.test(effect.commit_sha??"")||
     effect.commit_sha===repair.failedSha)
    deny("unconfirmed or stale Gateway D1 Gitea repair");
}
const FAULT='\nconst __delegation_typecheck_probe: "ACTIVE" | "SUSPENDED" = "SUSPEND";\n';
export class SourceDerivedRouteOfflineAdkModel extends BaseLlm{
  #script;#index=0;#targets;#rules;#controllerRules=null;
  #statusRule=null;#proof=null;#controllerProof=null;#statusProof=null;
  #trustedRepair=null;#trustedRepairUsed=false;
  constructor({context,calls}={}){
    super({model:"offline-source-derived-routes-no-provider"});
    if(context?.role!=="backend"||!Array.isArray(calls)||
       calls.length<2||calls.length>30)deny("invalid model role or script");
    const script=structuredClone(calls);
    const derived=script.map((call,index)=>({call,index})).filter(({call})=>
      call.name==="update_file"&&!Object.hasOwn(call.args??{},"content"));
    if(derived.length<1||derived.length>3)
      deny("one to three source-derived updates required");
    this.#targets=new Map();
    for(const {call,index} of derived){
      const previous=script[index-1];
      if(previous?.name!=="read_file"||
         previous.args?.branch!==call.args?.branch||
         previous.args?.path!==call.args?.path||
         typeof call.args.path!=="string"||
         typeof call.args.branch!=="string"||
         !grant(context,"read_file",call.args.branch,call.args.path)||
         !grant(context,"update_file",call.args.branch,call.args.path))
        deny("content-free update needs approved matching read");
      // Routing and controller edits are selected by the approved task
      // directives AND the recognized file type, not by scenario ID.
      const type=call.args.path.endsWith(".routes.ts")?"route":
        call.args.path.endsWith(".controller.ts")?"controller":
          call.args.path.endsWith("status.ts")?"status":null;
      if(!type||[...this.#targets.values()].some(v=>v.type===type))
        deny("unrecognized or duplicate source-derived edit type");
      this.#targets.set(index,{branch:call.args.branch,
        path:call.args.path,type});
    }
    this.#rules=routeRules(context.tasks);
    if([...this.#targets.values()].some(x=>x.type==="controller"))
      this.#controllerRules=parseApprovedControllerInstructions(
        context.tasks[0].description);
    if([...this.#targets.values()].some(x=>x.type==="status"))
      this.#statusRule=parseApprovedStatusRule(
        context.tasks[0].description);
    this.#script=script;
  }
  get calls(){return this.#index;}
  get derivedRouteProof(){return this.#proof?Object.freeze({...this.#proof}):null;}
  get derivedControllerProof(){
    return this.#controllerProof?Object.freeze({...this.#controllerProof}):null;
  }
  get derivedStatusProof(){
    return this.#statusProof?Object.freeze({...this.#statusProof}):null;
  }
  get derivedFileCount(){
    return Number(this.#proof!==null)+Number(this.#controllerProof!==null)+
      Number(this.#statusProof!==null);
  }
  /**
   * R150.8 one-shot, zero-billing source-derived repair. Only the trusted
   * original native owner calls this after verifying D1, the Gateway bind,
   * exact Backend file grants and genuine failed SHA. Agent/model input is
   * never capable of arming the repair or expanding those permissions.
   */
  armTrustedD1TypecheckRepair({branch,path,failedSha,taskId}={}){
    if(this.#trustedRepairUsed||this.#trustedRepair||
       this.#index<=this.#script.length||
       typeof branch!=="string"||!branch.startsWith("feature/")||
       typeof path!=="string"||
       !/^apps\/backend\/src\/[A-Za-z0-9._/-]+\.ts$/u.test(path)||
       path.split("/").some(x=>x==="."||x==="..")||
       !SHA.test(failedSha??"")||
       typeof taskId!=="string"||
       !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(taskId))
      deny("trusted D1 typecheck repair requires exhausted signed original task");
    this.#trustedRepair={branch,path,failedSha,stage:0,taskId};
    this.#trustedRepairUsed=true;
  }
  /** Separate zero-billing semantic fixture; shares the same exhausted-Task,
   * failed-SHA read and fresh-write checks, without compiler fault injection. */
  armTrustedD1AcceptanceRepair(args){
    this.armTrustedD1TypecheckRepair(args);
    this.#trustedRepair.kind="acceptance";
  }
  async *generateContentAsync(request){
    const repair=this.#trustedRepair;
    if(repair){
      if(repair.stage===0){
        repair.stage=1;
        yield {content:{role:"model",parts:[{functionCall:{
          id:"r150-d1-backend-read",
          name:"read_file",
          args:{branch:repair.branch,path:repair.path}
        }}]}};
        return;
      }
      if(repair.stage===1){
        const observed=confirmedReadEffect(
          request,repair.branch,repair.path);
        if(observed.revision!==repair.failedSha)
          deny("D1 repair must read the exact failed Gitea revision");
        const source=observed.content;
        if(repair.kind!=="acceptance"&&source.split(FAULT).length!==2)
          deny("unsupported or changed real TypeScript fault");
        repair.stage=2;
        // A tiny deterministic fixture corrects precisely the observed
        // injected TS2820 line. This is NOT independent AI-generated code.
        const corrected=repair.kind==="acceptance"
          ?repairAcceptanceFault(source):source.replace(FAULT,"\n");
        yield {content:{role:"model",parts:[{functionCall:{
          id:"r150-d1-backend-update",
          name:"update_file",
          args:{branch:repair.branch,path:repair.path,content:corrected}
        }}]}};
        return;
      }
      confirmedRepairWrite(request,repair);
      this.#trustedRepair=null;
      yield {content:{role:"model",parts:[{
        text:"D1 Backend source repair confirmed through protected Gateway tools."
      }]}};
      return;
    }
    const index=this.#index++,call=this.#script[index];
    if(!call){
      yield {content:{role:"model",parts:[{
        text:"Only confirmed controlled tools count as completion."
      }]}};
      return;
    }
    let selected=call;
    const target=this.#targets.get(index);
    if(target){
      const read=confirmedRead(request,target.branch,target.path);
      const content=target.type==="route"
        ?applyApprovedRouteRules(read,this.#rules)
        :target.type==="controller"
          ?applyApprovedControllerInstructions(read,this.#controllerRules)
          :applyApprovedStatusRule(read,this.#statusRule);
      const proof=Object.freeze({
        branch:target.branch,path:target.path,
        source_sha256:createHash("sha256").update(read,"utf8").digest("hex"),
        directive_count:target.type==="route"
          ?this.#rules.length
          :target.type==="controller"
            ?this.#controllerRules.handlers.length+
              this.#controllerRules.errors.length
            :1,
        source_derived:true
      });
      if(target.type==="route")this.#proof=proof;
      else if(target.type==="controller")this.#controllerProof=proof;
      else this.#statusProof=proof;
      selected={name:"update_file",args:{
        branch:target.branch,path:target.path,content
      }};
    }
    yield {content:{role:"model",parts:[{functionCall:{
      id:"source-derived-route-"+(index+1),
      name:selected.name,args:selected.args
    }}]}};
  }
  connect(){throw Error("Offline route model cannot use Gemini");}
}
