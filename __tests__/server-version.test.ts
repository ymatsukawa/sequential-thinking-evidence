import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolvePackageVersion, SERVER_VERSION } from "../version.js";

const packageJson = createRequire(import.meta.url)("../package.json") as {
  version: string;
};
const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distVersionPath = path.join(packageRoot, "dist", "version.js");
const distIndexPath = path.join(packageRoot, "dist", "index.js");

describe("server version", () => {
  it("uses package.json version instead of a hardcoded string", () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(resolvePackageVersion()).toBe(packageJson.version);
  });

  it.skipIf(!existsSync(distVersionPath))(
    "resolves package.json from the dist layout after build",
    async () => {
      const distModule = (await import(
        pathToFileURL(distVersionPath).href
      )) as {
        SERVER_VERSION: string;
      };
      expect(distModule.SERVER_VERSION).toBe(packageJson.version);
    },
  );

  it.skipIf(!existsSync(distIndexPath))(
    "stdio initialize reports package.json version in serverInfo",
    async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [distIndexPath],
        cwd: packageRoot,
        stderr: "pipe",
      });
      const client = new Client({ name: "version-smoke", version: "0.0.0" });

      try {
        await client.connect(transport);
        const serverInfo = client.getServerVersion();
        expect(serverInfo?.name).toBe("sequential-thinking-evidence-server");
        expect(serverInfo?.version).toBe(packageJson.version);
      } finally {
        await client.close();
      }
    },
  );
});

describe.skipIf(!existsSync(distIndexPath))("server contract", () => {
  async function withClient(run: (client: Client) => Promise<void>) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distIndexPath],
      cwd: packageRoot,
      stderr: "pipe",
    });
    const client = new Client({ name: "contract-smoke", version: "0.0.0" });
    try {
      await client.connect(transport);
      await run(client);
    } finally {
      await client.close();
    }
  }

  it("reports the companion workflow in server instructions", async () => {
    await withClient(async (client) => {
      const instructions = client.getInstructions();
      expect(instructions).toContain("sequential-thinking");
      expect(instructions).toContain("cycle=proposed");
      expect(instructions).toContain("newSession=true");
      expect(instructions).toContain("nextThoughtNeeded=false");
      expect(instructions).toContain("finalConclusion");
    });
  });

  it("marks the tool as stateful in annotations", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "sequentialthinking-evidence");
      expect(tool?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    });
  });

  it("keeps the workflow out of the tool description", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "sequentialthinking-evidence");
      expect(tool?.description).not.toContain("nextThoughtNeeded");
      expect(tool?.description).not.toContain("right after any");
    });
  });
});
