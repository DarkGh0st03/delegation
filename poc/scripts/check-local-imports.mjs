import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule } from "node:vm";

// Parse without linking or evaluating: even paid entrypoints are safe to inspect.
// Scope: static runtime import/export specifiers in tracked/nonignored JS/TS source.
// Erased type-only imports, import(), runtime resources and package resolution
// remain covered by their tests/contracts, not by this check.
export function checkLocalImports(repositoryRoot, sourceFiles) {
  const root = resolve(repositoryRoot);
  const missing = [];
  let checkedFiles = 0;
  let localImports = 0;
  for (const source of [...sourceFiles].sort()) {
    const filename = resolve(root, source);
    // A removed source may still be in Git's index before git add/rm.
    if (!existsSync(filename)) continue;
    let parsed;
    try {
      const text = readFileSync(filename, "utf8");
      parsed = new SourceTextModule(
        filename.endsWith(".ts") ? stripTypeScriptTypes(text) : text,
        { identifier: filename }
      );
    } catch (error) {
      throw new Error(`Cannot parse ${source}: ${error.message}`, { cause: error });
    }
    checkedFiles += 1;
    for (const specifier of parsed.dependencySpecifiers) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      localImports += 1;
      const target = fileURLToPath(new URL(specifier, pathToFileURL(filename)));
      if (!existsSync(target) || !statSync(target).isFile()) {
        missing.push({ source, specifier, target: relative(root, target) });
      }
    }
  }
  return { checkedFiles, localImports, missing };
}

function main() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sourceFiles = execFileSync("git", [
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
    "*.ts", "*.mjs", "*.js"
  ], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const result = checkLocalImports(root, sourceFiles);
  for (const { source, specifier, target } of result.missing) {
    console.error(`${source}: missing static import ${specifier} (${target})`);
  }
  if (result.missing.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(`Local static import check passed: ${result.checkedFiles} files, ${result.localImports} relative imports.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
