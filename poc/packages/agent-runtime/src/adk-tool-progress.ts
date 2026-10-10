import type {AdkControlledToolOutcome} from "./adk-specialized-agents.ts";

/**
 * Per-task, non-sensitive aggregate. Raw repository paths stay only in memory;
 * no credential, file content or model text is emitted to logs.
 */
export class AdkToolProgress {
  readonly #readPaths = new Set<string>();
  #successfulReads = 0;
  #failedReads = 0;
  #duplicateReads = 0;
  #successfulWrites = 0;
  #failedWrites = 0;

  observe(event: AdkControlledToolOutcome): void {
    if (event.name === "read_file") {
      if (!event.payload.ok) {
        this.#failedReads++;
        return;
      }
      this.#successfulReads++;
      const path = event.arguments.path;
      if (typeof path === "string") {
        if (this.#readPaths.has(path)) this.#duplicateReads++;
        this.#readPaths.add(path);
      }
      return;
    }
    if (event.name === "update_file" || event.name === "create_file") {
      if (event.payload.ok) this.#successfulWrites++;
      else this.#failedWrites++;
    }
  }

  snapshot(): {
    successful_reads: number;
    distinct_read_paths: number;
    duplicate_reads: number;
    failed_reads: number;
    successful_writes: number;
    failed_writes: number;
  } {
    return {
      successful_reads: this.#successfulReads,
      distinct_read_paths: this.#readPaths.size,
      duplicate_reads: this.#duplicateReads,
      failed_reads: this.#failedReads,
      successful_writes: this.#successfulWrites,
      failed_writes: this.#failedWrites
    };
  }
}
