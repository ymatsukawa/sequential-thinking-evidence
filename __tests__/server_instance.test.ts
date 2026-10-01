import { describe, it, expect } from "vitest";
import { EvidenceEntry, EvidenceItem } from "../models/types.js";
import { ServerInstance } from "../models/server_instance.js";

const base: EvidenceEntry = {
  cycle: "proposed",
  branchId: "1",
  sourceThoughtNumber: 1,
  claim: "X holds",
  inspection: "check X",
  claimBasis: "fact",
  needsMoreInspect: true,
};

const evidence: EvidenceItem[] = [
  { kind: "measured", ref: "npm test", summary: "ok" },
];

function seeded(...entries: Partial<EvidenceEntry>[]): ServerInstance {
  const instance = new ServerInstance();
  entries.forEach((e) => instance.append({ ...base, ...e }));
  return instance;
}

describe("ServerInstance", () => {
  describe("empty state", () => {
    it("has no history and no branches", () => {
      const instance = new ServerInstance();
      expect(instance.historyLength()).toBe(0);
      expect(instance.branchIds()).toEqual([]);
      expect(instance.branchSummaries()).toEqual([]);
      expect(instance.unresolvedBranchIds()).toEqual([]);
    });

    it("returns undefined / new / [] for an unknown branch", () => {
      const instance = new ServerInstance();
      expect(instance.first("1")).toBeUndefined();
      expect(instance.latest("1")).toBeUndefined();
      expect(instance.currentCycle("1")).toBe("new");
      expect(instance.evidenceOf("1")).toEqual([]);
    });
  });

  describe("append", () => {
    it("records history across branches and groups entries by branch", () => {
      const instance = seeded({}, { branchId: "2" }, { cycle: "testing" });
      expect(instance.historyLength()).toBe(3);
      expect(instance.branchIds()).toEqual(["1", "2"]);
    });
  });

  describe("first / latest / currentCycle", () => {
    it("returns the first and last entries of a branch", () => {
      const instance = seeded(
        {},
        { cycle: "testing", inspection: "second" },
        { cycle: "validated", inspection: "third", evidence },
      );
      expect(instance.first("1")?.cycle).toBe("proposed");
      expect(instance.latest("1")?.inspection).toBe("third");
      expect(instance.currentCycle("1")).toBe("validated");
    });
  });

  describe("evidenceOf", () => {
    it("accumulates evidence of every entry on the branch", () => {
      const instance = seeded(
        {},
        { cycle: "testing", evidence },
        { cycle: "testing", evidence: [...evidence, ...evidence] },
      );
      expect(instance.evidenceOf("1")).toHaveLength(3);
    });

    it("does not share evidence between branches", () => {
      const instance = seeded(
        {},
        { cycle: "testing", evidence },
        { branchId: "2" },
      );
      expect(instance.evidenceOf("2")).toEqual([]);
    });
  });

  describe("unresolvedBranchIds", () => {
    it("lists branches in proposed or testing", () => {
      const instance = seeded(
        {},
        { branchId: "2" },
        { branchId: "2", cycle: "testing" },
        { branchId: "3" },
        { branchId: "3", cycle: "rejected", rejectionReason: "r" },
      );
      expect(instance.unresolvedBranchIds()).toEqual(["1", "2"]);
    });

    it("applies the pending entry's cycle to its branch", () => {
      const instance = seeded({}, { cycle: "testing" });
      expect(
        instance.unresolvedBranchIds({ ...base, cycle: "validated" }),
      ).toEqual([]);
    });

    it("includes a pending entry on a new branch", () => {
      const instance = new ServerInstance();
      expect(instance.unresolvedBranchIds({ ...base, branchId: "9" })).toEqual([
        "9",
      ]);
    });
  });

  describe("branchSummaries", () => {
    it("summarizes the latest entry and evidence count of each branch", () => {
      const instance = seeded(
        {},
        { cycle: "testing", evidence, claimBasis: "inference" },
        { branchId: "2", claim: "Y holds", sourceThoughtNumber: 2 },
      );
      expect(instance.branchSummaries()).toEqual([
        {
          branchId: "1",
          cycle: "testing",
          claim: "X holds",
          sourceThoughtNumber: 1,
          claimBasis: "inference",
          evidenceCount: 1,
        },
        {
          branchId: "2",
          cycle: "proposed",
          claim: "Y holds",
          sourceThoughtNumber: 2,
          claimBasis: "fact",
          evidenceCount: 0,
        },
      ]);
    });
  });
});
