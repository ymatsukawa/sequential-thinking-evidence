import chalk from 'chalk';
import {
  BranchSummary,
  Cycle,
  EvidenceEntry,
  EvidenceItem,
  EvidenceResponse,
  PrevCycle,
  ToolResult,
} from './models/types.js';
import { ValidateEvidenceEntry, ValidationContext } from './models/validate_evidence_entry.js';
import { McpAction } from './models/mcp_action.js';

export * from './models/types.js';

const UNRESOLVED: ReadonlySet<Cycle> = new Set<Cycle>(['proposed', 'testing']);

export class EvidenceServer {
  private history: EvidenceEntry[] = [];
  private branches: Record<string, EvidenceEntry[]> = {};
  private disableLogging: boolean;
  private mcpAction: McpAction;

  constructor() {
    this.disableLogging = process.env.DISABLE_EVIDENCE_LOGGING?.toLowerCase() === 'true';
    this.mcpAction = new McpAction();
  }

  private nextAction(entry: EvidenceEntry): string {
    return this.mcpAction.next(entry, this.unresolvedBranchIds());
  }

  private failure(error: string): ToolResult {
    return this.mcpAction.failure(error);
  }

  private reset(): string[] {
    const ids = Object.keys(this.branches);
    this.history = [];
    this.branches = {};
    return ids;
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

  private context(entry: EvidenceEntry): ValidationContext {
    return {
      prev: this.currentCycle(entry.branchId),
      first: this.branches[entry.branchId]?.[0],
      collected: [...this.evidenceOf(entry.branchId), ...(entry.evidence ?? [])],
      knownBranchIds: Object.keys(this.branches),
      unresolved: this.unresolvedBranchIds(entry),
    };
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

  public processEntry(input: EvidenceEntry): ToolResult {
    try {
      if (input.newSession && input.cycle !== 'proposed') {
        return this.failure(`newSession=true is allowed only with cycle=proposed (got ${input.cycle})`);
      }

      const saved = { history: this.history, branches: this.branches };
      const discarded = input.newSession ? this.reset() : [];
      const error = new ValidateEvidenceEntry(input, this.context(input)).validate();
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
