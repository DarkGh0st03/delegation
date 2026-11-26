// Console API driver for the Phase R scripted E2E. Credentials are read from
// the repository .env and never printed.
import {readFileSync} from "node:fs";
const env=Object.fromEntries(readFileSync("/home/user/delegation/.env","utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).trim()]));
const base="http://127.0.0.1:8700";
let cookie="";
export async function api(method,path,body){
  const r=await fetch(base+path,{method,headers:{"content-type":"application/json","x-console-request":"1",
    origin:base,...(cookie?{cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const set=r.headers.get("set-cookie"); if(set)cookie=set.split(";")[0];
  const text=await r.text(); let json; try{json=JSON.parse(text);}catch{json=text;}
  if(!r.ok)throw Error(`${method} ${path} -> ${r.status} ${typeof json==="string"?json:JSON.stringify(json).slice(0,300)}`);
  return json;
}
export const login=()=>api("POST","/api/login",{username:env.ENGINEER_USERNAME,password:env.ENGINEER_PASSWORD});
export const password=()=>env.ENGINEER_PASSWORD;
if(process.argv[2]==="inspect"){
  await login();
  const sessions=await api("GET","/api/sessions");
  const list=Array.isArray(sessions)?sessions:sessions.sessions??[];
  console.log(list.slice(0,8).map(s=>[s.id,s.phase,s.mode,s.repository?.full_name??s.repository?.name??JSON.stringify(s.repository)].join(" | ")).join("\n"));
  const ref=await api("GET","/api/sessions/s-935407ed1332").catch(e=>({error:e.message}));
  console.log(JSON.stringify({keys:Object.keys(ref),repository:ref.repository,requirement:ref.requirement,request_id:ref.request_id}).slice(0,800));
  const repos=await api("GET","/api/repos"); console.log(JSON.stringify(repos).slice(0,400));
}
