# Instruction Budget Result (Task 1)

> **Editorial note (added in a same-day follow-up pass):** the stand-in measured below contained an accidental algorithmic flaw — an O(n²)-ish nested `Array.find` scan plus 5x redundant recomputation of an offer-independent sum — that inflated the "logic cost" portion of this result. The measurement itself is real and reproducible and is preserved below unchanged. A corrected re-measurement, with the flaw fixed and a best-case I/O variant, is appended at the bottom in **"Re-measurement: correcting the algorithmic flaw."** Read both — the corrected numbers still FAIL, but the original document's claim that logic cost is "architecture-independent" needed a magnitude correction, explained there.

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

---

## Re-measurement: correcting the algorithmic flaw (same-day follow-up)

### Why this re-measurement happened

The stand-in above (plan Step 3, copied verbatim) contained this pattern inside the offer loop:

```javascript
for (const tier of granting) {          // 6 tiers
  for (const gift of tier.giftPool) {   // x 5 gifts, x 5 offers = 150 iterations
    const match = lines.find((l) => l.merchandise.id === gift.variantId);  // O(200) linear scan
```

150 gift lookups × a 200-line linear scan is ~30,000 line comparisons for something a competent implementation would do with a `Map` built once (200 iterations) plus 150 O(1) lookups (~350 operations). The stand-in also recomputed the cart-value `measure` sum once per offer (5x) even though it never depends on `offer`. Both are accidental mistakes in the stand-in, not inherent properties of "JS logic in Wasm." This re-measurement isolates how much of the original 43,825,268 was the mistake versus real, unavoidable interpreter cost.

### Toolchain reused (unchanged from above)

Same binaries, same versions, no new installs beyond re-fetching the function-runner release binary (the original spike's binary was gone, per the "delete the spike" step):

- `function-runner` 9.2.1 (GitHub release binary, arm-macos)
- `javy` 3.0.1 (static-linked `javy compile`, no `-d`)
- Node v22.19.0 / npm 10.9.3
- Same `gen-input.mjs` (byte-identical to the plan's Step 4 script) → regenerated `input.json` is **59,986 bytes**, identical to the original run.

### Harness reproduction note (important methodological finding)

The original result doc described the I/O wrapper only in prose ("Javy's own documented I/O API... `Javy.IO.readSync`/`writeSync`"), not verbatim source — the spike directory was deleted per Step 8, so the exact bytes were gone. Reconstructing it from the **canonical example in the current Javy README**, using its literal `chunkSize = 1024` stdin-reading loop, reproduced the shape of the result (`"size": 1201` in the function-runner output matched exactly) but **not** the instruction count: 44,938,088 instead of 43,825,268 (+2.5%).

Diagnosing this: measuring an I/O-only variant (parse both JSON payloads, no entitlement logic) with `chunkSize = 1024` gave 19,959,220, well above the original's recorded I/O-only diagnostic of 18,591,540 (+7.4%). Increasing the read buffer to `chunkSize = 65536` (large enough that Javy's stdin read completes in essentially one syscall for a ~60KB input, rather than ~59 chunked reads) dropped this to 18,850,299 (+1.4%), and applied to the full stand-in reproduced **43,826,445 — a 0.003% difference from the original 43,825,268.** This is treated as a successful reproduction; the residual ~1,177-instruction gap is far smaller than any of the effects being measured below.

**Takeaway for future measurements:** the stdin-read chunk size measurably affects the reported instruction count for this metric (each extra `readSync` loop iteration costs real interpreted instructions). All three variants below use the same `chunkSize = 65536` reader, so the comparison between them is apples-to-apples even though the exact original reader implementation could not be recovered byte-for-byte.

### What was changed for each variant

All three variants share the identical I/O wrapper (`readInput`/`writeOutput`, `chunkSize = 65536`) and the identical worst-case input (200 cart lines, 5 offers, 6 tiers, 5 gifts/tier, `STACK` claim policy) so only the entitlement logic (and, for C, the I/O source of the cart) differs.

- **Variant A — baseline.** Byte-identical logic to the plan's Step 3 code block (nested `Array.find`, `measure` recomputed per offer). Reproduces the original measurement.
- **Variant B — algorithmically corrected.**
  - A `Map<merchandise.id, line>` is built once, before the offer loop (200 iterations), and `map.get(gift.variantId)` replaces `lines.find(...)` inside the tier/gift loops. The map is built with "first write wins" (`if (!map.has(id)) map.set(id, line)`) to preserve `Array.find`'s first-match semantics exactly, in case of any duplicate `merchandise.id` across lines.
  - `measure` is computed once, before the offers loop, since it never depended on `offer`.
  - No other logic, output shape, or semantics changed.
- **Variant C — B, minus the outer cart `JSON.parse`.** stdin now carries only `discountNode.metafield` (a separate `config-only.json`, **18,187 bytes**, extracted from the same `input.json`), not the full ~60KB cart payload. The 200 cart lines are instead constructed directly as JS objects inside the module (`buildCartLines()`, an in-source loop producing byte-identical line objects to `gen-input.mjs`), simulating a dynamically-linked `shopify_function_v2` ABI that marshals cart data from host memory into guest JS values rather than handing the guest a JSON string to parse. The inner `JSON.parse(config.metafield.value)` is kept, since metafields are always delivered as JSON-encoded strings regardless of ABI. This is an approximation (a real ABI's marshalling isn't literally "free" either — it still has to materialize per-line JS objects — but it removes specifically the big-string-parse cost, which is what needed isolating).

### Results

| Variant | Instructions | % of 11M budget | Gate band |
|---|---|---|---|
| **A — baseline (reproduction)** | 43,826,445 | 398.4% | **FAIL** (>8.8M) |
| **B — algorithmically corrected** | 37,647,788 | 342.3% | **FAIL** (>8.8M) |
| **C — B, minus outer cart `JSON.parse`** | 30,526,299 | 277.5% | **FAIL** (>8.8M) |

`function-runner` output metadata for each (verbatim, elided for repo hygiene):

```
A: {"name":"function-a.wasm","size":1201,"memory_usage":1792,"instructions":43826445,"success":true}
B: {"name":"function-b.wasm","size":1203,"memory_usage":1792,"instructions":37647788,"success":true}
C: {"name":"function-c.wasm","size":1204,"memory_usage":1664,"instructions":30526299,"success":true}
```

All three were run 3x each; every variant returned an identical instruction count across all 3 runs (deterministic, as with the original measurement).

### Verification: reproduction and output identity

- **A reproduces the original measurement:** 43,826,445 vs. 43,825,268 recorded above — a 0.003% difference (see the harness note above for why it isn't bit-exact: the original I/O wrapper's exact source was lost when the spike directory was deleted, and stdin chunk size measurably affects the count; the reproduction converges to the original once the reader completes the ~60KB input in effectively one syscall). This is close enough that the toolchain and logic reconstruction are considered validated.
- **A, B, and C produce byte-identical output.** All three emit the same 150-operation `operations` array (5 offers × 6 tiers × 5 gifts, `STACK` policy grants every tier, every gift variant exists in the cart). Verified with a three-way `diff` on the captured `output` payloads — clean in all directions (A↔B, A↔C, B↔C). The algorithmic correction and the I/O restructuring changed **only** the instruction count, never the result.

### What the algorithmic fix bought, and what it didn't

| Comparison | Instructions saved | % reduction |
|---|---|---|
| B vs A (Map + hoisted `measure`) | 6,178,657 | 14.1% |
| C vs B (drop outer cart `JSON.parse`) | 7,121,489 | 18.9% |
| C vs A (both fixes combined) | 13,300,146 | 30.3% |

Fixing the O(n²)-shaped mistake and hoisting the redundant sum recovers **14%** of the instruction count — real, but nowhere near enough. Removing the entire outer JSON-parsing step (the best case a production dynamically-linked ABI could plausibly deliver) recovers another **19%** on top of that. Even stacking both best-case corrections, the result (Variant C, 277.5% of budget) is still **2.5x over the FAIL threshold (8.8M)** and **2.8x over the entire budget**, with zero further optimization headroom available from these two specific mistakes.

### Correcting the original document's "architecture-independent" claim

The original document (above) stated: *"The entitlement-logic-only cost (~25.2M instructions, 229% of budget on its own) is architecture-independent... and would be paid by any JS-based approach regardless of I/O marshalling strategy."*

This re-measurement **confirms the architecture-independence claim itself** but **corrects the magnitude** it was based on:

- Isolating the logic-only marginal cost the same way as the original (measured variant minus an I/O-only variant with the same reader):
  - Variant A's logic-only marginal cost: 43,826,445 − 18,850,299 = **24,976,146** (227.1%) — matches the original's ~25.2M to within 1%, confirming the naive-logic reproduction is faithful.
  - Variant B's logic-only marginal cost (against the same full-cart-JSON I/O baseline): 37,647,788 − 18,850,299 = **18,797,489** (171.0%).
  - Variant C's logic-only marginal cost (against the no-outer-parse I/O baseline, 11,751,548): 30,526,299 − 11,751,548 = **18,774,751** (170.7%).
- B's and C's logic-only marginal costs agree to within 0.12% (18,797,489 vs. 18,774,751) **despite being measured against two completely different I/O strategies.** That tight agreement is the actual evidence for architecture-independence — and it holds for the *corrected* logic, not just the original's.
- What was wrong in the original document was the number attached to that claim: ~25.2M was the marginal cost of a JS implementation containing an accidental O(n²) scan, not the honest floor for competently-written entitlement logic. The honest, architecture-independent floor is **~18.8M (171% of budget) — lower than previously stated, but still more than 2x the FAIL threshold on logic alone, with zero I/O cost of any kind included.**

In short: the original document was right that logic cost doesn't depend on I/O/marshalling strategy, and right that this alone is fatal — but it measured the wrong logic. The corrected, honest number is smaller (18.8M vs. 25.2M) and it still fails outright.

### Why the real core will likely be heavier than every one of these numbers

These three variants all measure a deliberately simplified stand-in: gift rewards only, `STACK` claim policy only, no scope resolution. The real entitlement core (per the foundation plan) also has to evaluate, per cart, per offer:

- `QUANTITY` triggers (counting eligible units, not just summing cost)
- Collection/product scope filtering (an additional per-line predicate before the cost sum, effectively another full pass over lines)
- `PINNED` and `CUSTOMER_CHOICE` resolution (additional branching and, for `CUSTOMER_CHOICE`, collecting *all* unlocked tiers' options rather than short-circuiting)
- Non-gift reward types (percentage-off, fixed-amount discounts on existing lines — additional operation-construction branches)

None of this is measured here, and all of it adds more property access, more branching, and in some cases more full passes over `lines` — strictly more instructions, never fewer. There is no plausible reduction in scope within the plan's stated worst-case bounds (fewer tiers, fewer offers, smaller carts) that would close a gap this size (Variant C alone needs to drop by another ~64% just to reach the 8.8M FAIL line, before any real-world feature scope is added back in).

### Revised decision

**FAIL — confirmed, not an artifact of the algorithmic mistake.** Both suspected causes of the original 398% overage were measured independently:

1. The O(n²)-shaped algorithmic mistake: real, but only worth **14%** of the total when fixed honestly (Variant B).
2. The outer cart `JSON.parse`/I/O overhead: real, but only worth another **19%** when removed entirely, best-case (Variant C).

Even with both fixed simultaneously — a strictly best-case, near-idealized scenario that assumes a zero-cost host ABI on top of an honestly-optimized (not micro-tuned) implementation — the result is **277.5% of the 11M budget**, more than double the FAIL line. The shared-entitlement-core-via-Javy/QuickJS-in-Wasm architecture remains not viable for this workload. **Phase 2 must be re-planned around a Rust-compiled Shopify Function**, as the original decision concluded — this re-measurement removes the "but was that just a bug?" doubt, not the conclusion itself.
