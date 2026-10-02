import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distIndexPath = path.join(packageRoot, "dist", "index.js");

// Runs against the built server so it checks the schema the SDK actually emits.
describe.skipIf(!existsSync(distIndexPath))(
  "sequentialthinking-evidence input schema",
  () => {
    let client: Client;

    beforeAll(async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [distIndexPath],
        cwd: packageRoot,
        stderr: "pipe",
        env: { ...process.env, DISABLE_EVIDENCE_LOGGING: "true" },
      });
      client = new Client({ name: "input-schema-test", version: "0.0.0" });
      await client.connect(transport);
    });

    afterAll(async () => {
      await client?.close();
    });

    it("advertises the required fields", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "sequentialthinking-evidence");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toEqual(
        expect.arrayContaining([
          "cycle",
          "branchId",
          "sourceThoughtNumber",
          "claim",
          "inspection",
          "claimBasis",
          "needsMoreInspect",
        ]),
      );
      expect(tool!.inputSchema.required).not.toEqual(
        expect.arrayContaining([
          "evidence",
          "rejectionReason",
          "finalConclusion",
          "newSession",
        ]),
      );
    });

    it("accepts string coercion for newSession", async () => {
      const result = await client.callTool({
        name: "sequentialthinking-evidence",
        arguments: {
          cycle: "proposed",
          branchId: "9",
          sourceThoughtNumber: 1,
          claim: "X",
          inspection: "plan",
          claimBasis: "fact",
          needsMoreInspect: true,
          newSession: "true",
        },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        historyLength: number;
        discardedBranchIds: string[];
      };
      expect(structured.historyLength).toBe(1);
      expect(Array.isArray(structured.discardedBranchIds)).toBe(true);
    });

    it("rejects a call without claimBasis", async () => {
      const result = await client.callTool({
        name: "sequentialthinking-evidence",
        arguments: {
          cycle: "proposed",
          branchId: "3",
          sourceThoughtNumber: 1,
          claim: "X",
          inspection: "plan",
          needsMoreInspect: true,
        },
      });
      expect(result.isError).toBe(true);
    });

    it("rejects an unknown claimBasis value", async () => {
      const result = await client.callTool({
        name: "sequentialthinking-evidence",
        arguments: {
          cycle: "proposed",
          branchId: "3",
          sourceThoughtNumber: 1,
          claim: "X",
          inspection: "plan",
          claimBasis: "guess",
          needsMoreInspect: true,
        },
      });
      expect(result.isError).toBe(true);
    });

    it("accepts string coercion for needsMoreInspect and numbers", async () => {
      const result = await client.callTool({
        name: "sequentialthinking-evidence",
        arguments: {
          cycle: "proposed",
          branchId: "1",
          sourceThoughtNumber: "3",
          claim: "X",
          inspection: "plan",
          claimBasis: "fact",
          needsMoreInspect: "True",
        },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        needsMoreInspect: boolean;
        sourceThoughtNumber: number;
      };
      expect(structured.needsMoreInspect).toBe(true);
      expect(structured.sourceThoughtNumber).toBe(3);
    });

    describe("type coercion", () => {
      const proposed = {
        cycle: "proposed",
        sourceThoughtNumber: 1,
        claim: "X",
        inspection: "plan",
        claimBasis: "fact",
        needsMoreInspect: true,
      };
      const call = (args: Record<string, unknown>) =>
        client.callTool({
          name: "sequentialthinking-evidence",
          arguments: { ...proposed, ...args },
        });
      const textOf = (result: Awaited<ReturnType<typeof call>>) =>
        (result.content as Array<{ type: string; text: string }>)[0].text;

      it("accepts evidence sent as a JSON string", async () => {
        const result = await call({
          branchId: "j1",
          evidence: JSON.stringify([
            { kind: "measured", ref: "npm test", summary: "ok" },
          ]),
        });
        expect(result.isError).toBeFalsy();
        const structured = result.structuredContent as {
          branches: Array<{ branchId: string; evidenceCount: number }>;
        };
        expect(
          structured.branches.find((b) => b.branchId === "j1")!.evidenceCount,
        ).toBe(1);
      });

      it("rejects evidence sent as a non-JSON string", async () => {
        const result = await call({ branchId: "j2", evidence: "not json" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("expected array");
      });

      it("rejects a boolean sourceThoughtNumber", async () => {
        const result = await call({
          branchId: "n1",
          sourceThoughtNumber: true,
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("sourceThoughtNumber");
      });

      it("advertises evidence as an array and sourceThoughtNumber as an integer", async () => {
        const { tools } = await client.listTools();
        const tool = tools.find(
          (t) => t.name === "sequentialthinking-evidence",
        )!;
        const props = tool.inputSchema.properties as Record<
          string,
          { type?: string }
        >;
        expect(props.evidence.type).toBe("array");
        expect(props.sourceThoughtNumber.type).toBe("integer");
      });
    });

    describe("blank strings and ref", () => {
      const proposed = {
        cycle: "proposed",
        sourceThoughtNumber: 1,
        claim: "X",
        inspection: "plan",
        claimBasis: "fact",
        needsMoreInspect: true,
      };
      const call = (args: Record<string, unknown>) =>
        client.callTool({
          name: "sequentialthinking-evidence",
          arguments: { ...proposed, ...args },
        });
      const textOf = (result: Awaited<ReturnType<typeof call>>) =>
        (result.content as Array<{ type: string; text: string }>)[0].text;

      it("requires ref for every kind except guessed in the JSON Schema", async () => {
        const { tools } = await client.listTools();
        const tool = tools.find(
          (t) => t.name === "sequentialthinking-evidence",
        )!;
        const evidence = tool.inputSchema.properties!.evidence as {
          items: {
            oneOf: Array<{
              properties: { kind: { const?: string; enum?: string[] } };
              required: string[];
            }>;
          };
        };
        const [guessed, others] = evidence.items.oneOf;
        expect(guessed.properties.kind.const).toBe("guessed");
        expect(guessed.required).not.toContain("ref");
        expect(others.properties.kind.enum).toEqual([
          "referenced",
          "measured",
          "observed",
        ]);
        expect(others.required).toContain("ref");
      });

      it.each([
        ["claim", { claim: "   " }],
        ["inspection", { inspection: "\n\t" }],
        ["rejectionReason", { rejectionReason: " " }],
        ["finalConclusion", { finalConclusion: " " }],
        [
          "evidence summary",
          { evidence: [{ kind: "guessed", summary: "  " }] },
        ],
      ])("rejects a blank %s", async (_, args) => {
        const result = await call({ branchId: "b1", ...args });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(
          "Must not be empty or whitespace only",
        );
      });

      it("rejects a blank branchId", async () => {
        const result = await call({ branchId: "   " });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(
          "Must not be empty or whitespace only",
        );
      });

      it("trims branchId so ' t1 ' and 't1' are the same branch", async () => {
        await call({ branchId: " t1 " });
        const result = await call({ branchId: "t1", cycle: "testing" });
        expect(result.isError).toBeFalsy();
        const structured = result.structuredContent as {
          branches: Array<{ branchId: string }>;
        };
        expect(
          structured.branches.filter((b) => b.branchId.includes("t1")),
        ).toEqual([expect.objectContaining({ branchId: "t1" })]);
      });

      it("treats a blank sourceBranchId as omitted", async () => {
        await call({ branchId: "s1", sourceBranchId: "" });
        const result = await call({ branchId: "s1", cycle: "testing" });
        expect(result.isError).toBeFalsy();
      });

      it("treats a blank derivedFromBranchId as omitted", async () => {
        const result = await call({ branchId: "d1", derivedFromBranchId: " " });
        expect(result.isError).toBeFalsy();
      });

      it.each(["referenced", "measured", "observed"])(
        "rejects kind=%s without ref",
        async (kind) => {
          const result = await call({
            branchId: "b2",
            evidence: [{ kind, summary: "tests failed" }],
          });
          expect(result.isError).toBe(true);
          expect(textOf(result)).toContain(
            "ref is required unless kind=guessed",
          );
        },
      );

      it("rejects a blank ref", async () => {
        const result = await call({
          branchId: "b3",
          evidence: [{ kind: "measured", ref: "  ", summary: "tests failed" }],
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("ref is required unless kind=guessed");
      });

      it("accepts kind=guessed without ref", async () => {
        const result = await call({
          branchId: "g1",
          evidence: [{ kind: "guessed", summary: "follows from A" }],
        });
        expect(result.isError).toBeFalsy();
      });

      it("accepts kind=measured with ref and trims the strings", async () => {
        const result = await call({
          branchId: "m1",
          claim: "  X holds  ",
          evidence: [
            { kind: "measured", ref: " npm test ", summary: "all passed" },
          ],
        });
        expect(result.isError).toBeFalsy();
        const structured = result.structuredContent as {
          branches: Array<{ branchId: string; claim: string }>;
        };
        expect(
          structured.branches.find((b) => b.branchId === "m1")!.claim,
        ).toBe("X holds");
      });
    });

    it("rejects an unknown cycle value", async () => {
      const result = await client.callTool({
        name: "sequentialthinking-evidence",
        arguments: {
          cycle: "done",
          branchId: "2",
          sourceThoughtNumber: 1,
          claim: "X",
          inspection: "plan",
          claimBasis: "fact",
          needsMoreInspect: true,
        },
      });
      expect(result.isError).toBe(true);
    });

    it("returns isError for a transition violation", async () => {
      const result = await client.callTool({
        name: "sequentialthinking-evidence",
        arguments: {
          cycle: "validated",
          branchId: "1",
          sourceThoughtNumber: 3,
          claim: "X",
          inspection: "plan",
          claimBasis: "fact",
          needsMoreInspect: true,
        },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]
        .text;
      expect(text).toContain("Invalid transition");
    });
  },
);
