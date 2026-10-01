import chalk from 'chalk';

export const CYCLES = ['proposed', 'testing', 'validated', 'rejected'] as const;
export type Cycle = (typeof CYCLES)[number];

export const EVIDENCE_KINDS = ['referenced', 'measured', 'observed', 'guessed'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const CLAIM_BASIS_KINDS = ['fact', 'assumption', 'inference', 'opinion'] as const;
export type ClaimBasisKind = (typeof CLAIM_BASIS_KINDS)[number];

export type EvidenceItem =
  | { kind: 'guessed'; ref?: string; summary: string }
  | { kind: Exclude<EvidenceKind, 'guessed'>; ref: string; summary: string };

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
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type PrevCycle = Cycle | 'new';

/**
 * Allowed transitions per branch. `new` means the branch does not exist yet.
 * Restating a terminal state (validated -> validated, rejected -> rejected) is
 * allowed so the final call carrying `finalConclusion` can be made after every
 * branch is already resolved.
 */
export const ALLOWED_TRANSITIONS: Record<PrevCycle, ReadonlySet<Cycle>> = {
  new: new Set<Cycle>(['proposed']),
  proposed: new Set<Cycle>(['testing', 'rejected']),
  testing: new Set<Cycle>(['testing', 'validated', 'rejected']),
  validated: new Set<Cycle>(['testing', 'validated']),
  rejected: new Set<Cycle>(['testing', 'rejected']),
};

const UNRESOLVED: ReadonlySet<Cycle> = new Set<Cycle>(['proposed', 'testing']);

export class EvidenceServer {
  private history: EvidenceEntry[] = [];
  private branches: Record<string, EvidenceEntry[]> = {};
  private disableLogging: boolean;

  constructor() {
    this.disableLogging = process.env.DISABLE_EVIDENCE_LOGGING?.toLowerCase() === 'true';
  }

  private latest(branchId: string): EvidenceEntry | undefined {
    const entries = this.branches[branchId];
    return entries?.length ? entries[entries.length - 1] : undefined;
  }

  private currentCycle(branchId: string): PrevCycle {
    return this.latest(branchId)?.cycle ?? 'new';
  }

  private unresolvedBranchIds(pending?: EvidenceEntry): string[] {
    const ids = new Set(Object.keys(this.branches));
    if (pending) ids.add(pending.branchId);
    return [...ids].filter((id) => {
      const cycle = pending && pending.branchId === id ? pending.cycle : this.currentCycle(id);
      return cycle !== 'new' && UNRESOLVED.has(cycle);
    });
  }

  private evidenceOf(branchId: string): EvidenceItem[] {
    return (this.branches[branchId] ?? []).flatMap((e) => e.evidence ?? []);
  }

  private validate(entry: EvidenceEntry): string | null {
    const prev = this.currentCycle(entry.branchId);
    if (!ALLOWED_TRANSITIONS[prev].has(entry.cycle)) {
      const allowed = [...ALLOWED_TRANSITIONS[prev]].join(', ');
      const from = prev === 'new' ? 'a new branch' : prev;
      return `Invalid transition ${from} -> ${entry.cycle} on branch ${entry.branchId}. Allowed next cycle: ${allowed}`;
    }
    const first = this.branches[entry.branchId]?.[0];
    if (first && first.claim !== entry.claim) {
      return `claim of branch ${entry.branchId} is fixed at proposed ("${first.claim}"). Reject it and start a new branch with derivedFromBranchId to change the claim`;
    }
    if (first && first.sourceThoughtNumber !== entry.sourceThoughtNumber) {
      return `sourceThoughtNumber of branch ${entry.branchId} is fixed at ${first.sourceThoughtNumber}. Reject it and start a new branch with derivedFromBranchId to change the source`;
    }
    if (first && first.sourceBranchId !== entry.sourceBranchId) {
      const fixed = first.sourceBranchId ?? '(main line, omitted)';
      return `sourceBranchId of branch ${entry.branchId} is fixed at ${fixed}. Reject it and start a new branch with derivedFromBranchId to change the source`;
    }
    const collected = [...this.evidenceOf(entry.branchId), ...(entry.evidence ?? [])];
    if (entry.cycle === 'validated' && !collected.length) {
      return `validated requires at least one evidence item collected on branch ${entry.branchId}. Add evidence[] or use cycle=testing`;
    }
    if (entry.cycle === 'validated' && collected.every((v) => v.kind === 'guessed')) {
      return `validated requires at least one non-guessed evidence item (referenced, measured, or observed) collected on branch ${entry.branchId}. Keep cycle=testing until you have one`;
    }
    if (entry.cycle === 'validated' && entry.claimBasis !== 'fact' && entry.claimBasis !== 'inference') {
      return `validated requires claimBasis=fact or inference on branch ${entry.branchId} (got ${entry.claimBasis}). Keep cycle=testing until claimBasis is fact or inference`;
    }
    if (entry.cycle === 'rejected' && !entry.rejectionReason?.trim()) {
      return `rejected requires rejectionReason on branch ${entry.branchId}`;
    }
    if (entry.derivedFromBranchId !== undefined) {
      if (entry.derivedFromBranchId === entry.branchId) {
        return `derivedFromBranchId must differ from branchId (${entry.branchId})`;
      }
      if (!this.branches[entry.derivedFromBranchId]) {
        return `derivedFromBranchId ${entry.derivedFromBranchId} does not exist. Known branches: ${Object.keys(this.branches).join(', ') || '(none)'}`;
      }
    }
    const unresolved = this.unresolvedBranchIds(entry);
    if (entry.finalConclusion !== undefined && unresolved.length > 0) {
      return `finalConclusion is not allowed while branches [${unresolved.join(', ')}] are unresolved. Validate or reject them first`;
    }
    if (!entry.needsMoreInspect && entry.finalConclusion === undefined && unresolved.length > 0) {
      return `needsMoreInspect=false but branches [${unresolved.join(', ')}] are unresolved. Set needsMoreInspect=true or resolve them first`;
    }
    return null;
  }

  private nextAction(entry: EvidenceEntry): string {
    if (entry.finalConclusion !== undefined) {
      return 'Done. Return to sequentialthinking and finish';
    }
    if (entry.cycle === 'proposed') {
      return `Inspect branch ${entry.branchId}, then call again with cycle=testing`;
    }
    if (entry.cycle === 'testing' && entry.needsMoreInspect) {
      return `Continue inspecting branch ${entry.branchId}`;
    }
    const unresolved = this.unresolvedBranchIds();
    if (unresolved.length > 0) {
      return (
        `Resolve branches [${unresolved.join(', ')}] before finishing sequentialthinking. ` +
        'If they belong to an abandoned task, call cycle=proposed with newSession=true'
      );
    }
    return 'All branches resolved. Call again with finalConclusion and needsMoreInspect=false';
  }

  private branchSummaries(): BranchSummary[] {
    return Object.keys(this.branches).map((branchId) => {
      const last = this.latest(branchId)!;
      return {
        branchId,
        cycle: last.cycle,
        claim: last.claim,
        sourceThoughtNumber: last.sourceThoughtNumber,
        claimBasis: last.claimBasis,
        evidenceCount: this.evidenceOf(branchId).length,
      };
    });
  }

  private formatEntry(e: EvidenceEntry): string {
    const label = {
      proposed: chalk.blue('💡 Proposed'),
      testing: chalk.yellow('🔬 Testing'),
      validated: chalk.green('✅ Validated'),
      rejected: chalk.red('❌ Rejected'),
    }[e.cycle];
    const src = e.sourceBranchId
      ? `thought ${e.sourceThoughtNumber} @${e.sourceBranchId}`
      : `thought ${e.sourceThoughtNumber}`;
    const derived = e.derivedFromBranchId ? `, derived from branch ${e.derivedFromBranchId}` : '';
    const header = `${label} branch ${e.branchId} (from ${src}${derived})`;

    const lines = [
      `claim: ${e.claim}`,
      `inspection: ${e.inspection}`,
      ...(e.evidence ?? []).map((v) => `evidence[${v.kind}]: ${v.summary}${v.ref ? ` (${v.ref})` : ''}`),
      ...(e.rejectionReason ? [`rejected: ${e.rejectionReason}`] : []),
      `claimBasis: ${e.claimBasis}`,
      ...(e.finalConclusion !== undefined ? [`final: ${e.finalConclusion}`] : []),
    ];

    const width = Math.max(header.length, ...lines.map((l) => l.length)) + 4;
    const border = '─'.repeat(width);
    return [
      '',
      `┌${border}┐`,
      `│ ${header.padEnd(width - 2)} │`,
      `├${border}┤`,
      ...lines.map((l) => `│ ${l.padEnd(width - 2)} │`),
      `└${border}┘`,
    ].join('\n');
  }

  private failure(error: string): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error, status: 'failed' }, null, 2) }],
      isError: true,
    };
  }

  private reset(): string[] {
    const ids = Object.keys(this.branches);
    this.history = [];
    this.branches = {};
    return ids;
  }

  public processEntry(input: EvidenceEntry): ToolResult {
    try {
      if (input.newSession && input.cycle !== 'proposed') {
        return this.failure(`newSession=true is allowed only with cycle=proposed (got ${input.cycle})`);
      }

      const saved = { history: this.history, branches: this.branches };
      const discarded = input.newSession ? this.reset() : [];
      const error = this.validate(input);
      if (error) {
        this.history = saved.history;
        this.branches = saved.branches;
        return this.failure(error);
      }

      this.history.push(input);
      (this.branches[input.branchId] ??= []).push(input);

      if (!this.disableLogging) {
        console.error(this.formatEntry(input));
      }

      const response: EvidenceResponse = {
        branchId: input.branchId,
        cycle: input.cycle,
        sourceThoughtNumber: input.sourceThoughtNumber,
        needsMoreInspect: input.needsMoreInspect,
        branches: this.branchSummaries(),
        unresolvedBranchIds: this.unresolvedBranchIds(),
        historyLength: this.history.length,
        nextAction: this.nextAction(input),
        ...(input.finalConclusion !== undefined ? { finalConclusion: input.finalConclusion } : {}),
        discardedBranchIds: discarded,
      };

      if (input.finalConclusion !== undefined) {
        this.reset();
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : String(error));
    }
  }
}
