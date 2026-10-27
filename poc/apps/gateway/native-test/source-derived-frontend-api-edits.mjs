/**
 * Deterministic offline Frontend API transform: actual source + approved Task.
 * It is not an autonomous programmer or authority enforcement.
 */
const DIRECTIVE=/^API ACTION ([A-Za-z_$][\w$]*) (GET|POST|PATCH|PUT|DELETE) (\/[a-z][a-z0-9-]*)$/u;
function deny(reason){throw Error("Source-derived frontend API NO-GO: "+reason);}
export function parseApprovedApiActions(task){
  if(typeof task!=="string"||task.length>1800)deny("missing approved Task");
  const lines=task.split(/\r?\n/u).filter(s=>s.startsWith("API "));
  if(!lines.length||lines.length>6)deny("bad API directive count");
  const actions=lines.map(line=>{
    const m=line.match(DIRECTIVE);
    if(!m)deny("unrecognized API directive");
    return Object.freeze({name:m[1],method:m[2],suffix:m[3]});
  });
  if(new Set(actions.map(x=>x.name)).size!==actions.length||
     new Set(actions.map(x=>x.method+" "+x.suffix)).size!==actions.length)
    deny("duplicate endpoint or function");
  return Object.freeze(actions);
}
export function applyApprovedApiActions(source,actions){
  if(typeof source!=="string"||source.length<180||source.length>200000||
     !Array.isArray(actions)||actions.length<1||actions.length>6||
     !source.includes("async function parseResponse<T>(")||
     !source.includes("const ADMIN_HEADERS = {")||
     !source.includes("UserDetails")||
     !source.includes('from "@iam/shared"'))
    deny("invalid or unrecognized source");
  const tick=String.fromCharCode(96);
  const interpolation=String.fromCharCode(36)+"{encodeURIComponent(id)}";
  const begin="await fetch("+tick,end=interpolation+tick+",";
  const matches=source.split("\n").filter(s=>s.includes(begin)&&s.includes(end));
  if(matches.length!==1)deny("missing or ambiguous existing getUser endpoint");
  const line=matches[0],from=line.indexOf(begin)+begin.length;
  const base=line.slice(from,line.indexOf(end,from));
  if(!/^\/[a-zA-Z0-9_/-]+\/$/u.test(base)||base.includes("//")||
     base.includes(".."))deny("unsafe inferred endpoint");
  const functions=actions.map(a=>{
    if(!a||!DIRECTIVE.test("API ACTION "+a.name+" "+a.method+" "+a.suffix)||
       source.includes("export async function "+a.name+"("))
      deny("unapproved or already implemented function");
    return [
      "export async function "+a.name+"(id: string): Promise<UserDetails> {",
      "  return parseResponse<UserDetails>(",
      "    await fetch("+tick+base+interpolation+a.suffix+tick+", {",
      '      method: "'+a.method+'",',
      "      headers: ADMIN_HEADERS",
      "    })",
      "  );",
      "}"
    ].join("\n");
  });
  return source+(source.endsWith("\n")?"\n":"\n\n")+
    functions.join("\n\n")+"\n";
}
