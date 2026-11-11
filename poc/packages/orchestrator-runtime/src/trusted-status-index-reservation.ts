import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open} from "node:fs/promises";
import {join} from "node:path";

/** Callers validate the private reservation directory and canonical status entry.
 * A failed write or sync keeps the tombstone and cannot permit index reuse. */
export async function persistStatusIndexReservation(
 directory:string,listUri:string,index:string,record:Readonly<Record<string,unknown>>
):Promise<void>{
 const token=createHash("sha256").update(listUri+"\n"+index).digest("hex");
 let fd;
 try{
  fd=await open(join(directory,token+".reservation.json"),
   constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  await fd.writeFile(JSON.stringify(record)+"\n","utf8");
  await fd.sync();
 }catch{
  throw Error("Status List index already reserved or persistence unconfirmed");
 }finally{await fd?.close();}
 let directoryFd;
 try{
  directoryFd=await open(directory,
   constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  await directoryFd.sync();
 }catch{
  throw Error("Status List reservation durability unconfirmed");
 }finally{await directoryFd?.close();}
}
