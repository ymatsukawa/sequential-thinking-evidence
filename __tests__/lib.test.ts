import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EvidenceServer,
  EvidenceEntry,
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
  needsMoreInspect: true,
};

const evidence = [{ kind: "test" as const, summary: "ok" }];

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
        },
        {
          branchId: "2",
          cycle: "proposed",
          claim: "Y",
          sourceThoughtNumber: 4,
        },
      ]);
    });

    it("includes confidence in the summary when given", () => {
      const server = seeded("testing");
      const result = server.processEntry({
        ...base,
        cycle: "validated",
        evidence,
        confidence: 0.8,
        needsMoreInspect: true,
      });
      expect(parse(result).branches[0].confidence).toBe(0.8);
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
        "Resolve branches [2] before finishing sequentialthinking",
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
        confidence: 0.9,
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

    it("logs evidence, rejection, confidence and final lines", () => {
      delete process.env.DISABLE_EVIDENCE_LOGGING;
      const server = new EvidenceServer();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      server.processEntry({ ...base, cycle: "proposed" });
      server.processEntry({
        ...base,
        cycle: "testing",
        evidence: [{ kind: "document", ref: "README.md", summary: "says so" }],
      });
      server.processEntry({
        ...base,
        cycle: "rejected",
        rejectionReason: "contradicted",
        needsMoreInspect: false,
        finalConclusion: "X is false",
      });
      server.processEntry({
        ...base,
        branchId: "2",
        derivedFromBranchId: "1",
        cycle: "proposed",
      });
      const all = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(all).toContain("evidence[document]: says so (README.md)");
      expect(all).toContain("rejected: contradicted");
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
