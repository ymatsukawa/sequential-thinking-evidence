# sequential-thinking-evidence mcp

Support mcp of sequential-thinking.

## Background
[`modelcontextprotocol/sequentialthinking`](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) is good at strategic reasoning, but nothing tells whether a thought is backed by evidence.

This mcp promotes every "thought" are verified or not.

## sequential-thinking-evidence

### Inputs

| Name | Type | Required | Meaning |
|---|---|---|---|
| `cycle` | `proposed` / `testing` / `validated` / `rejected` | yes | Lifecycle state of the claim |
| `branchId` | string | yes | Evidence branch id, e.g. `"1"`, `"2"` |
| `sourceThoughtNumber` | integer | yes | `sequentialthinking` thoughtNumber the claim comes from |
| `sourceBranchId` | string | no | `sequentialthinking` branchId; omit for the main line |
| `derivedFromBranchId` | string | no | Evidence branch this branch derives from |
| `claim` | string | yes | One falsifiable sentence under inspection |
| `inspection` | string | yes | What is being inspected now, or the plan when `proposed` |
| `evidence` | array of `{ kind, ref?, summary }` | no | Required for `validated`. `kind` is `observation` / `document` / `test` / `reasoning` / `external` |
| `confidence` | number 0..1 | no | Confidence in the claim |
| `rejectionReason` | string | no | Required for `rejected` |
| `needsMoreInspect` | boolean | yes | Whether more inspection is needed in this session |
| `finalConclusion` | string | no | Final conclusion once every branch is resolved |

### Transitions

| From | To |
|---|---|
| (new branch) | `proposed` |
| `proposed` | `testing`, `rejected` |
| `testing` | `testing`, `validated`, `rejected` |
| `validated` | `testing`, `validated` |
| `rejected` | `testing`, `rejected` |

Violations return `isError: true` with a message that says how to fix the call.

### Output

- `branchId`, `cycle`, `sourceThoughtNumber`, `needsMoreInspect`
- `branches`: latest state of every branch
- `unresolvedBranchIds`: branches still `proposed` or `testing`
- `historyLength`
- `nextAction`: what to do next
- `finalConclusion` when given

## Abstract workflow
```text
st:  sequential-thinking
stE: sequential-thinking-evidence
===

1:   st      | #3 "the cause is probably connection pool exhaustion"
1-1: stE     | cycle=proposed  branchId=1 sourceThoughtNumber=3 claim="pool exhaustion is the cause"
1-2: stE     | cycle=testing   branchId=1 evidence=[{kind:observation, ref:"metrics/pool", summary:"pinned at max"}]
1-3: stE     | cycle=validated branchId=1 confidence=0.8 needsMoreInspect=false finalConclusion="..."
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