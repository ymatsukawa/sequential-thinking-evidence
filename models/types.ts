export const CYCLES = ["proposed", "testing", "validated", "rejected"] as const;
export type Cycle = (typeof CYCLES)[number];

export const EVIDENCE_KINDS = [
  "referenced",
  "measured",
  "observed",
  "guessed",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const CLAIM_BASIS_KINDS = [
  "fact",
  "assumption",
  "inference",
  "opinion",
] as const;
export type ClaimBasisKind = (typeof CLAIM_BASIS_KINDS)[number];

export type EvidenceItem =
  | { kind: "guessed"; ref?: string; summary: string }
  | { kind: Exclude<EvidenceKind, "guessed">; ref: string; summary: string };

export interface EvidenceEntry {
  cycle: Cycle;
  branchId: string;
  sourceThoughtNumber: number;
  sourceBranchId?: string;
  derivedFromBranchId?: string;
  claim: string;
  inspection: string;
  evidence?: EvidenceItem[];
  claimBasis: ClaimBasisKind;
  rejectionReason?: string;
  needsMoreInspect: boolean;
  finalConclusion?: string;
  newSession?: boolean;
}

export interface BranchSummary {
  branchId: string;
  cycle: Cycle;
  claim: string;
  sourceThoughtNumber: number;
  claimBasis?: ClaimBasisKind;
  evidenceCount: number;
}

export interface EvidenceResponse {
  branchId: string;
  cycle: Cycle;
  sourceThoughtNumber: number;
  needsMoreInspect: boolean;
  branches: BranchSummary[];
  unresolvedBranchIds: string[];
  historyLength: number;
  nextAction: string;
  finalConclusion?: string;
  discardedBranchIds: string[];
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type PrevCycle = Cycle | "new";

export const ALLOWED_TRANSITIONS: Record<PrevCycle, ReadonlySet<Cycle>> = {
  new: new Set<Cycle>(["proposed"]),
  proposed: new Set<Cycle>(["testing", "rejected"]),
  testing: new Set<Cycle>(["testing", "validated", "rejected"]),
  validated: new Set<Cycle>(["testing", "validated"]),
  rejected: new Set<Cycle>(["testing", "rejected"]),
};
