import chalk from 'chalk';

export const CYCLES = ['proposed', 'testing', 'validated', 'rejected'] as const;
export type Cycle = (typeof CYCLES)[number];

export const EVIDENCE_KINDS = ['observation', 'document', 'test', 'reasoning', 'external'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceItem {
  kind: EvidenceKind;
  ref?: string;
  summary: string;
}

export interface EvidenceEntry {
  cycle: Cycle;
  branchId: string;
  sourceThoughtNumber: number;
  sourceBranchId?: string;
  derivedFromBranchId?: string;
  claim: string;
  inspection: string;
  evidence?: EvidenceItem[];
  confidence?: number;
  rejectionReason?: string;
  needsMoreInspect: boolean;
  finalConclusion?: string;
}

export interface BranchSummary {
  branchId: string;
  cycle: Cycle;
  claim: string;
  sourceThoughtNumber: number;
  confidence?: number;
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

  /** Branch ids still proposed/testing, computed as if `pending` were already applied. */
  private unresolvedBranchIds(pending?: EvidenceEntry): string[] {
    const ids = new Set(Object.keys(this.branches));
    if (pending) ids.add(pending.branchId);
    return [...ids].filter((id) => {
      const cycle = pending && pending.branchId === id ? pending.cycle : this.currentCycle(id);
      return cycle !== 'new' && UNRESOLVED.has(cycle);
    });
  }

  private validate(entry: EvidenceEntry): string | null {
    const prev = this.currentCycle(entry.branchId);
    if (!ALLOWED_TRANSITIONS[prev].has(entry.cycle)) {
      const allowed = [...ALLOWED_TRANSITIONS[prev]].join(', ');
      const from = prev === 'new' ? 'a new branch' : prev;
      return `Invalid transition ${from} -> ${entry.cycle} on branch ${entry.branchId}. Allowed next cycle: ${allowed}`;
    }
    if (entry.cycle === 'validated' && !entry.evidence?.length) {
      return `validated requires at least one evidence item on branch ${entry.branchId}. Add evidence[] or use cycle=testing`;
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
      return `Resolve branches [${unresolved.join(', ')}] before finishing sequentialthinking`;
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
        ...(last.confidence !== undefined ? { confidence: last.confidence } : {}),
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
      ...(e.confidence !== undefined ? [`confidence: ${e.confidence}`] : []),
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

  public processEntry(input: EvidenceEntry): ToolResult {
    try {
      const error = this.validate(input);
      if (error) return this.failure(error);

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
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : String(error));
    }
  }
}
