import { ToolResult } from "./types.js";
import { EvidenceEntry } from "./types.js";

export class McpAction {
  constructor() {}

  next(entry: EvidenceEntry, unresolvedBranchIds: string[]): string {
    if (entry.finalConclusion !== undefined) {
      return "Done. Return to sequentialthinking and finish";
    }

    if (entry.cycle === "proposed") {
      return `Inspect branch ${entry.branchId}, then call again with cycle=testing`;
    }

    if (entry.cycle === "testing" && entry.needsMoreInspect) {
      return `Continue inspecting branch ${entry.branchId}`;
    }

    const unresolved = unresolvedBranchIds;
    if (unresolved.length > 0) {
      return (
        `Resolve branches [${unresolved.join(", ")}] before finishing sequentialthinking. ` +
        "If they belong to an abandoned task, call cycle=proposed with newSession=true"
      );
    }

    return "All branches resolved. Call again with finalConclusion and needsMoreInspect=false";
  }

  failure(error: string): ToolResult {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error, status: "failed" }, null, 2),
        },
      ],
      isError: true,
    };
  }
}
