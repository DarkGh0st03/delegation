import {Gemini,type BaseLlm} from "@google/adk";

/** Provider selection is explicit; never silently fall back to billable OpenAI. */
export function createGeminiAdkModel(input:{
  apiKey:string;
  model?:string;
}):BaseLlm{
  if(!input.apiKey?.trim())throw new Error("GEMINI_API_KEY is required for ADK Gemini");
  const model=input.model??"gemini-3.8-flash";
  if(!/^gemini-[a-z0-9.-]+$/u.test(model)){
    throw new Error("Invalid Gemini API model");
  }
  // Never use Vertex AI or Cloud service-account credentials in the model.
  return new Gemini({model,apiKey:input.apiKey,vertexai:false});
}
