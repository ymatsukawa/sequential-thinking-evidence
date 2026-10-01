# sequential-thinking-evidence mcp

Support mcp of sequential-thinking.

## Background
[`modelcontextprotocol/sequentialthinking`](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) is good at strategic reasoning, but nothing tells whether a thought is backed by evidence.

This mcp checks each "thoughts" are verified or not.

## sequential-thinking-evidence

## Instruction
See [`description` of `registerTool` at `index.ts`](./index.ts)

## Abstract workflow
```text
st:  sequential-thinking
stE: sequential-thinking-evidence
===

1:   st      | #3 "the cause is probably connection pool exhaustion"
1-1: stE     | cycle=proposed  branchId=1 sourceThoughtNumber=3 claim="pool exhaustion is the cause"
1-2: stE     | cycle=testing   branchId=1 evidence=[{kind:measured, ref:"metrics/pool", summary:"pinned at max"}]
1-3: stE     | cycle=validated branchId=1 claimBasis=fact needsMoreInspect=false finalConclusion="..."
1-4: st      | nextThoughtNeeded=false
```

## Building
```bash
npm run build
```

## Configuration
**claude code**
```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    "sequential-thinking-evidence": {
      "type": "stdio"
      "command": "node",
      "args": ["/path/to/sequential-thinking-evidence/dist/index.js"]
    }
  }
}
```

## Prompt example
```txt
Think {WHAT AND HOW} with sequential-thinking using sequential-thinking-evidence
```

## License
MIT