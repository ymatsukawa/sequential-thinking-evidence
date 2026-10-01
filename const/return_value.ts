export const RET_VAL = {
  mcp_action: {
    next: {
      done: "Done. Return to sequentialthinking and finish",
      inspect: (branchId: string) =>
        `Inspect branch ${branchId}, then call again with cycle=testing`,
      continue_inspect: (branchId: string) =>
        `Continue inspecting branch ${branchId}`,
      resolve_unresolved: (ids: string) =>
        `Resolve branches [${ids}] before finishing sequentialthinking. ` +
        "If they belong to an abandoned task, call cycle=proposed with newSession=true",
      all_resolved:
        "All branches resolved. Call again with finalConclusion and needsMoreInspect=false",
    },
  },
  validation: {
    transition: {
      invalid_transition: (
        from: string,
        to: string,
        branchId: string,
        allowed: string,
      ) =>
        `Invalid transition ${from === "new" ? "a new branch" : from} -> ${to} on branch ${branchId}. Allowed next cycle: ${allowed}`,
    },
    identity: {
      claim_fixed: (branchId: string, claim: string) =>
        `claim of branch ${branchId} is fixed at proposed ("${claim}"). Reject it and start a new branch with derivedFromBranchId to change the claim`,
      source_thought_fixed: (branchId: string, sourceThoughtNumber: number) =>
        `sourceThoughtNumber of branch ${branchId} is fixed at ${sourceThoughtNumber}. Reject it and start a new branch with derivedFromBranchId to change the source`,
      source_branch_fixed: (branchId: string, sourceBranchId?: string) =>
        `sourceBranchId of branch ${branchId} is fixed at ${sourceBranchId ?? "(main line, omitted)"}. Reject it and start a new branch with derivedFromBranchId to change the source`,
    },
    validated: {
      no_evidence: (branchId: string) =>
        `validated requires at least one evidence item collected on branch ${branchId}. Add evidence[] or use cycle=testing`,
      only_guessed: (branchId: string) =>
        `validated requires at least one non-guessed evidence item (referenced, measured, or observed) collected on branch ${branchId}. Keep cycle=testing until you have one`,
      invalid_claim_basis: (branchId: string, claimBasis: string) =>
        `validated requires claimBasis=fact or inference on branch ${branchId} (got ${claimBasis}). Keep cycle=testing until claimBasis is fact or inference`,
    },
    rejected: {
      no_reason: (branchId: string) =>
        `rejected requires rejectionReason on branch ${branchId}`,
    },
    derived_from: {
      same_as_branch: (branchId: string) =>
        `derivedFromBranchId must differ from branchId (${branchId})`,
      not_exist: (derivedFromBranchId: string, knownBranchIds: string[]) =>
        `derivedFromBranchId ${derivedFromBranchId} does not exist. Known branches: ${knownBranchIds.join(", ") || "(none)"}`,
    },
    session: {
      final_while_unresolved: (ids: string) =>
        `finalConclusion is not allowed while branches [${ids}] are unresolved. Validate or reject them first`,
      stop_while_unresolved: (ids: string) =>
        `needsMoreInspect=false but branches [${ids}] are unresolved. Set needsMoreInspect=true or resolve them first`,
    },
  },
  lib: {
    new_session_not_proposed: (cycle: string) =>
      `newSession=true is allowed only with cycle=proposed (got ${cycle})`,
  },
  input: {
    blank: "Must not be empty or whitespace only",
    ref_required:
      "ref is required unless kind=guessed. Give the path, URL, or command that yielded the evidence, or use kind=guessed",
    invalid_boolean: (val: string) =>
      `Expected boolean or "true"/"false" string, received "${val}"`,
  },
};
