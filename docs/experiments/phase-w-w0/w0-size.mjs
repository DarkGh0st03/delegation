// W0 size probe: ChangeFiles with 8 files of 256 KiB and of 2 MB on a private ref.
import {readFileSync} from "node:fs";
const env=f=>Object.fromEntries(readFileSync(f,"utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
const local=env("/config/local.env"), gitea=env("/config/gitea.env");
const BASE="http://gitea:3000/api/v1", R=`/repos/${local.GITEA_ORG}/w0-spike`, gw="token "+gitea.GITEA_GATEWAY_TOKEN;
async function req(method,path,body){const t0=performance.now();
  const r=await fetch(BASE+path,{method,headers:{authorization:gw,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const t=await r.text();return {status:r.status,ms:Math.round(performance.now()-t0),msg:t.slice(0,160),bytes:body?JSON.stringify(body).length:0};}
const head=(await (await fetch(BASE+R+"/branches/feature%2Fw0-work",{headers:{authorization:gw}})).json()).commit.id;
for(const [label,size] of [["8x256KiB",256*1024],["8x2MB",2_000_000]]){
  const br="feature/w0-size-"+label.toLowerCase();
  await req("POST",R+"/branches",{new_branch_name:br,old_ref_name:head});
  const files=Array.from({length:8},(_,i)=>({operation:"create",path:`big/${label}-${i}.txt`,
    content:Buffer.from(("x".repeat(63)+"\n").repeat(Math.ceil(size/64)).slice(0,size)).toString("base64")}));
  const r=await req("POST",R+"/contents",{branch:br,message:"size "+label,files});
  console.log(JSON.stringify({label,request_bytes:r.bytes,status:r.status,ms:r.ms,msg:r.status===201?"":r.msg}));
  await req("DELETE",R+"/branches/"+encodeURIComponent(br));
}
