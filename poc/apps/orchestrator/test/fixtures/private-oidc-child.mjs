#!/usr/bin/env node
/**
 * OFFLINE integration fixture. Runs in a separate OS process from the
 * Engineer host and performs actual HTTPS/mTLS over the chosen interface.
 * ONLY the GitHub issuer response is mocked; this is never a workflow step.
 */
import {readFile} from "node:fs/promises";
import {submitProtectedPrivateRunnerAdmission}
  from "../../src/trusted-private-runner-oidc.mjs";
import {submitTrustedGithubOidcFromRunner}
  from "../../../../packages/orchestrator-runtime/src/trusted-github-oidc-submit.ts";

try{
  const path=process.env.PRIVATE_OIDC_OFFLINE_FIXTURE;
  if(!path)throw Error("offline fixture required");
  const {environment,oidcJwt}=JSON.parse(await readFile(path,"utf8"));
  const result=await submitProtectedPrivateRunnerAdmission({
    environment,
    submit:args=>submitTrustedGithubOidcFromRunner({
      ...args,
      // The GitHub OIDC endpoint is deliberately NOT contacted by offline CI.
      oidcFetchFn:async(_url,options)=>{
        if(options.redirect!=="error")
          throw Error("OIDC redirects forbidden");
        return new Response(JSON.stringify({value:oidcJwt}),{status:200});
      }
    })
  });
  process.stdout.write(JSON.stringify(result)+"\n");
}catch{
  process.stderr.write("Offline private runner admission denied\n");
  process.exitCode=1;
}
