/**
 * In-memory Gitea for Phase W tests: immutable commits, branches, Gitea's
 * ChangeFiles all-or-nothing semantics (W0 S4-S6), commit file lists,
 * compare, recursive trees with git modes, branch CAS with old_commit_id
 * (422 on mismatch, W0 S3/S10). Fault hooks simulate the cases a real Gitea
 * cannot be forced into on demand (lost CAS responses, extra files, modes).
 */
import {createHash} from "node:crypto";

type FileEntry={content:string;mode:string};
interface Commit{parent:string|null;files:Map<string,FileEntry>}
const sha1=(s:string)=>createHash("sha1").update(s).digest("hex");
const blob=(content:string)=>sha1("blob "+Buffer.byteLength(content)+"\0"+content);

export class FakeGitea{
 readonly commits=new Map<string,Commit>();
 readonly branches=new Map<string,string>();
 readonly calls:string[]=[];
 /** Fault hooks. */
 casMode:"normal"|"lost_after_apply"|"lost_before_apply"|"error500"|"reread_fails"="normal";
 beforeCas?:()=>void;
 /** Extra (unauthorized) operation smuggled into the next ChangeFiles commit. */
 injectIntoChangeFiles?:{path:string;content:string};
 /** Mode applied to a path in the next ChangeFiles commit. */
 modeOverride?:{path:string;mode:string};
 #counter=0;
 constructor(files:Record<string,string>,opts:{modes?:Record<string,string>}={}){
  const head=this.#commit(null,new Map(Object.entries(files).map(([p,c])=>[p,{content:c,mode:opts.modes?.[p]??"100644"}])));
  this.branches.set("main",head);
 }
 #commit(parent:string|null,files:Map<string,FileEntry>):string{
  const sha=sha1("commit\n"+(parent??"")+"\n"+(this.#counter++)+"\n"+
   [...files].map(([p,f])=>p+"\0"+f.mode+"\0"+f.content).join("\n"));
  this.commits.set(sha,{parent,files});
  return sha;
 }
 head(branch:string){return this.branches.get(branch);}
 fileAt(sha:string,path:string){return this.commits.get(sha)?.files.get(path);}
 /** Advance a branch with an unrelated commit (concurrent writer). */
 advance(branch:string,path="concurrent.txt",content="x\n"){
  const base=this.branches.get(branch)!;
  const files=new Map(this.commits.get(base)!.files);files.set(path,{content,mode:"100644"});
  const c=this.#commit(base,files);this.branches.set(branch,c);return c;
 }
 createBranch(name:string,from:string){this.branches.set(name,this.branches.get(from)??from);}
 /** Called at the start of every request ("METHOD /path"). */
 onRequest?:(call:string)=>void;
 readonly fetch=async(input:string|URL,init?:RequestInit):Promise<Response>=>{
  const url=new URL(String(input));const method=(init?.method??"GET").toUpperCase();
  this.onRequest?.(method+" "+url.pathname.replace(/^\/api\/v1\/repos\/thesis\/sample-app/u,""));
  const body=init?.body?JSON.parse(String(init.body)):undefined;
  const m=/^\/api\/v1\/repos\/thesis\/sample-app(\/.*)?$/u.exec(url.pathname);
  this.calls.push(method+" "+(m?.[1]??url.pathname));
  if(!m)return Response.json({},{status:404});
  const rest=m[1]??"";
  const json=(v:unknown,status=200)=>Response.json(v,{status});
  let r:RegExpExecArray|null;
  if((r=/^\/branches\/(.+)$/u.exec(rest))){
   const name=decodeURIComponent(r[1]!);
   if(method==="GET"){
    if(this.casMode==="reread_fails"&&this.calls.some(c=>c.startsWith("PUT /branches")))
     throw new TypeError("network down");
    const h=this.branches.get(name);
    return h?json({name,commit:{id:h}}):json({},404);
   }
   if(method==="DELETE"){this.branches.delete(name);return new Response(null,{status:204});}
   if(method==="PUT"){
    this.beforeCas?.();
    const h=this.branches.get(name);
    if(this.casMode==="lost_before_apply")throw new TypeError("connection reset");
    if(this.casMode==="error500")return json({message:"internal"},500);
    if(h!==body.old_commit_id)
     return json({message:`branch commit does not match [expected: ${body.old_commit_id}, given: ${h}]`},422);
    if(!this.commits.has(body.new_commit_id))return json({message:"no commit"},404);
    this.branches.set(name,body.new_commit_id);
    if(this.casMode==="lost_after_apply")throw new TypeError("connection reset after apply");
    return new Response(null,{status:204});
   }
  }
  if(rest==="/branches"&&method==="POST"){
   if(this.branches.has(body.new_branch_name))return json({message:"exists"},409);
   const from=this.branches.get(body.old_ref_name)??(this.commits.has(body.old_ref_name)?body.old_ref_name:undefined);
   if(!from)return json({},404);
   this.branches.set(body.new_branch_name,from);
   return json({name:body.new_branch_name,commit:{id:from}},201);
  }
  if((r=/^\/contents\/(.+)$/u.exec(rest))&&method==="GET"){
   const path=decodeURIComponent(r[1]!);
   const ref=url.searchParams.get("ref")!;
   const sha=this.commits.has(ref)?ref:this.branches.get(ref);
   const f=sha?this.fileAt(sha,path):undefined;
   if(!f)return json({},404);
   return json({type:"file",path,encoding:"base64",content:Buffer.from(f.content).toString("base64"),
    sha:blob(f.content),size:Buffer.byteLength(f.content)});
  }
  if(rest==="/contents"&&method==="POST"){
   const head=this.branches.get(body.branch);
   if(!head)return json({},404);
   const files=new Map(this.commits.get(head)!.files);
   const ops=[...body.files];
   if(this.injectIntoChangeFiles){ops.push({operation:"create",path:this.injectIntoChangeFiles.path,
    content:Buffer.from(this.injectIntoChangeFiles.content).toString("base64")});this.injectIntoChangeFiles=undefined;}
   // All-or-nothing validation, as Gitea (W0 S4-S6).
   for(const op of ops){
    const cur=files.get(op.path);
    if(op.operation==="create"&&cur)return json({message:`repository file already exists [path: ${op.path}]`},422);
    if(op.operation==="update"&&!cur)return json({message:"object does not exist"},404);
    if(op.operation==="update"&&op.sha&&op.sha!==blob(cur!.content))return json({message:"sha does not match"},422);
   }
   for(const op of ops){
    const content=Buffer.from(op.content,"base64").toString("utf8");
    files.set(op.path,{content,mode:files.get(op.path)?.mode??"100644"});
   }
   if(this.modeOverride){const f=files.get(this.modeOverride.path);
    if(f)files.set(this.modeOverride.path,{...f,mode:this.modeOverride.mode});this.modeOverride=undefined;}
   const c=this.#commit(head,files);this.branches.set(body.branch,c);
   return json({commit:{sha:c},files:[]},201);
  }
  const diff=(sha:string)=>{
   const c=this.commits.get(sha)!,p=c.parent?this.commits.get(c.parent)!.files:new Map<string,FileEntry>();
   const out:{filename:string;status:string}[]=[];
   for(const [path,f] of c.files){const o=p.get(path);
    if(!o)out.push({filename:path,status:"added"});
    else if(o.content!==f.content||o.mode!==f.mode)out.push({filename:path,status:"modified"});}
   for(const path of p.keys())if(!c.files.has(path))out.push({filename:path,status:"removed"});
   return out;
  };
  if((r=/^\/git\/commits\/([a-f0-9]{40})$/u.exec(rest))){
   const c=this.commits.get(r[1]!);
   if(!c)return json({},404);
   return json({sha:r[1],parents:c.parent?[{sha:c.parent}]:[],files:diff(r[1]!)});
  }
  if((r=/^\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/u.exec(rest))){
   const commits=[];let cur:string|null=r[2]!;
   while(cur&&cur!==r[1]){commits.unshift({sha:cur,files:diff(cur)});cur=this.commits.get(cur)?.parent??null;}
   return json({total_commits:commits.length,commits});
  }
  if((r=/^\/git\/trees\/([a-f0-9]{40})$/u.exec(rest))){
   const c=this.commits.get(r[1]!);
   if(!c)return json({},404);
   return json({sha:r[1],truncated:false,tree:[...c.files].map(([path,f])=>({path,mode:f.mode,
    type:f.mode==="120000"?"blob":"blob",sha:blob(f.content)}))});
  }
  return json({},404);
 };
}
