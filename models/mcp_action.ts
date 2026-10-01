import { RET_VAL } from "../const/return_value.js";
import { EvidenceEntry, ToolResult } from "./types.js";

export class McpAction {
  next(entry: EvidenceEntry, unresolvedBranchIds: string[]): string {
    if (entry.finalConclusion !== undefined) {
      return RET_VAL.mcp_action.next.done;
    }

    if (entry.cycle === "proposed") {
      return RET_VAL.mcp_action.next.inspect(entry.branchId);
    }

    if (entry.cycle === "testing" && entry.needsMoreInspect) {
      return RET_VAL.mcp_action.next.continue_inspect(entry.branchId);
    }

    if (unresolvedBranchIds.length > 0) {
      return RET_VAL.mcp_action.next.resolve_unresolved(
        unresolvedBranchIds.join(", "),
      );
    }

    return RET_VAL.mcp_action.next.all_resolved;
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
