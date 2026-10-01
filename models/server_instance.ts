import {
  BranchSummary,
  EvidenceEntry,
  EvidenceItem,
  PrevCycle,
} from "./types.js";

const UNRESOLVED: ReadonlySet<PrevCycle> = new Set<PrevCycle>([
  "proposed",
  "testing",
]);

export class ServerInstance {
  private history: EvidenceEntry[] = [];
  private branches: Record<string, EvidenceEntry[]> = {};

  append(entry: EvidenceEntry): void {
    this.history.push(entry);
    (this.branches[entry.branchId] ??= []).push(entry);
  }

  historyLength(): number {
    return this.history.length;
  }

  branchIds(): string[] {
    return Object.keys(this.branches);
  }

  first(branchId: string): EvidenceEntry | undefined {
    return this.branches[branchId]?.[0];
  }

  latest(branchId: string): EvidenceEntry | undefined {
    const entries = this.branches[branchId];
    return entries?.length ? entries[entries.length - 1] : undefined;
  }

  currentCycle(branchId: string): PrevCycle {
    return this.latest(branchId)?.cycle ?? "new";
  }

  evidenceOf(branchId: string): EvidenceItem[] {
    return (this.branches[branchId] ?? []).flatMap((e) => e.evidence ?? []);
  }

  unresolvedBranchIds(pending?: EvidenceEntry): string[] {
    const ids = new Set(this.branchIds());
    if (pending) ids.add(pending.branchId);
    return [...ids].filter((id) => {
      const cycle =
        pending && pending.branchId === id
          ? pending.cycle
          : this.currentCycle(id);
      return UNRESOLVED.has(cycle);
    });
  }

  branchSummaries(): BranchSummary[] {
    return this.branchIds().map((branchId) => {
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
}
