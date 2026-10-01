import {
  ALLOWED_TRANSITIONS,
  EvidenceEntry,
  EvidenceItem,
  PrevCycle,
} from "./types.js";

export interface ValidationContext {
  prev: PrevCycle;
  first?: EvidenceEntry;
  collected: EvidenceItem[];
  knownBranchIds: string[];
  unresolved: string[];
}

export class ValidateEvidenceEntry {
  constructor(
    private readonly entry: EvidenceEntry,
    private readonly ctx: ValidationContext,
  ) {}

  validate(): string | null {
    return (
      this.checkTransition() ??
      this.checkIdentity() ??
      this.checkCycleRequirement() ??
      this.checkDerivedFrom() ??
      this.checkSession()
    );
  }

  private checkTransition(): string | null {
    const { prev } = this.ctx;
    const { cycle, branchId } = this.entry;

    if (ALLOWED_TRANSITIONS[prev].has(cycle)) return null;

    const allowed = [...ALLOWED_TRANSITIONS[prev]].join(", ");
    const from = prev === "new" ? "a new branch" : prev;

    return `Invalid transition ${from} -> ${cycle} on branch ${branchId}. Allowed next cycle: ${allowed}`;
  }

  private checkIdentity(): string | null {
    const { first } = this.ctx;
    const { branchId } = this.entry;

    if (!first) return null;

    if (first.claim !== this.entry.claim) {
      return `claim of branch ${branchId} is fixed at proposed ("${first.claim}"). Reject it and start a new branch with derivedFromBranchId to change the claim`;
    }
    if (first.sourceThoughtNumber !== this.entry.sourceThoughtNumber) {
      return `sourceThoughtNumber of branch ${branchId} is fixed at ${first.sourceThoughtNumber}. Reject it and start a new branch with derivedFromBranchId to change the source`;
    }
    if (first.sourceBranchId !== this.entry.sourceBranchId) {
      const fixed = first.sourceBranchId ?? "(main line, omitted)";
      return `sourceBranchId of branch ${branchId} is fixed at ${fixed}. Reject it and start a new branch with derivedFromBranchId to change the source`;
    }

    return null;
  }

  private checkCycleRequirement(): string | null {
    switch (this.entry.cycle) {
      case "validated":
        return this.checkValidated();
      case "rejected":
        return this.checkRejected();
      default:
        return null;
    }
  }

  private checkValidated(): string | null {
    const { collected } = this.ctx;
    const { branchId, claimBasis } = this.entry;

    if (!collected.length) {
      return `validated requires at least one evidence item collected on branch ${branchId}. Add evidence[] or use cycle=testing`;
    }
    if (collected.every((v) => v.kind === "guessed")) {
      return `validated requires at least one non-guessed evidence item (referenced, measured, or observed) collected on branch ${branchId}. Keep cycle=testing until you have one`;
    }
    if (claimBasis !== "fact" && claimBasis !== "inference") {
      return `validated requires claimBasis=fact or inference on branch ${branchId} (got ${claimBasis}). Keep cycle=testing until claimBasis is fact or inference`;
    }
    return null;
  }

  private checkRejected(): string | null {
    if (this.entry.rejectionReason?.trim()) return null;

    return `rejected requires rejectionReason on branch ${this.entry.branchId}`;
  }

  private checkDerivedFrom(): string | null {
    const { knownBranchIds } = this.ctx;
    const { derivedFromBranchId, branchId } = this.entry;

    if (derivedFromBranchId === undefined) return null;
    if (derivedFromBranchId === branchId) {
      return `derivedFromBranchId must differ from branchId (${branchId})`;
    }
    if (!knownBranchIds.includes(derivedFromBranchId)) {
      return `derivedFromBranchId ${derivedFromBranchId} does not exist. Known branches: ${knownBranchIds.join(", ") || "(none)"}`;
    }

    return null;
  }

  private checkSession(): string | null {
    const { unresolved } = this.ctx;
    const { finalConclusion, needsMoreInspect } = this.entry;

    if (!unresolved.length) return null;

    const ids = unresolved.join(", ");
    if (finalConclusion !== undefined) {
      return `finalConclusion is not allowed while branches [${ids}] are unresolved. Validate or reject them first`;
    }
    if (!needsMoreInspect) {
      return `needsMoreInspect=false but branches [${ids}] are unresolved. Set needsMoreInspect=true or resolve them first`;
    }

    return null;
  }
}
