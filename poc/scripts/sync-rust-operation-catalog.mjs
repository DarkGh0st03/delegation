/**
 * Synchronize TypeScript operation names with the authoritative Rust enum.
 * node poc/scripts/sync-rust-operation-catalog.mjs --check|--write
 */
import { readFileSync, writeFileSync } from "node:fs";

const rustPath = new URL("../../src/delegation/authorization/operation.rs", import.meta.url);
const generatedPath = new URL("../apps/gateway/src/operation-catalog.ts", import.meta.url);
const rust = readFileSync(rustPath, "utf8");
const enumMatch = rust.match(/pub enum Operation\s*\{([^}]+)\}/u);
const mappingMatch = rust.match(/pub fn as_str\(&self\)[^{]*\{[\s\S]*?match self \{([\s\S]*?)\n\s*\}/u);

if (!enumMatch || !mappingMatch) {
  throw new Error("Unable to locate authoritative Rust Operation enum and as_str mapping");
}
const variants = [...enumMatch[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*,\s*$/gmu)].map((m) => m[1]);
const mappings = [...mappingMatch[1].matchAll(/Self::([A-Za-z][A-Za-z0-9_]*)\s*=>\s*"([a-z][a-z0-9_]*)"/gu)];
const mappedVariants = mappings.map((m) => m[1]);
const operations = mappings.map((m) => m[2]);
if (variants.length === 0 || variants.length !== mappings.length ||
    new Set(variants).size !== variants.length ||
    new Set(operations).size !== operations.length ||
    variants.some((v, i) => mappedVariants[i] !== v)) {
  throw new Error("Rust Operation/as_str mismatch; explicit review required before synchronization");
}
const generated = [
  "/**",
  " * GENERATED from src/delegation/authorization/operation.rs.",
  " * Run: node poc/scripts/sync-rust-operation-catalog.mjs --write",
  " * Never treat catalog membership as a permission or as provider support.",
  " */",
  "export const RUST_OPERATIONS = [",
  ...operations.map((operation) => '  "' + operation + '",'),
  "] as const;",
  "",
  "export type Operation = (typeof RUST_OPERATIONS)[number];",
  "",
  "export function isRustOperation(value: unknown): value is Operation {",
  "  return typeof value === \"string\" &&",
  "    (RUST_OPERATIONS as readonly string[]).includes(value);",
  "}",
  ""
].join("\n");

const mode = process.argv[2];
if (mode === "--check") {
  if (readFileSync(generatedPath, "utf8") !== generated) {
    throw new Error("Gateway operation catalog differs from Rust; run --write and review diff");
  }
  process.stdout.write("Operation catalog matches Rust (" + operations.length + " operations)\n");
} else if (mode === "--write") {
  writeFileSync(generatedPath, generated, "utf8");
  process.stdout.write("Generated " + operations.length + " operation names\n");
} else {
  throw new Error("Specify exactly --check or --write");
}
