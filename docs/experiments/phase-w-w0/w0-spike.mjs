// Phase W / W0 spike on the LOCAL Gitea: multi-file ChangeFiles commit on a private
// staging ref, exact change-set verification, isolation, single HEAD-CAS.
// Runs inside the app container. Operations use the Gateway token (as production);
// admin credentials only create the throw-away spike repository. Prints no secrets.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const env=f=>Object.fromEntries(readFileSync(f,"utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
const local=env("/config/local.env"), gitea=env("/config/gitea.env");
const BASE=(process.env.GITEA_URL??"http://gitea:3000")+"/api/v1", ORG=local.GITEA_ORG, NAME="w0-spike";
const admin="Basic "+Buffer.from(local.GITEA_ADMIN_USER+":"+local.GITEA_ADMIN_PASSWORD).toString("base64");
const gw="token "+gitea.GITEA_GATEWAY_TOKEN;
const sha256=s=>createHash("sha256").update(s,"utf8").digest("hex");
const b64=s=>Buffer.from(s,"utf8").toString("base64");
async function req(method,path,body,auth=gw){
  const t0=performance.now();
  const r=await fetch(BASE+path,{method,headers:{authorization:auth,accept:"application/json",
    ...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await r.text(); let json; try{json=text?JSON.parse(text):undefined;}catch{json=text;}
  return {status:r.status,json,ms:+(performance.now()-t0).toFixed(1)};
}
const R=`/repos/${ORG}/${NAME}`;
const results=[]; const rec=(id,ok,detail)=>{results.push({id,ok,...detail});console.log(JSON.stringify({id,ok,...detail}));};
const head=async b=>(await req("GET",`${R}/branches/${encodeURIComponent(b)}`)).json?.commit?.id;
const file=async(path,ref)=>{const r=await req("GET",`${R}/contents/${encodeURIComponent(path).replace(/%2F/g,"/")}?ref=${ref}`);
  return r.status===200?{sha:r.json.sha,content:Buffer.from(r.json.content,"base64").toString("utf8")}:null;};
const commitFiles=async c=>{const r=await req("GET",`${R}/git/commits/${c}?stat=true&files=true&verification=false`);
  return {parents:(r.json?.parents??[]).map(p=>p.sha),files:(r.json?.files??[]).map(f=>({filename:f.filename,status:f.status}))};};
const compare=async(a,b)=>{const r=await req("GET",`${R}/compare/${a}...${b}`);
  const top=r.json?.files??[];
  const nested=(r.json?.commits??[]).flatMap(c=>c.files??[]);
  return {status:r.status,keys:Object.keys(r.json??{}),commits:r.json?.total_commits??r.json?.commits?.length,
    files:(top.length?top:nested).map(f=>({filename:f.filename,status:f.status}))};};
const stage=async(name,from)=>req("POST",`${R}/branches`,{new_branch_name:name,old_ref_name:from});
const cas=async(branch,oldSha,newSha)=>req("PUT",`${R}/branches/${encodeURIComponent(branch)}`,{new_commit_id:newSha,old_commit_id:oldSha,force:false});

// ---- setup: fresh repo, work branch, Gateway as write collaborator
if((await req("GET",R,undefined,admin)).status===200)await req("DELETE",R,undefined,admin);
await req("POST",`/orgs/${ORG}/repos`,{name:NAME,private:true,auto_init:true,default_branch:"main",readme:"Default"},admin);
await req("PUT",`${R}/collaborators/${gitea.GITEA_GATEWAY_USER}`,{permission:"write"},admin);
const readme=await file("README.md","main");
await req("POST",`${R}/contents`,{branch:"main",message:"seed",files:[
  {operation:"update",path:"README.md",content:b64("# w0\n"),sha:readme.sha},
  {operation:"create",path:"src/a.js",content:b64("a1\n")},
  {operation:"create",path:"src/b.js",content:b64("b1\n")},
  {operation:"create",path:"src/c.js",content:b64("c1\n")}]},admin);
const WORK="feature/w0-work";
await req("POST",`${R}/branches`,{new_branch_name:WORK,old_ref_name:"main"});
const H0=await head(WORK);
const A=await file("src/a.js",H0), B=await file("src/b.js",H0);

// ---- S1 mixed create/update in ONE ChangeFiles commit on a private staging ref
const st1="feature/w0-stage-1";
const s1=await stage(st1,H0);
const writes=[{operation:"update",path:"src/a.js",content:"a2\n",sha:A.sha},
  {operation:"update",path:"src/b.js",content:"b2\n",sha:B.sha},
  {operation:"create",path:"src/new1.js",content:"n1\n"},
  {operation:"create",path:"test/new2.test.js",content:"n2\n"}];
const c1=await req("POST",`${R}/contents`,{branch:st1,message:"w0 write-set",
  files:writes.map(w=>({operation:w.operation,path:w.path,content:b64(w.content),...(w.sha?{sha:w.sha}:{})}))});
const C1=c1.json?.commit?.sha;
const cf=await commitFiles(C1), cmp=await compare(H0,C1);
const contentsOk=(await Promise.all(writes.map(async w=>sha256((await file(w.path,C1))?.content??"")===sha256(w.content)))).every(Boolean);
const expected=writes.map(w=>`${w.path}:${w.operation==="update"?"modified":"added"}`).sort();
rec("S1_changefiles_mixed",c1.status===201&&cf.parents.length===1&&cf.parents[0]===H0&&contentsOk,
  {stage_status:s1.status,status:c1.status,ms:c1.ms,parents_ok:cf.parents[0]===H0,n_parents:cf.parents.length,
   commit_files:cf.files.map(f=>`${f.filename}:${f.status}`).sort(),compare_files:cmp.files.map(f=>`${f.filename}:${f.status}`).sort(),
   compare_commits:cmp.commits,compare_keys:cmp.keys,expected,
   exact_set_commit:JSON.stringify(cf.files.map(f=>`${f.filename}:${f.status}`).sort())===JSON.stringify(expected),
   exact_set_compare:JSON.stringify(cmp.files.map(f=>`${f.filename}:${f.status}`).sort())===JSON.stringify(expected),
   contents_ok:contentsOk,response_keys:Object.keys(c1.json??{})});

// ---- S2 isolation: work branch untouched before CAS; then ONE CAS publishes all
const beforeCas=await head(WORK);
const newFileVisible=await file("src/new1.js",WORK);
const p=await cas(WORK,H0,C1);
const after=await head(WORK);
rec("S2_isolation_then_single_cas",beforeCas===H0&&!newFileVisible&&after===C1,
  {work_before_cas:beforeCas===H0,new_file_visible_before:!!newFileVisible,cas_status:p.status,cas_ms:p.ms,work_after_is_commit:after===C1});

// ---- S3 CAS when HEAD advanced: rejected, work unchanged, staged commit unpublished
const H1=after; const st3="feature/w0-stage-3";
await stage(st3,H1);
const a1=await file("src/a.js",H1);
const c3=await req("POST",`${R}/contents`,{branch:st3,message:"w0 s3",files:[{operation:"update",path:"src/a.js",content:b64("a3\n"),sha:a1.sha}]});
const C3=c3.json?.commit?.sha;
const adv=await req("POST",`${R}/contents`,{branch:WORK,message:"concurrent advance",files:[{operation:"create",path:"src/other.js",content:b64("o\n")}]});
const H2=await head(WORK);
const p3=await cas(WORK,H1,C3);
const after3=await head(WORK);
rec("S3_cas_head_advanced_rejected",H2!==H1&&p3.status>=400&&after3===H2,
  {advance_status:adv.status,cas_status:p3.status,cas_message:String(p3.json?.message??"").slice(0,160),work_unchanged:after3===H2});

// ---- S4 wrong sha on one update among valid ops: whole request rejected, no partial commit
const st4="feature/w0-stage-4"; await stage(st4,H2);
const b2=await file("src/b.js",H2);
const c4=await req("POST",`${R}/contents`,{branch:st4,message:"w0 s4",files:[
  {operation:"create",path:"src/ok4.js",content:b64("ok\n")},
  {operation:"update",path:"src/b.js",content:b64("b4\n"),sha:"0".repeat(40)}]});
const h4=await head(st4);
rec("S4_stale_sha_rejects_all",c4.status>=400&&h4===H2&&!(await file("src/ok4.js",st4)),
  {status:c4.status,message:String(c4.json?.message??"").slice(0,160),staging_unchanged:h4===H2});

// ---- S5 create of an existing file among valid ops: rejected, no partial
const c5=await req("POST",`${R}/contents`,{branch:st4,message:"w0 s5",files:[
  {operation:"update",path:"src/b.js",content:b64("b5\n"),sha:b2.sha},
  {operation:"create",path:"src/a.js",content:b64("dup\n")}]});
const h5=await head(st4);
rec("S5_create_existing_rejects_all",c5.status>=400&&h5===H2,
  {status:c5.status,message:String(c5.json?.message??"").slice(0,160),staging_unchanged:h5===H2});

// ---- S6 update of a non-existent file: rejected
const c6=await req("POST",`${R}/contents`,{branch:st4,message:"w0 s6",files:[
  {operation:"update",path:"src/missing.js",content:b64("m\n"),sha:"1".repeat(40)}]});
rec("S6_update_missing_rejected",c6.status>=400&&(await head(st4))===H2,{status:c6.status,message:String(c6.json?.message??"").slice(0,160)});

// ---- S6b update WITHOUT sha (no blob guard): does Gitea accept it?
const c6b=await req("POST",`${R}/contents`,{branch:st4,message:"w0 s6b",files:[
  {operation:"update",path:"src/c.js",content:b64("c-nosha\n")}]});
rec("S6b_update_without_sha",true,{status:c6b.status,accepted:c6b.status===201,
  message:String(c6b.json?.message??"").slice(0,160),note:"if accepted, the owner must ALWAYS send sha"});
const H4b=await head(st4);

// ---- S7 extra change detected: a commit touching an unauthorized path fails exact-set verification
const st7="feature/w0-stage-7"; await stage(st7,H2);
const b7=await file("src/b.js",H2);
const c7=await req("POST",`${R}/contents`,{branch:st7,message:"w0 s7",files:[
  {operation:"update",path:"src/b.js",content:b64("b7\n"),sha:b7.sha},
  {operation:"create",path:"src/unauthorized.js",content:b64("x\n")}]});
const cf7=await commitFiles(c7.json?.commit?.sha), cmp7=await compare(H2,c7.json?.commit?.sha);
const authorized=["src/b.js:modified"];
rec("S7_extra_path_detected",JSON.stringify(cf7.files.map(f=>`${f.filename}:${f.status}`).sort())!==JSON.stringify(authorized),
  {commit_files:cf7.files.map(f=>`${f.filename}:${f.status}`),compare_files:cmp7.files.map(f=>`${f.filename}:${f.status}`)});

// ---- S8 identical content update: does Gitea create an (empty) commit?
const st8="feature/w0-stage-8"; await stage(st8,H2);
const b8=await file("src/b.js",H2);
const c8=await req("POST",`${R}/contents`,{branch:st8,message:"w0 s8",files:[
  {operation:"update",path:"src/b.js",content:b64(b8.content),sha:b8.sha}]});
const cf8=c8.status===201?await commitFiles(c8.json.commit.sha):null;
rec("S8_identical_content",true,{status:c8.status,commit_created:c8.status===201,files:cf8?.files,
  note:"owner rejects identical bytes before staging in any case"});

// ---- S9 fallback: N sequential single-file commits on the private ref, then ONE CAS
const H9=await head(WORK); const st9="feature/w0-stage-9"; await stage(st9,H9);
const seq=[]; for(const [i,[path,content]] of [["src/a.js","a9\n"],["src/b.js","b9\n"],["src/seq.js","s9\n"]].entries()){
  const cur=await file(path,st9);
  const r=await req("POST",`${R}/contents`,{branch:st9,message:"w0 s9 "+i,files:[cur?
    {operation:"update",path,content:b64(content),sha:cur.sha}:{operation:"create",path,content:b64(content)}]});
  seq.push({path,status:r.status,ms:r.ms});
}
const T9=await head(st9), cmp9=await compare(H9,T9);
const p9=await cas(WORK,H9,T9);
rec("S9_fallback_multi_commit_single_cas",cmp9.commits===3&&(await head(WORK))===T9,
  {commits:cmp9.commits,compare_files:cmp9.files.map(f=>`${f.filename}:${f.status}`).sort(),cas_status:p9.status,
   per_commit_ms:seq.map(s=>s.ms)});

// ---- S10 CAS with wrong old_commit_id on an un-advanced branch, and staging ref visibility
const p10=await cas(WORK,"f".repeat(40),T9);
const branches=(await req("GET",`${R}/branches?limit=50`)).json?.map(b=>b.name)??[];
rec("S10_cas_wrong_old_rejected_and_refs",p10.status>=400&&(await head(WORK))===T9,
  {cas_status:p10.status,message:String(p10.json?.message??"").slice(0,160),
   leftover_staging_refs:branches.filter(b=>b.startsWith("feature/w0-stage-"))});
// cleanup of staging refs (owner-side reconciliation is the same DELETE)
for(const b of branches.filter(b=>b.startsWith("feature/w0-stage-"))){
  const d=await req("DELETE",`${R}/branches/${encodeURIComponent(b)}`);
  if(d.status!==204)console.log(JSON.stringify({cleanup:b,status:d.status}));
}
const version=(await req("GET","/version")).json?.version;
console.log(JSON.stringify({gitea_version:version,passed:results.filter(r=>r.ok).length,total:results.length}));
