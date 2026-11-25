import {readFileSync} from "node:fs";
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
const rows=[];
for(const v of ["batch","single"]) for(const i of [1,2,3]){
  const r=JSON.parse(readFileSync(`raw/${v}-${i}.json`));
  const d=r.gateway_decisions, reads=d.filter(x=>x.tool==="read_file");
  const ver=d.map(x=>x.verification_ms);
  rows.push({run:`${v}-${i}`,decisions:d.length,reads:reads.length,
    full_verifs:ver.filter(x=>x>10).length,reused:ver.filter(x=>x<=10).length,
    verif_sum_s:+(ver.reduce((a,b)=>a+b,0)/1e3).toFixed(2),
    read_verif_sum_s:+(reads.reduce((a,b)=>a+b.verification_ms,0)/1e3).toFixed(2),
    opa_sum_ms:+d.reduce((a,b)=>a+b.opa_ms,0).toFixed(1),
    exec_s:r.execution_ms/1e3, planning_s:r.planning_ms/1e3, all_allow:d.every(x=>x.decision==="allow")});
}
console.table(rows);
for(const v of ["batch","single"]){const rs=rows.filter(r=>r.run.startsWith(v));
 console.log(v,"median exec",med(rs.map(r=>r.exec_s)),"median verif",med(rs.map(r=>r.verif_sum_s)));}
for(const f of ["adk_tool_timing-batch.jsonl","adk_tool_timing-single.jsonl"]){
  const t=readFileSync("raw/"+f,"utf8").split("\n").filter(l=>l.includes("adk_tool_timing")).map(l=>JSON.parse(l.slice(l.indexOf("{"))));
  const reads=t.filter(x=>x.role==="test"&&/^read_file/.test(x.tool));
  const perTask={};for(const x of reads)(perTask[x.task_ref]??=[]).push(x.duration_ms);
  console.log(f,"test-task read tool ms per task:",Object.values(perTask).map(a=>a.reduce((p,q)=>p+q,0)).join(","));
}
