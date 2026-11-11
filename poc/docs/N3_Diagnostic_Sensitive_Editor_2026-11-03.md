# N3 — diagnostic-sensitive scripted Backend editor, no model billing

Framework parent: 8335f83742b1cec5a0266235f7868c17c826a031.

## Experimental question

Does the verified TypeScript diagnostic reaching an actual Backend ADK
generateContentAsync boundary affect the test editor's choice to edit,
rather than merely locating a known injected marker?

## Controlled regression

- Retain a Runner typecheck-failure log and its manifest/hash, bind it to
  the tested SHA and original root/role read scope, then project it to a
  fresh repair Task.
- Send the actual protected task instruction to a real ADK Backend Runner
  with a deliberately deterministic BaseLlm (zero provider calls).
- Hold source bytes, branch, signed tool hints and Gateway stub constant;
  vary only the trusted TS2724 compiler *message*.
- When the message matches the wrong symbol in the actually read source,
  the scripted model requests read_file and update_file using the source
  returned by the Gateway stub, not a prepackaged replacement file.
- With a different compiler symbol or no D1 diagnostic read grant, no edit
  is requested. Unrelated private log text never reaches the model.
- This test neither compiles the resulting edit nor attests a real provider
  write, signed epoch admission, fresh Docker PASS or generative reasoning.
  The existing TS2724 real-Docker test covers independent provider/runner
  controls with a fixture-aware scripted editor.

N3 remains appropriately bounded: positive tool/diagnostic dependency is
a contract regression, not evidence that Gemini independently fixes an
unseen import/export error. No Planner changes, grant expansions or paid
workflow changes. Running this CI test should not trigger the costly
Functional Signed DAG checkpoint.
