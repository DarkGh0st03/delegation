import {createConnection} from "node:net";

/**
 * Shared owner-private IPC wire to the ONE Rust CryptoRuntime.
 * No extra signer, HTTP endpoint, public MCP endpoint or model tool.
 * Both the native Agent port and the isolated private MCP worker use
 * this single bounded, role-authenticated wire implementation.
 */
export async function invokeNativeCryptoWire(
 config,operation,body
){
 const {socketPath,token}=config,timeout=config.timeoutMs??10000;
 if(typeof socketPath!=="string"||!socketPath.startsWith("/")||
    socketPath.trim()!==socketPath||socketPath.length>100||
    !token||typeof token!=="string"||token.length>8192||
    !Number.isSafeInteger(timeout)||timeout<1||timeout>120000)
  throw Error("Native Rust cryptographic transport unavailable");
 if(!["issue_child","create_presentation","read_issued_root",
       "read_credential_status"].includes(operation))
  throw Error("Native Rust cryptographic transport unavailable");
 const request=JSON.stringify({token,operation,body});
 if(Buffer.byteLength(request)>128*1024)
  throw Error("Native Rust cryptographic request too large");
 return new Promise((resolve,reject)=>{
  let settled=false,total=0;
  const chunks=[];
  const socket=createConnection({path:socketPath,allowHalfOpen:true});
  const done=(error,result)=>{
   if(settled)return;
   settled=true;socket.destroy();
   if(error)reject(error);else resolve(result);
  };
  socket.setTimeout(timeout,()=>
   done(Error("Native Rust cryptographic transport unavailable")));
  socket.once("connect",()=>socket.end(request));
  socket.on("data",bytes=>{
   if(settled)return;
   total+=bytes.length;
   if(total>1024*1024)
    done(Error("Native Rust cryptographic response too large"));
   else chunks.push(bytes);
  });
  socket.once("end",()=>{
   if(settled)return;
   try{
    const parsed=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
       parsed.ok!==true||!parsed.result||
       typeof parsed.result!=="object"||Array.isArray(parsed.result))
     throw Error("denied");
    done(undefined,parsed.result);
   }catch{done(Error("Native Rust cryptographic authorization denied"));}
  });
  socket.once("error",()=>done(
   Error("Native Rust cryptographic transport unavailable")));
 });
}
