/**
 * Test-only hybrid ADK model. It uses the preapproved offline implementation
 * fixture for the feature, but makes ONE harmless code-comment mutation
 * depend on the actual, provider-confirmed read_file response.
 *
 * The model does NOT independently implement the feature. Its purpose is to
 * prove source -> ADK -> scoped A2A/MCP -> Rust/OPA/Gitea dataflow in the
 * existing signed DAG, without paid inference or extra model permissions.
 */
import {createHash} from "node:crypto";
import {BaseLlm} from "@google/adk";
import {parseApprovedApiActions,applyApprovedApiActions}
  from "./source-derived-frontend-api-edits.mjs";

const SHA=/^[a-f0-9]{40}$/u;
function fail(){throw Error("Block B source witness NO-GO");}
function record(v){return v!==null&&typeof v==="object"&&!Array.isArray(v);}
function decodeResource(value){
  if(typeof value!=="string")fail();
  const m=value.match(/\/branches\/([^/]+)\/files\/(.+)$/u);
  if(!m)fail();
  try{
    const branch=decodeURIComponent(m[1]);
    const path=m[2].split("/").map(decodeURIComponent).join("/");
    if(!branch.startsWith("feature/")||!path||
       path.startsWith("/")||path.includes("\\")||
       path.split("/").some(x=>!x||x==="."||x===".."))fail();
    return {branch,path};
  }catch{fail();}
}
function responseForRead(request,branch,path){
  if(!Array.isArray(request?.contents))fail();
  const matches=request.contents.flatMap(c=>c?.parts??[])
    .filter(p=>p?.functionResponse?.name==="read_file")
    .map(p=>p.functionResponse.response);
  if(matches.length<1||matches.length>32)fail();
  // Later function calls carry their own matching read result; earlier
  // successful reads in the ADK history must not shadow the current file.
  const envelope=matches.at(-1);
  // Actual ADK MCPTool response wraps the result as structuredContent.
  // In-memory FunctionTool produces {ok,result} directly.
  const data=record(envelope?.structuredContent)
    ?envelope.structuredContent
    :record(envelope?.result?.structuredContent)
      ?envelope.result.structuredContent:envelope;
  if(!record(data)||data.ok!==true||!record(data.result))fail();
  const result=data.result;
  if(result.provider!=="gitea"||result.performed!==true||
     result.tool!=="read_file"||result.branch!==branch||
     result.path!==path||typeof result.content!=="string"||
     result.content.length===0||result.content.length>2_000_000||
     !SHA.test(result.revision))fail();
  return result.content;
}

export class SourceWitnessedOfflineAdkModel extends BaseLlm{
  #calls;
  #turn=0;
  #target;
  #apiTarget=null;
  #apiActions=null;
  #apiProof=null;
  #witness=null;
  constructor({context,calls}={}){
    super({model:"offline-hybrid-source-witness-no-provider"});
    if(context?.role!=="frontend"||!Array.isArray(calls)||
       calls.length<2||calls.length>30)fail();
    const scripts=structuredClone(calls);
    const scripted=scripts.map((call,index)=>({call,index}))
      .filter(({call})=>call.name==="update_file"&&
        typeof call.args?.content==="string");
    if(scripted.length<1)fail();
    const {index:position,call:update}=scripted[0];
    if(position<1||scripts[position-1].name!=="read_file")fail();
    const read=scripts[position-1];
    if(read.args?.branch!==update.args?.branch||
       read.args?.path!==update.args?.path)fail();
    const permission=context.approved_permissions;
    if(!Array.isArray(permission)||!permission.some(p=>{
      const uri=decodeResource(p.resource);
      return p.operation==="read_file"&&
        uri.branch===read.args.branch&&uri.path===read.args.path;
    })||!permission.some(p=>{
      const uri=decodeResource(p.resource);
      return p.operation==="update_file"&&
        uri.branch===update.args.branch&&uri.path===update.args.path;
    }))fail();
    const withoutContents=scripts.map((call,index)=>({call,index}))
      .filter(({call})=>call.name==="update_file"&&
        !Object.hasOwn(call.args??{},"content"));
    if(withoutContents.length>1)fail();
    if(withoutContents.length){
      const {call,index}=withoutContents[0],previous=scripts[index-1];
      if(!previous||previous.name!=="read_file"||
         previous.args?.branch!==call.args?.branch||
         previous.args?.path!==call.args?.path||
         !call.args?.path.endsWith("-api.ts")||
         !permission.some(p=>p.operation==="read_file"&&
           decodeResource(p.resource).branch===call.args.branch&&
           decodeResource(p.resource).path===call.args.path)||
         !permission.some(p=>p.operation==="update_file"&&
           decodeResource(p.resource).branch===call.args.branch&&
           decodeResource(p.resource).path===call.args.path))
        fail();
      const tasks=context.tasks;
      if(!Array.isArray(tasks)||tasks.length!==1)fail();
      this.#apiActions=parseApprovedApiActions(tasks[0].description);
      this.#apiTarget={branch:call.args.branch,path:call.args.path,index};
    }
    this.#calls=scripts;
    this.#target={branch:update.args.branch,path:update.args.path,
      index:position};
  }
  get calls(){return this.#turn;}
  get sourceWitness(){
    return this.#witness===null?null:Object.freeze({...this.#witness});
  }
  get derivedApiProof(){
    return this.#apiProof===null?null:Object.freeze({...this.#apiProof});
  }
  async *generateContentAsync(request){
    const index=this.#turn++;
    const current=this.#calls[index];
    if(!current){
      yield {content:{role:"model",parts:[{
        text:"Only Gateway-confirmed operations may count as completed."
      }]}};
      return;
    }
    let selected=current;
    if(this.#apiTarget&&index===this.#apiTarget.index){
      const read=responseForRead(request,this.#apiTarget.branch,
        this.#apiTarget.path);
      const content=applyApprovedApiActions(read,this.#apiActions);
      this.#apiProof=Object.freeze({
        branch:this.#apiTarget.branch,path:this.#apiTarget.path,
        source_sha256:createHash("sha256").update(read,"utf8").digest("hex"),
        source_derived:true,action_count:this.#apiActions.length
      });
      selected={name:"update_file",args:{
        branch:this.#apiTarget.branch,path:this.#apiTarget.path,content
      }};
    }
    if(index===this.#target.index){
      const original=responseForRead(request,this.#target.branch,this.#target.path);
      const digest=createHash("sha256").update(original,"utf8").digest("hex");
      const end=current.args.content.endsWith("\n")?"":"\n";
      // A comment keeps project acceptance unchanged; only its digest was
      // derived from the model-visible source. Everything else remains fixture.
      const content=current.args.content+end+
        "// block-b-source-read-sha256:"+digest+"\n";
      this.#witness=Object.freeze({
        path:this.#target.path,branch:this.#target.branch,
        source_sha256:digest
      });
      selected={name:current.name,args:{...current.args,content}};
    }
    yield {content:{role:"model",parts:[{functionCall:{
      id:"source-witness-"+(index+1),
      name:selected.name,args:selected.args
    }}]}};
  }
  connect(){throw Error("No paid or live provider in offline hybrid ADK");}
}
