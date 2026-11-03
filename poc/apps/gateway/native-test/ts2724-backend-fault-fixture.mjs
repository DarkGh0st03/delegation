/**
 * Deterministic zero-billing TS2724 regression, never Gemini output.
 * The fake import is deliberately close to an actually exported shared
 * symbol. Only a Backend file already signed for read/update may receive it.
 */
export const TS2724_BACKEND_IMPORT_FAULT =
  '\nimport { ACCOUNT_STATU } from "@iam/shared";\n';
export function injectTs2724BackendImportFault(source){
  if(typeof source!=="string"||!source.trim()||
     source.includes(TS2724_BACKEND_IMPORT_FAULT)||
     source.includes("ACCOUNT_STATU }"))
    throw Error("TS2724 offline fault injection NO-GO");
  return source+TS2724_BACKEND_IMPORT_FAULT;
}
export function repairTs2724BackendImportFault(source){
  if(typeof source!=="string"||
     source.split(TS2724_BACKEND_IMPORT_FAULT).length!==2)
    throw Error("TS2724 offline observed repair NO-GO");
  return source.replace(TS2724_BACKEND_IMPORT_FAULT,"\n");
}
