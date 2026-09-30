#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CYCLES, EVIDENCE_KINDS, EvidenceServer } from './lib.js';
import { SERVER_VERSION } from './version.js';

const coercedBoolean = z.union([z.boolean(), z.string()]).transform((val, ctx) => {
  if (typeof val === "boolean") return val;
  if (val.toLowerCase() === "true") return true;
  if (val.toLowerCase() === "false") return false;
  ctx.addIssue({ code: "custom", message: `Expected boolean or "true"/"false" string, received "${val}"` });
  return z.NEVER;
});

const cycleSchema = z.enum(CYCLES);
const evidenceKindSchema = z.enum(EVIDENCE_KINDS);

const evidenceItemSchema = z.object({
  kind: evidenceKindSchema.describe("Kind of evidence: observation, document, test, reasoning, external"),
  ref: z.string().optional().describe("Path, URL, or command that yielded the evidence"),
  summary: z.string().min(1).describe("What the evidence shows, in one or two sentences"),
});

const server = new McpServer({
  name: "sequential-thinking-evidence-server",
  version: SERVER_VERSION,
});

const evidenceServer = new EvidenceServer();

server.registerTool(
  "sequentialthinking-evidence",
  {
    title: "Sequential Thinking Evidence",
    description: `Companion tool for sequential-thinking. Records whether each thought is backed by evidence.

Call this tool right after any sequential-thinking call whose thought contains a hypothesis,
an assumption, or a conclusion. Do not skip it.

Lifecycle per claim (branchId):
- proposed: register the claim taken from the thought. Set sourceThoughtNumber.
- testing: report what you inspected. Add evidence items as you find them.
- validated: requires at least one evidence item. Give confidence 0..1.
- rejected: requires rejectionReason. Start a new branch with derivedFromBranchId if you pivot.

Allowed transitions:
- new branch -> proposed
- proposed -> testing | rejected
- testing -> testing | validated | rejected
- validated -> testing (re-inspect) | validated (restate)
- rejected -> testing (re-inspect) | rejected (restate)

Rules:
- One branchId per claim. Reuse it across cycles of the same claim.
- sourceThoughtNumber is the sequential-thinking thoughtNumber the claim comes from.
  sourceBranchId is the sequential-thinking branchId; omit it for the main line.
- needsMoreInspect=true while any branch is still proposed or testing.
- sequential-thinking must not set nextThoughtNeeded=false while this tool reports unresolved branches.
- When every branch is validated or rejected, call once more with finalConclusion and needsMoreInspect=false.
  That call may restate the last branch's terminal cycle.
- Invalid input is rejected with an error message that says how to fix it. Fix and call again.
- The response tells you what to do next in nextAction. Follow it.`,
    inputSchema: {
      cycle: cycleSchema.describe("Lifecycle state of this claim"),
      branchId: z.string().min(1).describe("Evidence branch id, e.g. '1', '2'"),
      sourceThoughtNumber: z.coerce.number().int().min(1)
        .describe("sequential-thinking thoughtNumber this claim comes from"),
      sourceBranchId: z.string().optional()
        .describe("sequential-thinking branchId, omit for the main line"),
      derivedFromBranchId: z.string().optional()
        .describe("Evidence branchId this branch derives from"),
      claim: z.string().min(1).describe("One falsifiable sentence under inspection"),
      inspection: z.string().min(1).describe("What is being inspected now, or the inspection plan when proposed"),
      evidence: z.array(evidenceItemSchema).optional()
        .describe("Evidence collected so far. Required for validated"),
      confidence: z.coerce.number().min(0).max(1).optional()
        .describe("Confidence in the claim, 0 to 1"),
      rejectionReason: z.string().optional()
        .describe("Why the claim was rejected. Required for rejected"),
      needsMoreInspect: coercedBoolean.describe("Whether more inspection is needed in this session"),
      finalConclusion: z.string().optional()
        .describe("Final conclusion once every branch is validated or rejected"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    outputSchema: {
      branchId: z.string(),
      cycle: cycleSchema,
      sourceThoughtNumber: z.number(),
      needsMoreInspect: z.boolean(),
      branches: z.array(z.object({
        branchId: z.string(),
        cycle: cycleSchema,
        claim: z.string(),
        sourceThoughtNumber: z.number(),
        confidence: z.number().optional(),
      })),
      unresolvedBranchIds: z.array(z.string()),
      historyLength: z.number(),
      nextAction: z.string(),
      finalConclusion: z.string().optional(),
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
  }
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
