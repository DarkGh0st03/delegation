/**
 * Test-only scripted ADK Backend model. One update_file is derived from
 * the actual trusted read_file result plus rules in the signed Task.
 * All other edits remain prepackaged offline fixtures.
 */
import {BaseLlm} from "@google/adk";
import {createHash} from "node:crypto";
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
function confirmedRead(request,branch,path){
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
  return data.content;
}
export class SourceDerivedRouteOfflineAdkModel extends BaseLlm{
  #script;#index=0;#target;#rules;#proof=null;
  constructor({context,calls}={}){
    super({model:"offline-source-derived-routes-no-provider"});
    if(context?.role!=="backend"||!Array.isArray(calls)||
       calls.length<2||calls.length>30)deny("invalid model role or script");
    const script=structuredClone(calls);
    const derived=script.map((call,index)=>({call,index})).filter(({call})=>
      call.name==="update_file"&&!Object.hasOwn(call.args??{},"content"));
    if(derived.length!==1)deny("exactly one content-free update required");
    const {call,index}=derived[0],previous=script[index-1];
    if(previous?.name!=="read_file"||
       previous.args?.branch!==call.args?.branch||
       previous.args?.path!==call.args?.path||
       typeof call.args.path!=="string"||
       typeof call.args.branch!=="string"||
       !grant(context,"read_file",call.args.branch,call.args.path)||
       !grant(context,"update_file",call.args.branch,call.args.path))
      deny("content-free update needs approved matching read");
    this.#rules=routeRules(context.tasks);
    this.#script=script;
    this.#target={branch:call.args.branch,path:call.args.path,index};
  }
  get calls(){return this.#index;}
  get derivedRouteProof(){return this.#proof?Object.freeze({...this.#proof}):null;}
  async *generateContentAsync(request){
    const index=this.#index++,call=this.#script[index];
    if(!call){
      yield {content:{role:"model",parts:[{
        text:"Only confirmed controlled tools count as completion."
      }]}};
      return;
    }
    let selected=call;
    if(index===this.#target.index){
      const read=confirmedRead(request,this.#target.branch,this.#target.path);
      const content=applyApprovedRouteRules(read,this.#rules);
      this.#proof=Object.freeze({
        branch:this.#target.branch,path:this.#target.path,
        source_sha256:createHash("sha256").update(read,"utf8").digest("hex"),
        directive_count:this.#rules.length,source_derived:true
      });
      selected={name:"update_file",args:{
        branch:this.#target.branch,path:this.#target.path,content
      }};
    }
    yield {content:{role:"model",parts:[{functionCall:{
      id:"source-derived-route-"+(index+1),
      name:selected.name,args:selected.args
    }}]}};
  }
  connect(){throw Error("Offline route model cannot use Gemini");}
}
