import chalk from 'chalk';
import { EvidenceEntry, EvidenceResponse, ToolResult } from './models/types.js';
import { ValidateEvidenceEntry, ValidationContext } from './models/validate_evidence_entry.js';
import { McpAction } from './models/mcp_action.js';
import { ServerInstance } from './models/server_instance.js';
import { RET_VAL } from './const/return_value.js';

export * from './models/types.js';

export class EvidenceServer {
  private instance: ServerInstance;
  private disableLogging: boolean;
  private mcpAction: McpAction;

  constructor() {
    this.instance = new ServerInstance();
    this.disableLogging = process.env.DISABLE_EVIDENCE_LOGGING?.toLowerCase() === 'true';
    this.mcpAction = new McpAction();
  }

  private nextAction(entry: EvidenceEntry): string {
    return this.mcpAction.next(entry, this.instance.unresolvedBranchIds());
  }

  private failure(error: string): ToolResult {
    return this.mcpAction.failure(error);
  }

  private context(entry: EvidenceEntry): ValidationContext {
    return {
      prev: this.instance.currentCycle(entry.branchId),
      first: this.instance.first(entry.branchId),
      collected: [...this.instance.evidenceOf(entry.branchId), ...(entry.evidence ?? [])],
      knownBranchIds: this.instance.branchIds(),
      unresolved: this.instance.unresolvedBranchIds(entry),
    };
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
        return this.failure(RET_VAL.lib.new_session_not_proposed(input.cycle));
      }

      const saved = this.instance;
      const discarded = input.newSession ? saved.branchIds() : [];
      if (input.newSession) this.instance = new ServerInstance();
      const error = new ValidateEvidenceEntry(input, this.context(input)).validate();
      if (error) {
        this.instance = saved;
        return this.failure(error);
      }

      this.instance.append(input);

      if (!this.disableLogging) {
        console.error(this.formatEntry(input));
      }

      const closing = input.finalConclusion !== undefined;
      const response: EvidenceResponse = {
        branchId: input.branchId,
        cycle: input.cycle,
        sourceThoughtNumber: input.sourceThoughtNumber,
        needsMoreInspect: closing ? false : input.needsMoreInspect,
        branches: this.instance.branchSummaries(),
        unresolvedBranchIds: this.instance.unresolvedBranchIds(),
        historyLength: this.instance.historyLength(),
        nextAction: this.nextAction(input),
        ...(closing ? { finalConclusion: input.finalConclusion } : {}),
        discardedBranchIds: discarded,
      };

      if (closing) {
        this.instance = new ServerInstance();
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : String(error));
    }
  }
}
