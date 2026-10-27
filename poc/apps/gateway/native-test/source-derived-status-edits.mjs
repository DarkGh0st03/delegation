/**
 * Offline, deterministic status-type edit from trusted Task instructions and
 * provider-read source. Does not establish autonomous software generation.
 */
const IDENT=/^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const LABEL=/^[A-Z][A-Z0-9_]*$/u;
const RULE=/^STATUS TYPE ([A-Za-z_$][A-Za-z0-9_$]*) CONST ([A-Za-z_$][A-Za-z0-9_$]*) ADD ([A-Z][A-Z0-9_]*)$/u;
function deny(why){throw Error("Source-derived status NO-GO: "+why);}
const esc=x=>x.replace(/\$/gu,"\\$");
export function parseApprovedStatusRule(task){
  if(typeof task!=="string"||task.length>1800)deny("invalid task");
  const rules=task.split(/\r?\n/u).filter(x=>x.startsWith("STATUS "));
  if(rules.length!==1)deny("must have one status directive");
  const m=rules[0].match(RULE);
  if(!m)deny("invalid status directive");
  return Object.freeze({type:m[1],constant:m[2],newValue:m[3]});
}
export function applyApprovedStatusRule(source,rule){
  if(typeof source!=="string"||!source||source.length>100000||
     !rule||!IDENT.test(rule.type??"")||
     !IDENT.test(rule.constant??"")||!LABEL.test(rule.newValue??""))
    deny("invalid source or rule");
  const typeRE=new RegExp("^export type "+esc(rule.type)+" = ([^;\\n]+);$","gm");
  const ts=[...source.matchAll(typeRE)];
  if(ts.length!==1)deny("missing/ambiguous union");
  const states=ts[0][1].split(/\s*\|\s*/u).map(s=>{
    const m=s.trim().match(/^"([A-Z][A-Z0-9_]*)"$/u);
    if(!m)deny("unrecognized union");
    return m[1];
  });
  if(new Set(states).size!==states.length||states.includes(rule.newValue))
    deny("duplicate state");
  const constRE=new RegExp("^export const "+esc(rule.constant)+
    " = \\{\\n([\\s\\S]*?)\\n\\} as const satisfies Record<string, "+
    esc(rule.type)+">;$","gm");
  const cs=[...source.matchAll(constRE)];
  if(cs.length!==1)deny("missing/ambiguous state constant");
  const existing=cs[0][1].split("\n").map(s=>{
    const m=s.match(/^  ([A-Z][A-Z0-9_]*): "([A-Z][A-Z0-9_]*?)"(,?)$/u);
    if(!m||m[1]!==m[2])deny("unrecognized constant entry");
    return m[1];
  });
  if(existing.length!==states.length||
     existing.some((s,i)=>s!==states[i]))
    deny("type/constant mismatch");
  const updated=[...states,rule.newValue];
  const newType="export type "+rule.type+" = "+
    updated.map(s=>'"'+s+'"').join(" | ")+";";
  const newConst="export const "+rule.constant+" = {\n"+
    updated.map((s,i)=>'  '+s+': "'+s+'"'+(i<updated.length-1?",":""))
      .join("\n")+
    "\n} as const satisfies Record<string, "+rule.type+">;";
  return source.replace(ts[0][0],newType).replace(cs[0][0],newConst);
}
