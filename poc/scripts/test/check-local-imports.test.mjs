import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkLocalImports } from "../check-local-imports.mjs";

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "delegation-import-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

test("checks TS imports and re-exports without evaluating source or dependencies", t => {
  const root = fixture(t, {
    "entry.ts": `import { value, type Value } from "./value.ts";
      export * from "./provider.mjs";
      const typed: Value = value;
      throw new Error("entrypoint must never run");`,
    "value.ts": "export type Value = number; export const value: Value = 1;",
    "provider.mjs": "throw new Error('provider must never run');"
  });
  assert.deepEqual(checkLocalImports(root, ["entry.ts"]), {
    checkedFiles: 1, localImports: 2, missing: []
  });
});

test("rejects deleting a script fixture still imported by an offline test", t => {
  const root = fixture(t, {
    "test/errors.test.ts": "import { smoke } from '../scripts/gemini-api-health-smoke.mjs';",
    "scripts/gemini-api-health-smoke.mjs": "export const smoke = () => {};"
  });
  assert.equal(checkLocalImports(root, ["test/errors.test.ts"]).missing.length, 0);
  rmSync(join(root, "scripts/gemini-api-health-smoke.mjs"));
  assert.deepEqual(checkLocalImports(root, ["test/errors.test.ts"]).missing, [{
    source: "test/errors.test.ts",
    specifier: "../scripts/gemini-api-health-smoke.mjs",
    target: "scripts/gemini-api-health-smoke.mjs"
  }]);
});

test("ignores apparent imports in comments, generated strings and templates", t => {
  const root = fixture(t, {
    "fixture.mjs": `// import './missing-comment.ts';
      /* export * from './missing-block.ts'; */
      const generated = "import value from './missing-generated.ts';";
      const template = \`export * from './missing-template.ts';\`;
      const pattern = /import.*missing-regex/;`
  });
  assert.deepEqual(checkLocalImports(root, ["fixture.mjs"]), {
    checkedFiles: 1, localImports: 0, missing: []
  });
});

test("checks side-effect imports and rejects directory import targets", t => {
  const root = fixture(t, {
    "entry.mjs": "import './directory'; import './missing.mjs';",
    "directory/file.mjs": "export const present = true;"
  });
  assert.deepEqual(checkLocalImports(root, ["entry.mjs"]).missing.map(x => x.specifier),
    ["./directory", "./missing.mjs"]);
});

test("reports the source filename when syntax cannot be parsed", t => {
  const root = fixture(t, { "broken.mjs": "export const = ;" });
  assert.throws(() => checkLocalImports(root, ["broken.mjs"]), /Cannot parse broken\.mjs:/u);
});

test("makes its limits explicit for type-only imports, dynamic imports and resources", t => {
  const root = fixture(t, {
    "entry.ts": `import type { MissingType } from './missing-type.ts';
      const lazy = () => import('./missing-dynamic.ts');
      const resource = new URL('./missing-resource.json', import.meta.url);`
  });
  assert.deepEqual(checkLocalImports(root, ["entry.ts"]), {
    checkedFiles: 1, localImports: 0, missing: []
  });
});
