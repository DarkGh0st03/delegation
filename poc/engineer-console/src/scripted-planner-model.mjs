/**
 * FREE, deterministic stand-in for the Planning model (no AI, no provider).
 *
 * It drives the real read-only Planner protocol: first it asks to read one
 * repository file (the read goes through the real Gateway: preliminary Root,
 * VP, Rust verification, OPA, Gitea), then it returns a permission proposal.
 * Files are chosen by matching words of the requirement against file paths.
 * The proposal states explicitly that it was simulated.
 */
import {BaseLlm} from "@google/adk";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|rb|php|cs|css|scss|html|vue|svelte)$/u;
const STOP = new Set(["allow", "from", "with", "that", "this", "into",
  "should", "must", "able", "using", "when", "page", "make", "have", "also", "their"]);

function keywords(requirement) {
  const words = requirement.toLowerCase().match(/[a-z]{4,}/gu) ?? [];
  const stems = new Set();
  for (const word of words) {
    if (STOP.has(word)) continue;
    stems.add(word.replace(/(ations|ation|ing|ed|es|s)$/u, "").slice(0, 7));
  }
  return [...stems].filter(s => s.length >= 4);
}

/** Pure selection, exported for tests. */
export function selectPlanningFiles(files, requirement, limit = 12) {
  const keys = keywords(requirement);
  const scored = files.filter(f => CODE.test(f)).map(file => {
    const lower = file.toLowerCase();
    return {file, score: keys.reduce((n, k) => n + (lower.includes(k) ? 1 : 0), 0)};
  });
  let chosen = scored.filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit).map(s => s.file);
  if (!chosen.length) chosen = scored.map(s => s.file).sort().slice(0, Math.min(limit, 6));
  return chosen.sort();
}

export function scriptedProposal(files) {
  return {
    requested_permissions: [
      {operation: "create_branch", resource_type: "repository", path: null},
      {operation: "create_pull_request", resource_type: "repository", path: null},
      {operation: "run_tests", resource_type: "branch", path: null},
      ...files.flatMap(path => [
        {operation: "read_file", resource_type: "file", path},
        {operation: "update_file", resource_type: "file", path}
      ])
    ],
    assumptions: ["Proposta SIMULATA: nessun modello di IA è stato usato. I file sono " +
      "scelti confrontando le parole del requisito con i percorsi della repository."],
    uncertainties: ["La selezione per parole chiave può includere file superflui o " +
      "ometterne di necessari: l'Engineer deve rivedere ogni permesso."]
  };
}

export class ScriptedPlannerModel extends BaseLlm {
  #files; #readTarget; calls = 0;
  constructor({snapshotFiles, requirement}) {
    super({model: "scripted-planner-no-ai"});
    this.#files = selectPlanningFiles(snapshotFiles, requirement);
    this.#readTarget = this.#files[0] ??
      snapshotFiles.find(f => /^readme/iu.test(f)) ?? snapshotFiles[0];
  }
  get selectedFiles() { return [...this.#files]; }

  async *generateContentAsync() {
    this.calls++;
    if (this.calls === 1 && this.#readTarget) {
      yield {content: {role: "model", parts: [{functionCall: {
        id: "scripted-source-read", name: "read_file",
        args: {branch: "main", path: this.#readTarget}}}]}};
      return;
    }
    yield {content: {role: "model", parts: [{text: JSON.stringify(scriptedProposal(this.#files))}]}};
  }

  connect() { throw Error("Scripted planner has no live connection"); }
}
