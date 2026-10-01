import { describe, it, expect } from "vitest";
import { Cycle, EvidenceEntry } from "../models/types.js";
import { McpAction } from "../models/mcp_action.js";

const base: EvidenceEntry = {
  cycle: "testing",
  branchId: "1",
  sourceThoughtNumber: 1,
  claim: "X holds",
  inspection: "check X",
  claimBasis: "fact",
  needsMoreInspect: true,
};

const DONE = "Done. Return to sequentialthinking and finish";
const ALL_RESOLVED =
  "All branches resolved. Call again with finalConclusion and needsMoreInspect=false";

function resolveMessage(ids: string): string {
  return (
    `Resolve branches [${ids}] before finishing sequentialthinking. ` +
    "If they belong to an abandoned task, call cycle=proposed with newSession=true"
  );
}

function next(
  entry: Partial<EvidenceEntry>,
  unresolvedBranchIds: string[] = [],
): string {
  return new McpAction().next({ ...base, ...entry }, unresolvedBranchIds);
}

describe("McpAction", () => {
  describe("finalConclusion", () => {
    it("reports done", () => {
      expect(next({ cycle: "validated", finalConclusion: "done" })).toBe(DONE);
    });

    it.each<Cycle>(["proposed", "testing", "validated", "rejected"])(
      "takes precedence over cycle=%s and unresolved branches",
      (cycle) => {
        expect(next({ cycle, finalConclusion: "done" }, ["2"])).toBe(DONE);
      },
    );
  });

  describe("proposed", () => {
    it("asks to inspect the branch", () => {
      expect(next({ cycle: "proposed", branchId: "7" })).toBe(
        "Inspect branch 7, then call again with cycle=testing",
      );
    });

    it("asks to inspect even when other branches are unresolved", () => {
      expect(next({ cycle: "proposed" }, ["1", "2"])).toBe(
        "Inspect branch 1, then call again with cycle=testing",
      );
    });
  });

  describe("testing", () => {
    it("asks to continue while needsMoreInspect=true", () => {
      expect(next({ cycle: "testing", branchId: "7" }, ["7"])).toBe(
        "Continue inspecting branch 7",
      );
    });

    it("falls through to unresolved branches when needsMoreInspect=false", () => {
      expect(next({ cycle: "testing", needsMoreInspect: false }, ["1"])).toBe(
        resolveMessage("1"),
      );
    });
  });

  describe.each<Cycle>(["validated", "rejected"])("%s", (cycle) => {
    it("lists every unresolved branch in the given order", () => {
      expect(next({ cycle }, ["3", "2"])).toBe(resolveMessage("3, 2"));
    });

    it("asks for finalConclusion when nothing is unresolved", () => {
      expect(next({ cycle }, [])).toBe(ALL_RESOLVED);
    });

    it("ignores needsMoreInspect", () => {
      expect(next({ cycle, needsMoreInspect: true }, [])).toBe(ALL_RESOLVED);
      expect(next({ cycle, needsMoreInspect: false }, [])).toBe(ALL_RESOLVED);
    });
  });
});
