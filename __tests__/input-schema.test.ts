import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndexPath = path.join(packageRoot, 'dist', 'index.js');

// Runs against the built server so it checks the schema the SDK actually emits.
describe.skipIf(!existsSync(distIndexPath))('sequentialthinking-evidence input schema', () => {
  let client: Client;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distIndexPath],
      cwd: packageRoot,
      stderr: 'pipe',
      env: { ...process.env, DISABLE_EVIDENCE_LOGGING: 'true' },
    });
    client = new Client({ name: 'input-schema-test', version: '0.0.0' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('advertises the required fields', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'sequentialthinking-evidence');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(
      expect.arrayContaining([
        'cycle', 'branchId', 'sourceThoughtNumber', 'claim', 'inspection', 'needsMoreInspect',
      ])
    );
    expect(tool!.inputSchema.required).not.toEqual(
      expect.arrayContaining(['evidence', 'confidence', 'rejectionReason', 'finalConclusion'])
    );
  });

  it('accepts string coercion for needsMoreInspect and numbers', async () => {
    const result = await client.callTool({
      name: 'sequentialthinking-evidence',
      arguments: {
        cycle: 'proposed',
        branchId: '1',
        sourceThoughtNumber: '3',
        claim: 'X',
        inspection: 'plan',
        needsMoreInspect: 'True',
      },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { needsMoreInspect: boolean; sourceThoughtNumber: number };
    expect(structured.needsMoreInspect).toBe(true);
    expect(structured.sourceThoughtNumber).toBe(3);
  });

  it('rejects an unknown cycle value', async () => {
    const result = await client.callTool({
      name: 'sequentialthinking-evidence',
      arguments: {
        cycle: 'done',
        branchId: '2',
        sourceThoughtNumber: 1,
        claim: 'X',
        inspection: 'plan',
        needsMoreInspect: true,
      },
    });
    expect(result.isError).toBe(true);
  });

  it('returns isError for a transition violation', async () => {
    const result = await client.callTool({
      name: 'sequentialthinking-evidence',
      arguments: {
        cycle: 'validated',
        branchId: '1',
        sourceThoughtNumber: 3,
        claim: 'X',
        inspection: 'plan',
        needsMoreInspect: true,
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Invalid transition');
  });
});
