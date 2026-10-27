/**
 * Test-only structured TypeScript controller transformation.
 *
 * Derives the actual output from the read_file content and instructions
 * included in a reviewed Task. No full implementation reference is consumed.
 * Not autonomous code generation or an authorization mechanism.
 */
const IDENT="[A-Za-z_$][\\w$]*";
const HANDLER=new RegExp("^CONTROLLER HANDLER ("+IDENT+") CALL ("+IDENT+")$","u");
const ERROR=new RegExp("^CONTROLLER ERROR ("+IDENT+") STATUS (4[0-9]{2}) CODE ([A-Z][A-Z0-9_]*)$","u");
const END_CONTROLLER="\n    }\n  };\n}";
const ERROR_ANCHOR="  if (error instanceof z.ZodError) {";
const SERVICE_IMPORT=/import \{([^}]+)\} from "\.\/user\.service\.js";/u;
function deny(reason){throw Error("Block B controller-derived NO-GO: "+reason);}
function single(text,needle){
  if(text.split(needle).length!==2)deny("missing or ambiguous anchor");
}
export function parseApprovedControllerInstructions(description){
  if(typeof description!=="string"||description.length>1800)
    deny("invalid approved Task description");
  const lines=description.split(/\r?\n/u).filter(x=>x.startsWith("CONTROLLER "));
  if(lines.length<2||lines.length>8)deny("missing controller directives");
  const handlers=[],errors=[],names=new Set();
  for(const line of lines){
    let match=line.match(HANDLER);
    if(match){
      if(names.has(match[1]))deny("duplicate handler");
      names.add(match[1]);
      handlers.push({handler:match[1],service:match[2]});
      continue;
    }
    match=line.match(ERROR);
    if(match){
      if(names.has(match[1]))deny("duplicate error mapping");
      names.add(match[1]);
      errors.push({type:match[1],status:Number(match[2]),code:match[3]});
      continue;
    }
    deny("invalid controller instruction");
  }
  if(handlers.length<1||errors.length!==1)
    deny("controller methods and explicit error mapping required");
  return Object.freeze({handlers:Object.freeze(handlers),
    errors:Object.freeze(errors)});
}
export function applyApprovedControllerInstructions(source,instructions){
  if(typeof source!=="string"||source.length<100||
     source.length>200000||!instructions||
     !Array.isArray(instructions.handlers)||
     !Array.isArray(instructions.errors)||
     instructions.handlers.length<1||instructions.handlers.length>6||
     instructions.errors.length!==1)
    deny("unrecognized source or rule set");
  single(source,END_CONTROLLER);
  single(source,ERROR_ANCHOR);
  const serviceImport=source.match(SERVICE_IMPORT);
  if(!serviceImport||source.match(new RegExp(SERVICE_IMPORT.source,"gu"))?.length!==1||
     !source.includes("export function createUserController(")||
     !source.includes("export function userErrorHandler("))
    deny("unrecognized service import or controller shape");
  const err=instructions.errors[0];
  const identifiers=[...instructions.handlers.flatMap(x=>[x.handler,x.service]),err.type];
  if(identifiers.some(x=>typeof x!=="string"||
     !new RegExp("^"+IDENT+"$","u").test(x)))
    deny("unsafe identifiers");
  if(!Number.isSafeInteger(err.status)||err.status<400||err.status>499||
     typeof err.code!=="string"||!/^[A-Z][A-Z0-9_]*$/u.test(err.code))
    deny("unsafe error mapping");
  for(const rule of instructions.handlers){
    if(source.includes(rule.handler+"(request: Request"))
      deny("handler already implemented");
  }
  if(source.includes("if (error instanceof "+err.type+")"))
    deny("error already handled");
  const existing=serviceImport[1].split(",").map(x=>x.trim()).filter(Boolean);
  if(existing.includes(err.type))deny("error import already present");
  const withImport=source.replace(SERVICE_IMPORT,
    'import { '+[...existing,err.type].join(", ")+' } from "./user.service.js";');
  const additions=instructions.handlers.map((rule,i)=>{
    const last=i===instructions.handlers.length-1;
    return [
      "    "+rule.handler+"(request: Request, response: Response, next: NextFunction): void {",
      "      try {",
      "        response.json(service."+rule.service+"(String(request.params.id)));",
      "      } catch (error) {",
      "        next(error);",
      "      }",
      "    }"+(last?"":",")
    ].join("\n");
  }).join("\n\n");
  const withMethods=withImport.replace(END_CONTROLLER,
    "\n    },\n\n"+additions+"\n  };\n}");
  const errorBlock=[
    "  if (error instanceof "+err.type+") {",
    "    response.status("+err.status+").json({",
    '      code: "'+err.code+'",',
    "      message: error.message",
    "    });",
    "    return;",
    "  }",
    ""
  ].join("\n");
  return withMethods.replace(ERROR_ANCHOR,errorBlock+"\n"+ERROR_ANCHOR);
}
