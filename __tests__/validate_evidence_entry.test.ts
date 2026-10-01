import { describe, it, expect } from "vitest";
import { EvidenceEntry, EvidenceItem } from "../models/types.js";
import {
  ValidateEvidenceEntry,
  ValidationContext,
} from "../models/validate_evidence_entry.js";

const base: EvidenceEntry = {
  cycle: "testing",
  branchId: "1",
  sourceThoughtNumber: 1,
  claim: "X holds",
  inspection: "check X",
  claimBasis: "fact",
  needsMoreInspect: true,
};

const measured: EvidenceItem = {
  kind: "measured",
  ref: "npm test",
  summary: "ok",
};
const guessed: EvidenceItem = { kind: "guessed", summary: "maybe" };

const ctxBase: ValidationContext = {
  prev: "proposed",
  first: { ...base, cycle: "proposed" },
  collected: [],
  knownBranchIds: ["1"],
  unresolved: ["1"],
};

function validate(
  entry: Partial<EvidenceEntry>,
  ctx: Partial<ValidationContext> = {},
): string | null {
  return new ValidateEvidenceEntry(
    { ...base, ...entry },
    { ...ctxBase, ...ctx },
  ).validate();
}

describe("ValidateEvidenceEntry", () => {
  it("returns null for a valid entry", () => {
    expect(validate({})).toBeNull();
  });

  describe("transition", () => {
    it("rejects a transition outside the table", () => {
      expect(validate({ cycle: "validated" })).toContain(
        "Invalid transition proposed -> validated on branch 1. Allowed next cycle: testing, rejected",
      );
    });

    it("describes a missing branch as a new branch", () => {
      expect(
        validate({ cycle: "testing" }, { prev: "new", first: undefined }),
      ).toContain("Invalid transition a new branch -> testing");
    });
  });

  describe("identity", () => {
    it("rejects a changed claim", () => {
      expect(validate({ claim: "Y holds" })).toContain(
        'claim of branch 1 is fixed at proposed ("X holds")',
      );
    });

    it("rejects a changed sourceThoughtNumber", () => {
      expect(validate({ sourceThoughtNumber: 2 })).toContain(
        "sourceThoughtNumber of branch 1 is fixed at 1",
      );
    });

    it("rejects an added sourceBranchId", () => {
      expect(validate({ sourceBranchId: "alt" })).toContain(
        "sourceBranchId of branch 1 is fixed at (main line, omitted)",
      );
    });

    it("skips identity checks on a new branch", () => {
      expect(
        validate(
          { cycle: "proposed", claim: "Y holds" },
          { prev: "new", first: undefined },
        ),
      ).toBeNull();
    });
  });

  describe("validated requirement", () => {
    const ctx = { prev: "testing" as const, unresolved: [] };

    it("rejects without collected evidence", () => {
      expect(validate({ cycle: "validated" }, ctx)).toContain(
        "validated requires at least one evidence item",
      );
    });

    it("rejects when every collected item is guessed", () => {
      expect(
        validate({ cycle: "validated" }, { ...ctx, collected: [guessed] }),
      ).toContain("validated requires at least one non-guessed evidence item");
    });

    it.each(["assumption", "opinion"] as const)(
      "rejects claimBasis=%s",
      (claimBasis) => {
        expect(
          validate(
            { cycle: "validated", claimBasis },
            { ...ctx, collected: [measured] },
          ),
        ).toContain(`(got ${claimBasis})`);
      },
    );

    it.each(["fact", "inference"] as const)(
      "accepts claimBasis=%s",
      (claimBasis) => {
        expect(
          validate(
            { cycle: "validated", claimBasis },
            { ...ctx, collected: [guessed, measured] },
          ),
        ).toBeNull();
      },
    );
  });

  describe("rejected requirement", () => {
    const ctx = { unresolved: [] };

    it.each([undefined, "  "])(
      "rejects rejectionReason=%j",
      (rejectionReason) => {
        expect(validate({ cycle: "rejected", rejectionReason }, ctx)).toBe(
          "rejected requires rejectionReason on branch 1",
        );
      },
    );

    it("accepts a rejectionReason", () => {
      expect(
        validate({ cycle: "rejected", rejectionReason: "no" }, ctx),
      ).toBeNull();
    });
  });

  describe("derivedFromBranchId", () => {
    const ctx = { prev: "new" as const, first: undefined };

    it("rejects pointing at itself", () => {
      expect(
        validate({ cycle: "proposed", derivedFromBranchId: "1" }, ctx),
      ).toContain("derivedFromBranchId must differ from branchId (1)");
    });

    it("rejects an unknown branch", () => {
      expect(
        validate(
          { cycle: "proposed", branchId: "2", derivedFromBranchId: "9" },
          ctx,
        ),
      ).toContain("derivedFromBranchId 9 does not exist. Known branches: 1");
    });

    it("lists (none) when no branch is known", () => {
      expect(
        validate(
          { cycle: "proposed", branchId: "2", derivedFromBranchId: "9" },
          { ...ctx, knownBranchIds: [] },
        ),
      ).toContain("Known branches: (none)");
    });

    it("accepts a known branch", () => {
      expect(
        validate(
          { cycle: "proposed", branchId: "2", derivedFromBranchId: "1" },
          ctx,
        ),
      ).toBeNull();
    });
  });

  describe("session", () => {
    it("rejects finalConclusion while branches are unresolved", () => {
      expect(
        validate({ finalConclusion: "done" }, { unresolved: ["1", "2"] }),
      ).toContain(
        "finalConclusion is not allowed while branches [1, 2] are unresolved",
      );
    });

    it("rejects needsMoreInspect=false while branches are unresolved", () => {
      expect(validate({ needsMoreInspect: false })).toContain(
        "needsMoreInspect=false but branches [1] are unresolved",
      );
    });

    it("accepts needsMoreInspect=false once everything is resolved", () => {
      expect(
        validate({ needsMoreInspect: false }, { unresolved: [] }),
      ).toBeNull();
    });
  });

  describe("check order", () => {
    it("reports the transition before identity", () => {
      expect(validate({ cycle: "validated", claim: "Y holds" })).toContain(
        "Invalid transition",
      );
    });

    it("reports identity before the cycle requirement", () => {
      expect(
        validate({ cycle: "validated", claim: "Y holds" }, { prev: "testing" }),
      ).toContain("claim of branch 1 is fixed");
    });

    it("reports the cycle requirement before the session check", () => {
      expect(
        validate(
          { cycle: "rejected", needsMoreInspect: false },
          { unresolved: ["2"] },
        ),
      ).toContain("rejected requires rejectionReason");
    });
  });
});
