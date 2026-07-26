# Instruction Budget Result (Task 1)

**Date:** 2026-07-27
**Verdict: FAIL — stop. Do not proceed with a Javy/TypeScript-compiled Shopify Function without re-planning Phase 2 around Rust.**

## Headline number

| Metric | Value |
|---|---|
| Measured instructions (worst-case stand-in) | **43,825,268** |
| Shopify Functions budget | 11,000,000 |
| % of budget consumed | **398.4%** (~4x over) |
| Gate band | **> 8.8M (80%+) → FAIL** |

The number is deterministic and reproducible: three separate `function-runner` invocations against the same `function.wasm` / `input.json` all returned exactly `43825268`.

## What was measured

A worst-case entitlement stand-in matching the plan's spec: 200 cart lines, 5 offers, 6 tiers per offer, 5 gifts per tier's gift pool, `STACK` claim policy (heaviest branch — evaluates every tier, not just the highest unlocked one). Input payload (`input.json`) was 59,986 bytes, in the plan's expected 60–80 KB range.

The core `run()` logic is copied verbatim from the plan's Step 3 code block — no logic was altered to make the result look better or worse.

## Toolchain that actually worked (deviations from the plan's draft commands)

The plan's commands were a starting point; two adaptations were needed based on how current Shopify/Javy tooling is actually structured:

1. **`brew install shopify-function-runner` does not exist** in the `shopify/shopify` tap (as of this measurement, tapping succeeds but no such formula is present). Used the GitHub release binary instead, per the plan's documented fallback:
   ```bash
   curl -sL -o function-runner.gz https://github.com/Shopify/function-runner/releases/download/v9.2.1/function-runner-arm-macos-v9.2.1.gz
   curl -sL -o function-runner.gz.sha256 https://github.com/Shopify/function-runner/releases/download/v9.2.1/function-runner-arm-macos-v9.2.1.gz.sha256
   shasum -a 256 -c function-runner.gz.sha256   # verified match
   gunzip function-runner.gz && chmod +x function-runner
   function-runner --version   # -> function-runner 9.2.1
   ```

2. **`npx shopify-function build` does not exist.** `@shopify/shopify_function` (v2.0.1, installed per the plan) is a pure TypeScript/GraphQL-codegen helper package with no CLI/`bin` entry — its `ShopifyFunction` global (`readInput`/`writeOutput`) is only injected by Shopify CLI's full `shopify app function build` pipeline (dynamic-linked QuickJS provider), which requires a real app/extension scaffold — explicitly out of scope for this task. Instead, compiled directly with the real `javy` compiler (via `javy-cli@3.0.1`, which is a thin auto-downloading wrapper around the official `bytecodealliance/javy` v3.0.1 binary — its own `package.json` even says "Download Javy directly", confirming this is the current supported path):
   ```bash
   npx javy compile src/run.js -o function.wasm
   ```
   `src/run.js` was adapted to use Javy's own documented I/O API (`Javy.IO.readSync`/`writeSync` over stdin/stdout fd 0/1, per the canonical example in the javy README) instead of the `ShopifyFunction` global, since the static-linked `javy compile` output (no `-d` flag) is exactly the module shape `function-runner`'s default `--export _start` "convenience" mode is built to run (its own `--help` text: *"Simple Function runner which takes JSON as a convenience"*). This is a first-class supported mode of `function-runner`, not a workaround. The entitlement logic itself (the `run()` function body) is untouched from the plan.

Full working command sequence:
```bash
mkdir -p spike/instruction-budget/src && cd spike/instruction-budget
npm init -y
npm install --save-dev @shopify/shopify_function javy-cli   # shopify_function ultimately unused for the build itself; installed per plan for completeness
node gen-input.mjs
npx javy compile src/run.js -o function.wasm
function-runner -f function.wasm -i input.json --json
```

Toolchain versions that worked:
- `function-runner` 9.2.1 (GitHub release binary, arm-macos)
- `javy` v3.0.1 (via `javy-cli@3.0.1`, auto-downloaded from `bytecodealliance/javy` releases)
- `@shopify/shopify_function` 2.0.1 (installed, not load-bearing for this measurement)
- Node v22.19.0 / npm 10.9.3

## `function-runner` output (verbatim, JSON payload echoes elided for repo hygiene)

```json
{
  "name": "function.wasm",
  "size": 1201,
  "memory_usage": 1792,
  "instructions": 43825268,
  "logs": "",
  "input": { "...200-line cart + 5-offer config, 59986 bytes, elided..." },
  "output": { "...operations array, elided..." },
  "success": true
}
```

Note: `"success": true` only means the local runner executed the module to completion — `function-runner` does not itself enforce the 11M fuel cap locally; it just reports the instruction count for you to compare against Shopify's published ceiling. At 43,825,268 instructions, this would trip `RunOutOfFuel` on real Shopify infrastructure by a wide margin (~4x the cap).

Reproducibility check (ran 3x, identical every time):
```
run 1: instructions = 43825268
run 2: instructions = 43825268
run 3: instructions = 43825268
```

## Diagnostic: where the instructions go

To understand whether this is a fixable-with-effort problem or a fundamental one, a second variant (`run-io-only.js`, not part of the committed result, diagnostic only) was compiled and measured: identical I/O plumbing (read stdin, `JSON.parse` the ~60KB cart input, `JSON.parse` the embedded config metafield string) but **no entitlement logic at all** — it just echoes counts.

| Variant | Instructions | % of 11M budget |
|---|---|---|
| I/O + JSON parsing only, zero business logic | 18,591,540 | 169.0% |
| Full worst-case (I/O + parsing + entitlement logic) | 43,825,268 | 398.4% |
| Marginal cost of the entitlement logic itself | ~25,233,728 | 229.4% |

**This is the critical finding:** just parsing a realistically-sized cart/config JSON payload through QuickJS-in-Wasm already blows the entire budget by 69%, before a single line of entitlement logic runs. The nested-loop business logic (the nested tier/gift-pool scans, `Array.find`/`filter` calls) then adds roughly 2.3x the total budget on top of that. Both halves of the cost are individually fatal; there is no realistic scope reduction (fewer tiers, fewer gifts, smaller carts within the plan's stated worst-case bounds) that plausibly closes a 4x gap.

## Caveat on how this number could differ from Shopify CLI's real build pipeline

This measurement used `javy compile` directly with a stdin/stdout JSON convenience wrapper, not Shopify CLI's `shopify app function build`, which produces a **dynamically-linked** module (`-d`) using a custom `shopify_function_v2` host ABI that marshals cart/config data from host memory into JS values directly, without a second full-text `JSON.parse` of the outer input on the Wasm side. That means:

- The real production build would likely **avoid** the cost of `JSON.parse`-ing the ~60KB outer cart payload (that parsing happens in the host/Rust side of the ABI instead), which is a meaningful fraction of the 18.6M I/O-only baseline measured here.
- The inner `JSON.parse(config.metafield.value)` call is unavoidable in both approaches — metafields are always delivered as JSON-encoded strings — and that alone is a nontrivial contributor.
- The entitlement-logic-only cost (~25.2M instructions, 229% of budget on its own) is architecture-independent — it reflects interpreted QuickJS execution overhead per loop iteration/property access, and would be paid by any JS-based approach regardless of I/O marshalling strategy.

So the true "real build pipeline" number is very likely **lower than 43.8M but almost certainly still fails**, since the logic-only component alone (~25.2M, 229% of budget) already exceeds the fail threshold (8.8M) by a factor of ~2.9x with zero I/O cost included. This is strong evidence the failure is not an artifact of the measurement shortcut.

## Decision

**FAIL.** Per the gate table in Task 1 Step 7 (>8.8M / 80%+ of budget → FAIL), this result requires escalation to the human and a re-plan of Phase 2 around a Rust-compiled Shopify Function rather than the shared TypeScript-core-via-Javy design. The "shared entitlement core compiles unchanged into both Wasm and browser" architecture, as originally conceived (one TypeScript module, two compile targets), is not viable for the Wasm target at this workload size.
