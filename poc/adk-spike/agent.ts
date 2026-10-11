// Isolated Phase 1 ADK compatibility spike. No repository, Gateway, or Rust access.
// Do not import delegation evidence, secrets, or the legacy AgentController.
import { LlmAgent } from "@google/adk";

export const rootAgent = new LlmAgent({
  name: "thesis_adk_spike",
  description: "Minimal independent ADK runtime smoke agent for the thesis PoC.",
  model: "gemini-flash-latest",
  instruction:
    "You are an isolated ADK integration smoke agent. Respond briefly to " +
    "a simple greeting. You have no tools or delegated authority.",
  tools: []
});
