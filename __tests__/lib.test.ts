import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EvidenceServer,
  EvidenceEntry,
  EvidenceItem,
  EvidenceResponse,
  Cycle,
} from "../lib.js";

// Mock chalk to avoid ESM issues
vi.mock("chalk", () => {
  const chalkMock = {
    yellow: (str: string) => str,
    green: (str: string) => str,
    blue: (str: string) => str,
    red: (str: string) => str,
  };
  return {
    default: chalkMock,
  };
});

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

function parse(
  result: ReturnType<EvidenceServer["processEntry"]>,
): EvidenceResponse {
  return JSON.parse(result.content[0].text) as EvidenceResponse;
}

/** Build a server whose branch "1" is currently in `prev` (or absent when "new"). */
function seeded(prev: Cycle | "new"): EvidenceServer {
  const server = new EvidenceServer();
  if (prev === "new") return server;
  const steps: Record<Cycle, EvidenceEntry[]> = {
    proposed: [{ ...base, cycle: "proposed" }],
    testing: [
      { ...base, cycle: "proposed" },
      { ...base, cycle: "testing" },
    ],
    validated: [
      { ...base, cycle: "proposed" },
      { ...base, cycle: "testing" },
      { ...base, cycle: "validated", evidence },
    ],
    rejected: [
      { ...base, cycle: "proposed" },
      { ...base, cycle: "testing" },
      { ...base, cycle: "rejected", rejectionReason: "no" },
    ],
  };
  for (const step of steps[prev]) {
    const r = server.processEntry(step);
    if (r.isError) throw new Error(`seed failed: ${r.content[0].text}`);
  }
  return server;
}

describe("EvidenceServer", () => {
  beforeEach(() => {
    process.env.DISABLE_EVIDENCE_LOGGING = "true";
  });

  afterEach(() => {
    delete process.env.DISABLE_EVIDENCE_LOGGING;
  });

  describe("transition table", () => {
    it.each<[Cycle | "new", Cycle, boolean]>([
      ["new", "proposed", true],
      ["new", "testing", false],
      ["new", "validated", false],
      ["new", "rejected", false],
      ["proposed", "proposed", false],
      ["proposed", "testing", true],
      ["proposed", "validated", false],
      ["proposed", "rejected", true],
      ["testing", "proposed", false],
      ["testing", "testing", true],
      ["testing", "validated", true],
      ["testing", "rejected", true],
      ["validated", "proposed", false],
      ["validated", "testing", true],
      ["validated", "validated", true],
      ["validated", "rejected", false],
      ["rejected", "proposed", false],
      ["rejected", "testing", true],
      ["rejected", "validated", false],
      ["rejected", "rejected", true],
    ])("%s -> %s allowed=%s", (prev, next, allowed) => {
      const server = seeded(prev);
      const result = server.processEntry({
        ...base,
        cycle: next,
        evidence,
        rejectionReason: "r",
      });
      expect(Boolean(result.isError)).toBe(!allowed);
      if (!allowed) {
        expect(result.content[0].text).toContain("Invalid transition");
      }
    });
  });

  describe("required conditions", () => {
    it("rejects validated without evidence", () => {
      const server = seeded("testing");
      const result = server.processEntry({ ...base, cycle: "validated" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("at least one evidence");
    });

    it("rejects validated with empty evidence array", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence: [],
      });
      expect(result.isError).toBe(true);
    });

    it.each(["assumption", "opinion"] as const)(
      "rejects validated with claimBasis=%s",
      (claimBasis) => {
        const server = seeded("testing");
        const result = server.processEntry({
          ...base,
          cycle: "validated",
          evidence,
          claimBasis,
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(
          "validated requires claimBasis=fact or inference",
        );
      },
    );

    it("rejects validated with only guessed evidence", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence: [
          { kind: "guessed", summary: "follows from A" },
          { kind: "guessed", summary: "follows from B" },
        ],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "validated requires at least one non-guessed evidence",
      );
    });

    it("accepts validated with guessed plus non-guessed evidence", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence: [
          { kind: "guessed", summary: "follows from A" },
          { kind: "observed", ref: "server.log", summary: "seen in logs" },
        ],
      });
      expect(result.isError).toBeUndefined();
    });

    it("accepts validated with claimBasis=inference", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        claimBasis: "inference",
      });
      expect(result.isError).toBeUndefined();
    });

    it("rejects rejected without rejectionReason", () => {
      const server = seeded("testing");
      const result = server.processEntry({ ...base, cycle: "rejected" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("rejectionReason");
    });

    it("rejects blank rejectionReason", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "rejected",
        rejectionReason: "   ",
      });
      expect(result.isError).toBe(true);
    });

    it("rejects derivedFromBranchId that does not exist", () => {
      const server = new EvidenceServer();
      const result = server.processEntry({ ...base, derivedFromBranchId: "9" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not exist");
    });

    it("rejects derivedFromBranchId equal to branchId", () => {
      const server = seeded("validated");
      const result = server.processEntry({
        ...base,
        branchId: "2",
        derivedFromBranchId: "2",
      });
      expect(result.isError).toBe(true);
    });

    it("accepts derivedFromBranchId of an existing branch", () => {
      const server = seeded("rejected");
      const result = server.processEntry({
        ...base,
        branchId: "2",
        derivedFromBranchId: "1",
      });
      expect(result.isError).toBeUndefined();
    });

    it("rejects finalConclusion while branches are unresolved", () => {
      const server = seeded("validated");
      server.processEntry({ ...base, branchId: "2" });
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        needsMoreInspect: false,
        finalConclusion: "done",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "finalConclusion is not allowed",
      );
      expect(result.content[0].text).toContain("[2]");
    });

    it("rejects needsMoreInspect=false while other branches are unresolved", () => {
      const server = seeded("testing");
      server.processEntry({ ...base, branchId: "2" });
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        needsMoreInspect: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("needsMoreInspect=false");
    });

    it("rejects needsMoreInspect=false on a testing entry (its own branch is unresolved)", () => {
      const server = seeded("proposed");
      const result = server.processEntry({
        ...base,
        cycle: "testing",
        needsMoreInspect: false,
      });
      expect(result.isError).toBe(true);
    });

    it("does not record a rejected entry", () => {
      const server = seeded("proposed");
      server.processEntry({ ...base, cycle: "validated" });
      const ok = server.processEntry({ ...base, cycle: "testing" });
      expect(parse(ok).historyLength).toBe(2);
    });
  });

  describe("response", () => {
    it("returns branch summaries and unresolved ids", () => {
      const server = seeded("validated");
      const result = server.processEntry({
        ...base,
        branchId: "2",
        sourceThoughtNumber: 4,
        claim: "Y",
      });
      const data = parse(result);
      expect(data.branchId).toBe("2");
      expect(data.cycle).toBe("proposed");
      expect(data.historyLength).toBe(4);
      expect(data.unresolvedBranchIds).toEqual(["2"]);
      expect(data.branches).toEqual([
        {
          branchId: "1",
          cycle: "validated",
          claim: "X holds",
          sourceThoughtNumber: 1,
          claimBasis: "fact",
          evidenceCount: 1,
        },
        {
          branchId: "2",
          cycle: "proposed",
          claim: "Y",
          sourceThoughtNumber: 4,
          claimBasis: "fact",
          evidenceCount: 0,
        },
      ]);
    });

    it("includes claimBasis in the summary", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        claimBasis: "inference",
        needsMoreInspect: true,
      });
      expect(parse(result).branches[0].claimBasis).toBe("inference");
    });

    it("echoes finalConclusion", () => {
      const server = seeded("validated");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        needsMoreInspect: false,
        finalConclusion: "X holds for sure",
      });
      expect(parse(result).finalConclusion).toBe("X holds for sure");
    });
  });

  describe("nextAction", () => {
    it("asks to inspect after proposed", () => {
      const server = new EvidenceServer();
      expect(parse(server.processEntry(base)).nextAction).toBe(
        "Inspect branch 1, then call again with cycle=testing",
      );
    });

    it("asks to continue while testing", () => {
      const server = seeded("proposed");
      expect(
        parse(server.processEntry({ ...base, cycle: "testing" })).nextAction,
      ).toBe("Continue inspecting branch 1");
    });

    it("lists unresolved branches after resolving one", () => {
      const server = seeded("testing");
      server.processEntry({ ...base, branchId: "2" });
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
      });
      expect(parse(result).nextAction).toBe(
        "Resolve branches [2] before finishing sequentialthinking. " +
          "If they belong to an abandoned task, call cycle=proposed with newSession=true",
      );
    });

    it("asks for finalConclusion when everything is resolved", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "rejected",
        rejectionReason: "no",
        needsMoreInspect: false,
      });
      expect(parse(result).nextAction).toBe(
        "All branches resolved. Call again with finalConclusion and needsMoreInspect=false",
      );
    });

    it("reports done with finalConclusion", () => {
      const server = seeded("validated");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        needsMoreInspect: false,
        finalConclusion: "done",
      });
      expect(parse(result).nextAction).toBe(
        "Done. Return to sequentialthinking and finish",
      );
    });
  });

  describe("full walk", () => {
    it("walks proposed -> testing -> validated with finalConclusion on the resolving call", () => {
      const server = new EvidenceServer();
      expect(
        server.processEntry({ ...base, cycle: "proposed" }).isError,
      ).toBeUndefined();
      expect(
        server.processEntry({ ...base, cycle: "testing", evidence }).isError,
      ).toBeUndefined();
      const final = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        needsMoreInspect: false,
        finalConclusion: "X holds",
      });
      expect(final.isError).toBeUndefined();
      const data = parse(final);
      expect(data.unresolvedBranchIds).toEqual([]);
      expect(data.historyLength).toBe(3);
      expect(data.nextAction).toMatch(/^Done/);
    });
  });

  describe("branch identity", () => {
    it.each<Cycle>(["testing", "validated", "rejected"])(
      "rejects a changed claim on cycle=%s",
      (cycle) => {
        const server = seeded("testing");
        const result = server.processEntry({
          ...base,
          cycle,
          claim: "X holds everywhere",
          evidence,
          rejectionReason: "r",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(
          "claim of branch 1 is fixed at proposed",
        );
        expect(result.content[0].text).toContain("derivedFromBranchId");
      },
    );

    it("rejects a changed claim on re-inspection after validated", () => {
      const server = seeded("validated");
      const result = server.processEntry({
        ...base,
        cycle: "testing",
        claim: "Y",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("is fixed at proposed");
    });

    it("rejects a changed sourceThoughtNumber", () => {
      const server = seeded("proposed");
      const result = server.processEntry({
        ...base,
        cycle: "testing",
        sourceThoughtNumber: 2,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "sourceThoughtNumber of branch 1 is fixed at 1",
      );
    });

    it("rejects adding sourceBranchId to a main-line branch", () => {
      const server = seeded("proposed");
      const result = server.processEntry({
        ...base,
        cycle: "testing",
        sourceBranchId: "alt",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "sourceBranchId of branch 1 is fixed at (main line, omitted)",
      );
    });

    it("rejects dropping sourceBranchId from a side-line branch", () => {
      const server = new EvidenceServer();
      server.processEntry({ ...base, sourceBranchId: "alt" });
      const result = server.processEntry({ ...base, cycle: "testing" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "sourceBranchId of branch 1 is fixed at alt",
      );
    });

    it("allows the changed claim on a derived branch", () => {
      const server = seeded("testing");
      server.processEntry({
        ...base,
        cycle: "rejected",
        rejectionReason: "too weak",
      });
      const result = server.processEntry({
        ...base,
        branchId: "2",
        derivedFromBranchId: "1",
        claim: "X holds everywhere",
        sourceThoughtNumber: 2,
      });
      expect(result.isError).toBeUndefined();
    });
  });

  describe("evidence accumulation", () => {
    it("validates with evidence sent on an earlier testing call", () => {
      const server = seeded("proposed");
      server.processEntry({ ...base, cycle: "testing", evidence });
      const result = server.processEntry({ ...base, cycle: "validated" });
      expect(result.isError).toBeUndefined();
    });

    it("combines guessed and non-guessed evidence across calls", () => {
      const server = seeded("proposed");
      server.processEntry({
        ...base,
        cycle: "testing",
        evidence: [
          { kind: "observed", ref: "server.log", summary: "seen in logs" },
        ],
      });
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence: [{ kind: "guessed", summary: "follows from A" }],
      });
      expect(result.isError).toBeUndefined();
    });

    it("rejects validated when every collected item is guessed", () => {
      const server = seeded("proposed");
      server.processEntry({
        ...base,
        cycle: "testing",
        evidence: [{ kind: "guessed", summary: "follows from A" }],
      });
      const result = server.processEntry({ ...base, cycle: "validated" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "validated requires at least one non-guessed evidence",
      );
    });

    it("does not share evidence between branches", () => {
      const server = seeded("proposed");
      server.processEntry({ ...base, cycle: "testing", evidence });
      server.processEntry({ ...base, branchId: "2", claim: "Y" });
      server.processEntry({
        ...base,
        branchId: "2",
        claim: "Y",
        cycle: "testing",
      });
      const result = server.processEntry({
        ...base,
        branchId: "2",
        claim: "Y",
        cycle: "validated",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "at least one evidence item collected on branch 2",
      );
    });

    it("does not keep evidence of a rejected call", () => {
      const server = seeded("proposed");
      server.processEntry({ ...base, cycle: "validated", evidence });
      server.processEntry({ ...base, cycle: "testing" });
      const result = server.processEntry({ ...base, cycle: "validated" });
      expect(result.isError).toBe(true);
    });

    it("restates validated with finalConclusion without resending evidence", () => {
      const server = seeded("validated");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        needsMoreInspect: false,
        finalConclusion: "X holds",
      });
      expect(result.isError).toBeUndefined();
    });

    it("reports evidenceCount per branch", () => {
      const server = seeded("proposed");
      server.processEntry({ ...base, cycle: "testing", evidence });
      const result = server.processEntry({
        ...base,
        cycle: "testing",
        evidence: [
          { kind: "referenced", ref: "README.md", summary: "says so" },
          { kind: "guessed", summary: "follows from A" },
        ],
      });
      expect(parse(result).branches[0].evidenceCount).toBe(3);
    });

    it("does not carry evidence over a new session", () => {
      const server = seeded("proposed");
      server.processEntry({ ...base, cycle: "testing", evidence });
      server.processEntry({ ...base, newSession: true });
      server.processEntry({ ...base, cycle: "testing" });
      const result = server.processEntry({ ...base, cycle: "validated" });
      expect(result.isError).toBe(true);
    });
  });

  describe("session", () => {
    const finish = (server: EvidenceServer) =>
      server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        needsMoreInspect: false,
        finalConclusion: "X holds",
      });

    it("reports the closing session in the finalConclusion response", () => {
      const data = parse(finish(seeded("validated")));
      expect(data.branches.map((b) => b.branchId)).toEqual(["1"]);
      expect(data.historyLength).toBe(4);
      expect(data.discardedBranchIds).toEqual([]);
    });

    it("starts a new session after finalConclusion, so branch ids can be reused", () => {
      const server = seeded("validated");
      finish(server);
      const result = server.processEntry({ ...base, claim: "next task" });
      expect(result.isError).toBeUndefined();
      const data = parse(result);
      expect(data.historyLength).toBe(1);
      expect(data.branches).toEqual([
        expect.objectContaining({ branchId: "1", claim: "next task" }),
      ]);
    });

    it("rejects a second finalConclusion after the session is closed", () => {
      const server = seeded("validated");
      finish(server);
      const result = finish(server);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid transition");
    });

    it("does not reset the state when finalConclusion is rejected", () => {
      const server = seeded("validated");
      server.processEntry({ ...base, branchId: "2" });
      expect(finish(server).isError).toBe(true);
      const data = parse(server.processEntry({ ...base, cycle: "testing" }));
      expect(data.unresolvedBranchIds).toEqual(["1", "2"]);
    });

    it("discards abandoned branches with newSession=true", () => {
      const server = seeded("testing");
      server.processEntry({ ...base, branchId: "2" });
      const result = server.processEntry({
        ...base,
        claim: "new task",
        newSession: true,
      });
      expect(result.isError).toBeUndefined();
      const data = parse(result);
      expect(data.discardedBranchIds).toEqual(["1", "2"]);
      expect(data.unresolvedBranchIds).toEqual(["1"]);
      expect(data.historyLength).toBe(1);
      expect(data.branches).toEqual([
        expect.objectContaining({ branchId: "1", claim: "new task" }),
      ]);
    });

    it("allows finalConclusion after abandoned branches are discarded", () => {
      const server = seeded("testing");
      server.processEntry({ ...base, newSession: true });
      server.processEntry({ ...base, cycle: "testing", evidence });
      expect(finish(server).isError).toBeUndefined();
    });

    it("returns empty discardedBranchIds without newSession", () => {
      const server = seeded("validated");
      const data = parse(server.processEntry({ ...base, branchId: "2" }));
      expect(data.discardedBranchIds).toEqual([]);
    });

    it("accepts newSession=true on an empty state", () => {
      const server = new EvidenceServer();
      const data = parse(server.processEntry({ ...base, newSession: true }));
      expect(data.discardedBranchIds).toEqual([]);
    });

    it.each<Cycle>(["testing", "validated", "rejected"])(
      "rejects newSession=true with cycle=%s and keeps the state",
      (cycle) => {
        const server = seeded("testing");
        const result = server.processEntry({
          ...base,
          cycle,
          evidence,
          rejectionReason: "r",
          newSession: true,
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(
          "newSession=true is allowed only with cycle=proposed",
        );
        const data = parse(server.processEntry({ ...base, cycle: "testing" }));
        expect(data.historyLength).toBe(3);
      },
    );

    it("keeps the old state when a newSession call is rejected", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        branchId: "2",
        derivedFromBranchId: "1",
        newSession: true,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not exist");
      const data = parse(server.processEntry({ ...base, cycle: "testing" }));
      expect(data.historyLength).toBe(3);
      expect(data.branches.map((b) => b.branchId)).toEqual(["1"]);
    });
  });

  describe("logging", () => {
    it("logs a formatted box to stderr when logging is enabled", () => {
      delete process.env.DISABLE_EVIDENCE_LOGGING;
      const server = new EvidenceServer();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      server.processEntry({
        ...base,
        sourceBranchId: "alt",
        derivedFromBranchId: undefined,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const out = spy.mock.calls[0][0] as string;
      expect(out).toContain("💡 Proposed branch 1 (from thought 1 @alt)");
      expect(out).toContain("claim: X holds");
      spy.mockRestore();
    });

    it("logs evidence, rejection, claimBasis and final lines", () => {
      delete process.env.DISABLE_EVIDENCE_LOGGING;
      const server = new EvidenceServer();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      server.processEntry({ ...base, cycle: "proposed" });
      server.processEntry({
        ...base,
        cycle: "testing",
        evidence: [
          { kind: "referenced", ref: "README.md", summary: "says so" },
        ],
      });
      server.processEntry({
        ...base,
        cycle: "rejected",
        rejectionReason: "contradicted",
      });
      server.processEntry({
        ...base,
        branchId: "2",
        derivedFromBranchId: "1",
        cycle: "proposed",
      });
      server.processEntry({
        ...base,
        branchId: "2",
        cycle: "rejected",
        rejectionReason: "also contradicted",
        needsMoreInspect: false,
        finalConclusion: "X is false",
      });
      const all = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(all).toContain("evidence[referenced]: says so (README.md)");
      expect(all).toContain("rejected: contradicted");
      expect(all).toContain("claimBasis: fact");
      expect(all).toContain("final: X is false");
      expect(all).toContain("derived from branch 1");
      spy.mockRestore();
    });

    it("does not log when DISABLE_EVIDENCE_LOGGING=true", () => {
      const server = new EvidenceServer();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      server.processEntry(base);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
