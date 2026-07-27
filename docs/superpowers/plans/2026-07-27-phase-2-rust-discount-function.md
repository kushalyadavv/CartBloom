# CartBloom Phase 2 — Rust Discount Function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Shopify discount function in Rust, proven correct by satisfying the golden vectors produced in Phase 1.5 without modification, and verified applying a real discount at a real checkout.

**Architecture:** The function is a Wasm extension running on Shopify's infrastructure. It reads offer config from its discount node's app metafield, re-derives entitlement from cart state, and emits `PRODUCT`, `ORDER`, and `SHIPPING` discount candidates in a single run. It is a **second implementation** of logic that already exists in TypeScript — `golden.json` (2,146 cases) and `validation-golden.json` (14 cases) are the contract binding them together.

**Tech Stack:** Rust 1.84+, `shopify_function` crate, Wasm, Shopify CLI, Discount Function API 2026-04.

---

## Read before starting

- `docs/superpowers/specs/2026-07-27-cartbloom-design.md` — **§6 Entitlement semantics** (including Arbitration) and **§7 Discount function design** are the specification. Implement them, not your own reading of the TypeScript.
- `docs/superpowers/plans/instruction-budget-result.md` — why this is Rust and not TypeScript.
- `app/entitlement/` — the reference implementation. Read it, but the **spec** is authoritative where they differ; if they differ, that is a bug to report, not a choice to make.

## The rule that governs this entire phase

**The Rust implementation must satisfy `golden.json` and `validation-golden.json` unmodified.**

If a vector cannot be satisfied, that is a **specification disagreement to escalate** — never something to fix by editing the vector to match Rust's behaviour. The vectors are the contract; editing them to match a new implementation defeats their entire purpose and reintroduces the divergence they exist to prevent.

Phase 1.5 exists because a review found 9 of 13 wrong implementations passing an earlier vector set. Do not weaken it.

---

## Prerequisites

- **`cargo` is not installed** as of 2026-07-27. Task 20 installs it.
- Task 13 (Cloudflare Workers + D1 hosting spike) is **independent** of this phase. The Rust function deploys to Shopify, not to our infrastructure. Do not block on it.
- The app scaffold exists at the repo root with `client_id = "ea5916404234f5396ec07877cfcd0724"`.

---

## Task 20: Establish the real Rust toolchain and scaffold

**Do not guess build commands.** Published sources currently disagree — the [Rust for Functions](https://shopify.dev/docs/apps/build/functions/programming-languages/rust-for-functions) page specifies `wasm32-unknown-unknown` with Rust 1.84+ and states `wasm32-wasi` is deprecated, while the discount-function build page shows `wasm32-wasip1`. These are different targets.

In Phase 1, guessing at toolchain commands cost real time: `brew install shopify-function-runner` does not exist, and `npx shopify-function build` does not exist. **Take the truth from what the CLI actually generates.**

**Files:** create `extensions/<name>/` (CLI-generated); create `docs/superpowers/plans/rust-toolchain-notes.md`

- [ ] **Step 1: Install Rust**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version
```

Expected: 1.84.0 or higher. If lower, `rustup update stable`.

- [ ] **Step 2: Generate the function extension with the CLI**

```bash
shopify app generate extension
```

Choose the **discount** function type and **Rust** as the language. This is interactive and requires Shopify Partners authentication — if you are an agent without browser access, **stop here and report NEEDS_CONTEXT**; a human must run this step.

- [ ] **Step 3: Record what was actually generated**

Read the generated `shopify.extension.toml`, `Cargo.toml`, `src/`, and any `.graphql` files. Write `docs/superpowers/plans/rust-toolchain-notes.md` capturing verbatim:

- The exact `[extensions.build] command` and `path`
- The Wasm target actually used
- The `api_version`
- The `shopify_function` crate version
- The `[[extensions.targeting]]` entries, their `target` values, `input_query` paths, and `export` names
- The generated project layout

Everything downstream uses these recorded values, not the ones in this document.

- [ ] **Step 4: Build the untouched scaffold**

```bash
cargo build --target=<target from Step 3> --release
```

Expected: a `.wasm` artifact at the recorded path. **The compiled Wasm must stay under 256 kB** — record the starting size so growth is visible later.

- [ ] **Step 5: Commit**

```bash
git add extensions/ docs/superpowers/plans/rust-toolchain-notes.md
git commit -m "chore: scaffold Rust discount function extension

Toolchain and build commands recorded verbatim from CLI output rather
than from documentation, which currently disagrees with itself about
the Wasm target."
```

---

## Task 21: Port the entitlement core to Rust

Mirror the TypeScript module structure so the two stay reviewable side by side: one file per stage, each independently testable.

**Files:** create `extensions/<name>/src/entitlement/{types,subtotal,tiers,within_tier,across_tiers,rewards,resolve,validate_gifts}.rs`

- [ ] **Step 1: Define the types**

Mirror `app/entitlement/types.ts`. All money is `i64` **integer minor units**; percentages are integers 0–100. Use `serde` derives — these types must deserialise the golden vectors directly.

Enums (`TriggerMetric`, `RewardKind`, `GiftDiscountType`, `WithinTierPolicy`, `AcrossTierPolicy`, `SingleTierResolution`) must serialise to the **exact** SCREAMING_SNAKE strings in the vectors. Use `#[serde(rename_all = "SCREAMING_SNAKE_CASE")]` and verify against the JSON rather than assuming.

- [ ] **Step 2: Port each stage, one at a time, with its own unit tests**

Port in dependency order: `subtotal` → `tiers` → `within_tier` → `across_tiers` → `rewards` → `resolve` → `validate_gifts`. After each, write Rust unit tests mirroring the corresponding TypeScript test file, then `cargo test`.

**Three places where a naive port will be wrong:**

1. **`qualifying_measure`** — computed from **undiscounted** prices of **non-gift** lines only. A line is a gift if `gift_offer_id` is set **for any offer**, not just this one. Any other basis causes the oscillation bug (spec §7 Trap 1).
2. **`unlocked_tiers`** — must sort ascending by threshold, and **the tie-break is config order**. Use `sort_by` (stable), **not** `sort_unstable_by`. Tied thresholds are covered by vectors and a mutant; `sort_unstable_by` is free to reorder them and will fail.
3. **`across_tiers` `PINNED`** — fails closed. Absent, unknown, or naming a locked tier all grant nothing. Do not add a `HIGHEST` fallback; the idiomatic `Option` match happens to be correct here.

- [ ] **Step 3: Port arbitration — the security boundary**

`validate_gift_lines(cart, offer) -> HashMap<String, GiftValidation>`, mirroring `app/entitlement/validateGifts.ts`. Per spec §6 Arbitration:

- Value: `FREE` → `unit_price`; `PERCENT` → `(unit_price * value) / 100` using **integer division** (matches TypeScript's `Math.floor` for non-negative values); `FIXED` → `min(value, unit_price)`.
- Sort **value descending, then line id ascending byte-lexicographic**. Rust's `str` `Ord` is already byte-lexicographic, so plain `cmp` is correct — this is the one place Rust is simpler than the TypeScript, which needed a hand-rolled code-point comparison because UTF-16 code-unit order disagrees above U+FFFF.
- Budgets: one claim per tier under `PICK_ONE`; one per offer under `SINGLE`; `maxQty` a budget per `(tier_id, variant_id)` **summed across lines**.
- Every gift-claiming line appears in the returned map, including rejected ones.
- Lines with `quantity <= 0` must not consume budget.

**Never trust `_cartbloom_*` attributes as evidence.** Re-derive entitlement from cart state; attributes identify only what a line claims. The invariant: the worst outcome of a client-side exploit is a confused shopper, never a merchant losing inventory.

- [ ] **Step 4: `cargo test` green, then commit**

---

## Task 22: Vector conformance — the parity gate

**Files:** create `extensions/<name>/tests/conformance.rs`

- [ ] **Step 1: Load the vectors**

Deserialise `app/entitlement/vectors/golden.json` and `validation-golden.json` from the repo root. Do **not** copy them — a copy drifts. Reference the canonical files by relative path.

- [ ] **Step 2: Assert every vector**

For each entitlement vector, assert `resolve_offer(cart, offer)` equals `expected`. For each validation vector, assert `validate_gift_lines(cart, offer)` equals `expected` (compare as maps; ignore ordering).

- [ ] **Step 3: Run**

```bash
cargo test --test conformance
```

Expected: 2,160 assertions pass.

**If any fail:** do not adjust the vector. Diff Rust's output against `expected`, determine which implementation contradicts spec §6/§7, and **report it**. A vector failure is either a Rust bug or a genuine specification disagreement — both need a decision, neither is fixed by editing JSON.

- [ ] **Step 4: Commit**

---

## Task 23: Wire the function to the Discount Function API

**Files:** modify `extensions/<name>/src/run.rs`, `src/run.graphql`, `shopify.extension.toml`

- [ ] **Step 1: Write the input query**

Per spec §7, request: cart lines (`id`, `quantity`, `cost.amountPerQuantity`, merchandise variant with product and `inCollections`, and the `_cartbloom_*` line attributes), `cart.cost.subtotalAmount`, `buyerIdentity.customer.hasAnyTag(tags:)`, and the discount node's config metafield.

Request **only** what is used. The 11M instruction budget is generous for Rust but input size still costs.

- [ ] **Step 2: Map the Shopify input to the entitlement core's normalised `Cart`**

This is where `in_scope` is resolved — the core is deliberately scope-agnostic (spec §4). Resolve collection membership here via `inCollections`, and record the approach chosen in the toolchain notes, because **Phase 3's widget must mirror it conservatively**: the widget cannot query collections and must under-count rather than over-count when uncertain.

- [ ] **Step 3: Emit discount operations**

Map entitlements to candidates: validated gift lines → `PRODUCT` candidates targeting the cart line with `quantity` capped at `discount_quantity`; `order_percent`/`order_fixed` → `ORDER` candidates; `free_shipping` → `SHIPPING` candidates. Set `discountClasses` in `shopify.extension.toml` to all three.

- [ ] **Step 4: Test with `function-runner`**

The binary and its install instructions are recorded in `docs/superpowers/plans/instruction-budget-result.md` (the Homebrew formula does not exist; use the GitHub release).

Build a realistic worst-case input and measure. **Record the instruction count.** Rust should land far below 11M — if it does not, escalate immediately, because the fallback options are exhausted.

Also confirm the Wasm stays under **256 kB**.

- [ ] **Step 5: Commit**

---

## Task 24: Create the discount node and config metafield

- [ ] **Step 1:** Declare the config metafield in `shopify.app.toml` under `[discount.metafields.app.function-configuration]` as type `json`.
- [ ] **Step 2:** Implement an Admin GraphQL call creating the automatic app discount via `discountAutomaticAppCreate` with `functionHandle`, `discountClasses`, `title`, and `startsAt`.
- [ ] **Step 3:** **Exactly one discount node per shop.** The cap is 25 app automatic discounts *shared with every other app the merchant has installed* (spec §7 Trap 3). Make creation idempotent and gated per shop; never one per offer or per tier.
- [ ] **Step 4:** Remove the template's demo `[product.metafields.app.demo_info]` and `[metaobjects.app.example]` blocks, and narrow `access_scopes` from the scaffold's `write_products,write_metaobjects,write_metaobject_definitions` to what CartBloom actually needs. Over-broad scopes draw reviewer scrutiny (playbook §4).
- [ ] **Step 5:** Commit.

---

## Task 25: End-to-end verification on a dev store

Nothing before this proves the discount actually applies. **Requires a human** — dev store, real cart, real checkout.

- [ ] **Step 1:** `shopify app dev`, install on a dev store.
- [ ] **Step 2:** Write a config metafield describing a two-tier offer with a gift pool.
- [ ] **Step 3:** Add qualifying products, add a gift line with the `_cartbloom_*` attributes, and confirm at checkout that the gift is discounted and the order total is correct.
- [ ] **Step 4:** **Attempt the exploits.** Add a gift variant not in the pool; claim a locked tier; set the gift line quantity to 5; claim every member of a `PICK_ONE` pool. Confirm each bills at full price. This is the only real test of the §7 invariant — vectors prove the logic, this proves the wiring.
- [ ] **Step 5:** Record results and commit.

---

## Definition of done

- [ ] Toolchain and build commands recorded from actual CLI output
- [ ] All 2,160 vectors satisfied by Rust, **unmodified**
- [ ] `cargo test` green; Wasm under 256 kB; instruction count recorded and well under 11M
- [ ] Exactly one discount node per shop, idempotent
- [ ] Template demo metafields/metaobjects removed; scopes narrowed
- [ ] A real discount verified applying at a real checkout, and every exploit attempt billing at full price

## Carried into Phase 3

- **The scope-resolution approach chosen in Task 23 Step 2.** The widget must mirror it **conservatively** — under-counting rather than over-counting when uncertain. An under-promising bar is cosmetic; an over-promising one charges the customer for something the bar said was free.
- **The mutation harness** (`app/entitlement/vectors/mutants.test.ts`) stays the gate. Any new entitlement behaviour ships with vectors *and* a mutant in the same commit.
- **Unverified:** JSON metafield size limit against a realistic max config, and whether market/country is exposed on the function input. Both flagged in spec §13 and still outstanding.

---

## Task 26: Compact config encoding and publish-time size validation

Added 2026-07-27 after measurement. **This is a prerequisite for Task 23**, not a follow-up.

Shopify Functions cap metafield values at **10,000 bytes** in input queries (total input 64,000) and deliver an oversized value as a **silent `null`** — the function then grants nothing and every offer in the shop stops working with no signal.

Measured against a verbose config:

| Config | Verbose | Compact |
|---|---|---|
| 1 × 3 × 3 (Free plan) | 1,271 B | 369 B |
| 5 × 6 × 5 (Growth plan) | **16,858 B — over cap** | 4,243 B |
| 10 × 6 × 5 | **33,698 B — over cap** | 8,473 B |

The Growth plan does not fit without compaction. Only 2 offers fit verbose; 11 fit compact.

- [ ] **Step 1:** Define the compact wire format for the **function** payload: bare numeric ids rather than GIDs (`gid://shopify/ProductVariant/1000000000000` is 42 bytes, `1000000000000` is 13), single-character keys, enums as small integers, gift pool entries as positional arrays. Document the mapping in `docs/` — Rust and TypeScript both decode it, so it is a contract like the vectors.
- [ ] **Step 2:** Keep the **widget** payload verbose and readable. It goes to the shop metafield under the 128 KB `json` cap (25 offers ≈ 95 KB) and carries design tokens, copy, and placement the function never reads. Do not compact it; the widget budget is not scarce and readability aids support.
- [ ] **Step 3:** Implement encode (TypeScript, publish side) and decode (Rust, function side). Round-trip test: verbose → compact → decoded must equal the original semantics. Add golden vectors for the encoding itself so the two decoders cannot drift.
- [ ] **Step 4:** **Publish-time size validation.** Refuse to publish when the compact payload exceeds the cap, with a message naming what to cut. Because the failure mode is a silent `null`, the merchant must learn this at publish time, never from a broken storefront.
- [ ] **Step 5:** Above ~11 offers, shard the function config across several discount-node metafields read together in the input query. The 64,000-byte total input cap allows roughly 70 offers at 4–6 shards. Implement sharding only when a plan tier requires it; validation from Step 4 is the gate until then.
- [ ] **Step 6:** Commit.

**Plan caps revised in spec §10 as a result:** Pro is **25 offers / 12 tiers**, not unlimited. "Unlimited" was never deliverable under these limits.
