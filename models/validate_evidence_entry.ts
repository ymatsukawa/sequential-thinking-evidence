import { RET_VAL } from "../const/return_value.js";
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

    return RET_VAL.validation.transition.invalid_transition(
      prev,
      cycle,
      branchId,
      allowed,
    );
  }

  private checkIdentity(): string | null {
    const { first } = this.ctx;
    const { branchId } = this.entry;

    if (!first) return null;

    if (first.claim !== this.entry.claim) {
      return RET_VAL.validation.identity.claim_fixed(branchId, first.claim);
    }
    if (first.sourceThoughtNumber !== this.entry.sourceThoughtNumber) {
      return RET_VAL.validation.identity.source_thought_fixed(
        branchId,
        first.sourceThoughtNumber,
      );
    }
    if (first.sourceBranchId !== this.entry.sourceBranchId) {
      return RET_VAL.validation.identity.source_branch_fixed(
        branchId,
        first.sourceBranchId,
      );
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
      return RET_VAL.validation.validated.no_evidence(branchId);
    }
    if (collected.every((v) => v.kind === "guessed")) {
      return RET_VAL.validation.validated.only_guessed(branchId);
    }
    if (claimBasis !== "fact" && claimBasis !== "inference") {
      return RET_VAL.validation.validated.invalid_claim_basis(
        branchId,
        claimBasis,
      );
    }
    return null;
  }

  private checkRejected(): string | null {
    if (this.entry.rejectionReason?.trim()) return null;

    return RET_VAL.validation.rejected.no_reason(this.entry.branchId);
  }

  private checkDerivedFrom(): string | null {
    const { knownBranchIds } = this.ctx;
    const { derivedFromBranchId, branchId } = this.entry;

    if (derivedFromBranchId === undefined) return null;
    if (derivedFromBranchId === branchId) {
      return RET_VAL.validation.derived_from.same_as_branch(branchId);
    }
    if (!knownBranchIds.includes(derivedFromBranchId)) {
      return RET_VAL.validation.derived_from.not_exist(
        derivedFromBranchId,
        knownBranchIds,
      );
    }

    return null;
  }

  private checkSession(): string | null {
    const { unresolved } = this.ctx;
    const { finalConclusion, needsMoreInspect } = this.entry;

    if (!unresolved.length) return null;

    const ids = unresolved.join(", ");
    if (finalConclusion !== undefined) {
      return RET_VAL.validation.session.final_while_unresolved(ids);
    }
    if (!needsMoreInspect) {
      return RET_VAL.validation.session.stop_while_unresolved(ids);
    }

    return null;
  }
}
