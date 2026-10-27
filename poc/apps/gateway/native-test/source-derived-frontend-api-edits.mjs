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
  const templateLines=source.split("\n").filter(s=>
    s.includes(begin)&&s.includes(end));
  const concatenated=[...source.matchAll(
    /await fetch\(\s*"([^"\r\n]+)"\s*\+\s*encodeURIComponent\(id\)\s*,/gu
  )];
  // The actual IAM baseline uses "/api/users/" + encodeURIComponent(id),
  // while other valid TypeScript sources may use a template literal.
  // Both are parsed strictly: exactly one trusted, local user endpoint.
  if(templateLines.length+concatenated.length!==1)
    deny("missing or ambiguous existing getUser endpoint");
  let base,expressionStyle;
  if(templateLines.length){
    const line=templateLines[0],from=line.indexOf(begin)+begin.length;
    base=line.slice(from,line.indexOf(end,from));
    expressionStyle="template";
  }else{
    base=concatenated[0][1];
    expressionStyle="concatenated";
  }
  if(!/^\/[a-zA-Z0-9_/-]+\/$/u.test(base)||base.includes("//")||
     base.includes(".."))deny("unsafe inferred endpoint");
  const functions=actions.map(a=>{
    if(!a||!DIRECTIVE.test("API ACTION "+a.name+" "+a.method+" "+a.suffix)||
       source.includes("export async function "+a.name+"("))
      deny("unapproved or already implemented function");
    const target=expressionStyle==="template"
      ?tick+base+interpolation+a.suffix+tick
      :'"'+base+'" + encodeURIComponent(id) + "'+a.suffix+'"';
    return [
      "export async function "+a.name+"(id: string): Promise<UserDetails> {",
      "  return parseResponse<UserDetails>(",
      "    await fetch("+target+", {",
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
