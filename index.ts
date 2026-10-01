#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CLAIM_BASIS_KINDS, CYCLES, EvidenceServer } from "./lib.js";
import { SERVER_VERSION } from "./version.js";
import { RET_VAL } from "./const/return_value.js";

const coercedBoolean = z
  .union([z.boolean(), z.string()])
  .transform((val, ctx) => {
    if (typeof val === "boolean") return val;
    if (val.toLowerCase() === "true") return true;
    if (val.toLowerCase() === "false") return false;
    ctx.addIssue({
      code: "custom",
      message: RET_VAL.input.invalid_boolean(val),
    });
    return z.NEVER;
  });

const blankError = RET_VAL.input.blank;
const text = z.string().trim().min(1, { error: blankError });

const refError = RET_VAL.input.ref_required;

const cycleSchema = z.enum(CYCLES);

const evidenceKindDescription =
  "Kind of evidence:\n" +
  "- referenced: read from documents or source code\n" +
  "- measured: produced by running a test, command, or metric\n" +
  "- observed: seen directly (logs, UI, behavior)\n" +
  "- guessed: not directly confirmed; reasoned or estimated";
const evidenceSummary = text.describe(
  "What the evidence shows, in one or two sentences",
);

const evidenceItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("guessed").describe(evidenceKindDescription),
    ref: text
      .optional()
      .describe("Path, URL, or command the guess is based on, if any"),
    summary: evidenceSummary,
  }),
  z.object({
    kind: z
      .enum(["referenced", "measured", "observed"])
      .describe(evidenceKindDescription),
    ref: z
      .string({ error: refError })
      .trim()
      .min(1, { error: refError })
      .describe(
        "Path, URL, or command that yielded the evidence. Required unless kind=guessed",
      ),
    summary: evidenceSummary,
  }),
]);

const server = new McpServer(
  { name: "sequential-thinking-evidence-server", version: SERVER_VERSION },
  {
    instructions: `Use together with sequential-thinking.
- After a sequentialthinking thought that makes a checkable claim, call sequentialthinking-evidence with cycle=proposed.
- Thoughts that only plan or summarize need no branch.
- On the first proposed of a new user task, set newSession=true to drop branches left by an earlier task.
- Do not set nextThoughtNeeded=false while unresolvedBranchIds is not empty.
- Finish with one call carrying finalConclusion. It closes the session.`,
  },
);

const evidenceServer = new EvidenceServer();

server.registerTool(
  "sequentialthinking-evidence",
  {
    title: "Sequential Thinking Evidence",
    description: `Track whether a claim from a sequential-thinking thought is backed by evidence.

Lifecycle of claim (branchId):
- proposed: register the claim taken from the thought. Set sourceThoughtNumber.
- testing: report what you inspected. Send only the evidence items found in this call; the server keeps them per branch.
- validated: requires at least one evidence item collected on the branch that is not kind=guessed, and claimBasis=fact|inference.
- rejected: requires rejectionReason. Start a new branch with derivedFromBranchId if you pivot.

Allowed transitions:
- new branch -> proposed
- proposed -> testing | rejected
- testing -> testing | validated | rejected
- validated -> testing (re-inspect) | validated (restate)
- rejected -> testing (re-inspect) | rejected (restate)

Rules:
- One branchId per claim. Reuse it across cycles of the same claim.
- claim, sourceThoughtNumber and sourceBranchId are fixed at proposed. Send the same values on every call of the branch.
  To change them, reject the branch and start a new one with derivedFromBranchId.
- Set claimBasis on every call: fact | assumption | inference | opinion.
- sourceThoughtNumber is the sequential-thinking thoughtNumber the claim comes from.
  sourceBranchId is the sequential-thinking branchId; omit it for the main line.
- needsMoreInspect=true while any branch is still proposed or testing.
- When every branch is validated or rejected, call once more with finalConclusion and needsMoreInspect=false.
  That call may restate the last branch's terminal cycle without resending evidence.
- Invalid input is rejected with an error message that says how to fix it. Fix and call again.
- The response tells you what to do next in nextAction. Follow it.`,
    inputSchema: {
      cycle: cycleSchema.describe("Lifecycle state of this claim"),
      branchId: z.string().min(1).describe("Evidence branch id, e.g. '1', '2'"),
      sourceThoughtNumber: z.coerce
        .number()
        .int()
        .min(1)
        .describe("sequential-thinking thoughtNumber this claim comes from"),
      sourceBranchId: z
        .string()
        .optional()
        .describe("sequential-thinking branchId, omit for the main line"),
      derivedFromBranchId: z
        .string()
        .optional()
        .describe("Evidence branchId this branch derives from"),
      claim: text.describe("One falsifiable sentence under inspection"),
      inspection: text.describe(
        "What is being inspected now, or the inspection plan when proposed",
      ),
      evidence: z
        .array(evidenceItemSchema)
        .optional()
        .describe(
          "New evidence found in this call. The server keeps evidence of earlier calls on the same branch",
        ),
      claimBasis: z
        .enum(CLAIM_BASIS_KINDS)
        .describe(
          "Basis of the claim: fact | assumption | inference | opinion. validated requires fact or inference",
        ),
      rejectionReason: text
        .optional()
        .describe("Why the claim was rejected. Required for rejected"),
      needsMoreInspect: coercedBoolean.describe(
        "Whether more inspection is needed in this session",
      ),
      finalConclusion: text
        .optional()
        .describe(
          "Final conclusion once every branch is validated or rejected. Accepting it closes the session",
        ),
      newSession: coercedBoolean
        .optional()
        .describe(
          "Discard every existing branch before this call. Use on the first proposed of a new user task, or to drop branches of an abandoned task. Allowed only with cycle=proposed",
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    outputSchema: {
      branchId: z.string(),
      cycle: cycleSchema,
      sourceThoughtNumber: z.number(),
      needsMoreInspect: z.boolean(),
      branches: z.array(
        z.object({
          branchId: z.string(),
          cycle: cycleSchema,
          claim: z.string(),
          sourceThoughtNumber: z.number(),
          claimBasis: z.enum(CLAIM_BASIS_KINDS).optional(),
          evidenceCount: z.number(),
        }),
      ),
      unresolvedBranchIds: z.array(z.string()),
      historyLength: z.number(),
      nextAction: z.string(),
      finalConclusion: z.string().optional(),
      discardedBranchIds: z.array(z.string()),
    },
  },
  async (args) => {
    const result = evidenceServer.processEntry(args);

    if (result.isError) {
      return result;
    }

    const parsedContent = JSON.parse(result.content[0].text);

    return {
      content: result.content,
      structuredContent: parsedContent,
    };
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sequential Thinking Evidence MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
