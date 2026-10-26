/** Offline-only regression: the Engineer must see the entire proposed
 * work, dependencies and model uncertainties before signing.
 * Model-authored text is never parsed as HTML in the authenticated UI.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

test("authenticated Engineer review shows exact trusted plan details and uncertainty",async()=>{
  const [html,script]=await Promise.all([
    readFile(new URL("../../../workflow-ui/authenticated.html",import.meta.url),"utf8"),
    readFile(new URL("../../../workflow-ui/authenticated.js",import.meta.url),"utf8")
  ]);
  for(const id of ["requirement-view","digest","tasks","permissions",
    "assumptions","uncertainties","approve-button","reject-button"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing review UI field "+id);
  }
  assert.match(script,/task\.description/);
  assert.match(script,/input\.checked=false/);
  assert.match(script,/task\.depends_on/);
  assert.match(script,/plan\.assumptions/);
  assert.match(script,/plan\.uncertainties/);
  assert.match(script,/textContent\s*=/);
  assert.doesNotMatch(script,/\.(?:innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(script,/insertAdjacentHTML\s*\(/);
  assert.match(html,/rifiuta il piano e richiedi una nuova proposta/i);
  assert.match(script,/plan_digest:digest,approved_permission_ids:ids/);
  assert.match(script,/confirmation:\$\("confirmation"\)\.value/);
});
