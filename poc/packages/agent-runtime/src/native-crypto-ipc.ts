import {createConnection} from "node:net";

/**
 * Private trusted-owner transport to the SINGLE Rust CryptoRuntime.
 * No HTTP Adapter, MCP worker, model-accessible tool or duplicate signer.
 * Rust authenticates the per-role bearer and enforces Core capabilities.
 * The signed VP/credential stays inside its caller's private process.
 */
export async function invokeNativeCrypto(
 config:{socketPath:string;token:string;timeoutMs?:number},
 operation:"issue_child"|"create_presentation"|"read_issued_root"|"read_credential_status",body:unknown
):Promise<unknown>{
 const {socketPath,token}=config,timeout=config.timeoutMs??10_000;
 if(typeof socketPath!=="string"||!socketPath.startsWith("/")||
    socketPath.trim()!==socketPath||socketPath.length>100||
    !token||typeof token!=="string"||token.length>8192||
    !Number.isSafeInteger(timeout)||timeout<1||timeout>120_000)
  throw Error("Native Rust cryptographic transport unavailable");
 const request=JSON.stringify({token,operation,body});
 if(Buffer.byteLength(request)>128*1024)
  throw Error("Native Rust cryptographic request too large");
 return new Promise((resolve,reject)=>{
  let settled=false,total=0;
  const chunks:Buffer[]=[];
  const socket=createConnection({path:socketPath,allowHalfOpen:true});
  const done=(error?:Error,result?:unknown)=>{
   if(settled)return;
   settled=true;socket.destroy();
   if(error)reject(error);else resolve(result);
  };
  socket.setTimeout(timeout,()=>done(Error("Native Rust cryptographic transport unavailable")));
  socket.once("connect",()=>socket.end(request));
  socket.on("data",(bytes:Buffer)=>{
   if(settled)return;
   total+=bytes.length;
   if(total>1024*1024)
    done(Error("Native Rust cryptographic response too large"));
   else chunks.push(bytes);
  });
  socket.once("end",()=>{
   if(settled)return;
   try{
    const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
       (parsed as Record<string,unknown>).ok!==true||
       !(parsed as Record<string,unknown>).result||
       typeof (parsed as Record<string,unknown>).result!=="object"||
       Array.isArray((parsed as Record<string,unknown>).result))
     throw Error("denied");
    done(undefined,(parsed as {result:unknown}).result);
   }catch{done(Error("Native Rust cryptographic authorization denied"));}
  });
  socket.once("error",()=>done(Error("Native Rust cryptographic transport unavailable")));
 });
}
