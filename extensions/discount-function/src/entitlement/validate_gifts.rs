//! Mirror of `app/entitlement/validateGifts.ts` — THE SECURITY BOUNDARY.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::resolve::resolve_offer;
use super::types::{Cart, CartLine, GiftDiscountType, GiftEntitlement, GiftPoolEntry, Offer};
use super::types::{AcrossTierPolicy, WithinTierPolicy};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftValidation {
    pub valid: bool,
    /// The pool entry that justifies the discount, when valid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<GiftPoolEntry>,
    /// Units that may be discounted. Zero whenever `valid` is false.
    pub discount_quantity: i64,
}

impl GiftValidation {
    fn rejected() -> Self {
        GiftValidation {
            valid: false,
            entry: None,
            discount_quantity: 0,
        }
    }
}

/// A claim that survived matching and is competing for budget.
struct Claim {
    line_id: String,
    quantity: i64,
    tier_id: String,
    entry: GiftPoolEntry,
    /// Discount this claim would yield, in minor units.
    value: i64,
}

/// THE SECURITY BOUNDARY.
///
/// Line attributes are hints written by client-side JavaScript and are trivially
/// forged. Entitlement is re-derived from cart state; the attributes are used
/// only to identify what a line is claiming, never as evidence that the claim is
/// good.
///
/// Validation is deliberately cart-level, not a per-line predicate. Whether a
/// claim may be honoured depends on what the other lines already claimed:
/// PICK_ONE permits one claim per tier, SINGLE one across the offer, and maxQty
/// is a budget of units shared by every line claiming the same pool entry. A
/// per-line predicate cannot see any of that, so under it a crafted cart claimed
/// every product in every unlocked pool and the same variant split across three
/// lines yielded three free units.
///
/// Returns one entry per gift-claiming line — every line carrying an offer id,
/// including the rejected ones. Lines absent from the map claimed nothing and
/// bill normally.
///
/// The worst outcome of a client-side exploit is a confused shopper, never a
/// merchant losing inventory. Preserve that property in every change to this
/// file.
pub fn validate_gift_lines(cart: &Cart, offer: &Offer) -> HashMap<String, GiftValidation> {
    let mut result: HashMap<String, GiftValidation> = HashMap::new();

    // Resolved once for the whole cart, not once per line.
    let entitlements = resolve_offer(cart, offer);

    let mut claims: Vec<Claim> = Vec::new();
    for line in &cart.lines {
        // Not claiming a gift at all — no attribute, so nothing to arbitrate.
        if line.gift_offer_id.is_none() {
            continue;
        }

        // Every claiming line appears in the map. Rejected until it wins budget.
        result.insert(line.id.clone(), GiftValidation::rejected());

        let matched = match match_claim(&entitlements.gifts, offer, line) {
            Some(m) => m,
            None => continue,
        };

        // A line with nothing on it cannot receive a discount, and must not burn
        // a claim budget that a real line could have used.
        if line.quantity <= 0 {
            continue;
        }

        let value = claim_value(&matched.entry, line.unit_price);
        claims.push(Claim {
            line_id: line.id.clone(),
            quantity: line.quantity,
            tier_id: matched.tier_id,
            entry: matched.entry,
            value,
        });
    }

    // Highest-value claim wins; ties break on line id ascending, byte-
    // lexicographic. Rust's `str` `Ord` is already byte-lexicographic, so a
    // plain `cmp` is the contract; the TypeScript side needs a hand-rolled
    // code-point comparison to reproduce it, because UTF-16 code-unit order
    // disagrees above U+FFFF.
    claims.sort_by(|a, b| b.value.cmp(&a.value).then_with(|| a.line_id.cmp(&b.line_id)));

    let one_claim_per_offer = offer.claim_policy.across_tiers == AcrossTierPolicy::Single;
    let one_claim_per_tier = offer.claim_policy.within_tier == WithinTierPolicy::PickOne;

    let mut offer_claim_taken = false;
    let mut tiers_already_claimed: HashSet<String> = HashSet::new();
    // Remaining maxQty units, by tier id then variant id.
    let mut units_left: HashMap<String, HashMap<String, i64>> = HashMap::new();

    for claim in &claims {
        if one_claim_per_offer && offer_claim_taken {
            continue;
        }
        if one_claim_per_tier && tiers_already_claimed.contains(&claim.tier_id) {
            continue;
        }

        let by_variant = units_left.entry(claim.tier_id.clone()).or_default();
        let remaining = *by_variant
            .entry(claim.entry.variant_id.clone())
            .or_insert(claim.entry.max_qty);

        // Budget spent by earlier, more valuable claims on this same pool entry.
        if remaining <= 0 {
            continue;
        }

        let discount_quantity = claim.quantity.min(remaining);
        by_variant.insert(claim.entry.variant_id.clone(), remaining - discount_quantity);
        if one_claim_per_offer {
            offer_claim_taken = true;
        }
        if one_claim_per_tier {
            tiers_already_claimed.insert(claim.tier_id.clone());
        }

        result.insert(
            claim.line_id.clone(),
            GiftValidation {
                valid: true,
                entry: Some(claim.entry.clone()),
                discount_quantity,
            },
        );
    }

    result
}

struct MatchedClaim {
    tier_id: String,
    entry: GiftPoolEntry,
}

/// The pool entry a line is claiming, or `None` when the claim is unsupported —
/// a different offer, a missing or unknown tier, a tier the policy did not
/// grant, or a variant that is in no granted pool.
fn match_claim(gifts: &[GiftEntitlement], offer: &Offer, line: &CartLine) -> Option<MatchedClaim> {
    if line.gift_offer_id.as_deref() != Some(offer.id.as_str()) {
        return None;
    }
    let gift_tier_id = line.gift_tier_id.as_deref()?;

    let entitlement = gifts.iter().find(|g| g.tier_id == gift_tier_id)?;
    let entry = entitlement
        .candidates
        .iter()
        .find(|c| c.variant_id == line.variant_id)?;

    Some(MatchedClaim {
        tier_id: entitlement.tier_id.clone(),
        entry: entry.clone(),
    })
}

/// The discount this claim would yield, in minor units — what "highest-value
/// claim wins" ranks on. Per unit, not per line: quantity is governed by the
/// maxQty budget, not by the ranking.
///
/// PERCENT uses integer division, which matches TypeScript's `Math.floor` for
/// the non-negative values this deals in.
fn claim_value(entry: &GiftPoolEntry, unit_price: i64) -> i64 {
    match entry.discount_type {
        GiftDiscountType::Free => unit_price,
        GiftDiscountType::Percent => (unit_price * entry.value) / 100,
        GiftDiscountType::Fixed => entry.value.min(unit_price),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entitlement::types::{ClaimPolicy, RewardKind, SingleTierResolution, Tier, TriggerMetric};

    fn entry(variant_id: &str) -> GiftPoolEntry {
        GiftPoolEntry {
            variant_id: variant_id.into(),
            discount_type: GiftDiscountType::Free,
            value: 0,
            max_qty: 1,
        }
    }

    fn entry_with(
        variant_id: &str,
        discount_type: GiftDiscountType,
        value: i64,
        max_qty: i64,
    ) -> GiftPoolEntry {
        GiftPoolEntry {
            variant_id: variant_id.into(),
            discount_type,
            value,
            max_qty,
        }
    }

    fn gift_tier(id: &str, threshold: i64, pool: Vec<GiftPoolEntry>) -> Tier {
        Tier {
            id: id.into(),
            threshold,
            reward: RewardKind::Gift,
            value: None,
            gift_pool: pool,
        }
    }

    fn policy(within: WithinTierPolicy, across: AcrossTierPolicy) -> ClaimPolicy {
        ClaimPolicy {
            within_tier: within,
            across_tiers: across,
            single_resolution: None,
            pinned_tier_id: None,
        }
    }

    /// t2 unlocks at 10000 with a pool of three; t3 unlocks at 15000 with one.
    fn offer_with(claim_policy: ClaimPolicy, tiers: Vec<Tier>) -> Offer {
        Offer {
            id: "o1".into(),
            trigger: TriggerMetric::Subtotal,
            claim_policy,
            tiers,
        }
    }

    fn default_tiers() -> Vec<Tier> {
        vec![
            gift_tier(
                "t2",
                10000,
                vec![entry("mug"), entry("tote"), entry("candle")],
            ),
            gift_tier("t3", 15000, vec![entry("hoodie")]),
        ]
    }

    fn default_offer() -> Offer {
        offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            default_tiers(),
        )
    }

    /// A non-gift line whose value carries the cart over a threshold.
    fn spend(amount: i64) -> CartLine {
        CartLine {
            id: "l1".into(),
            quantity: 1,
            unit_price: amount,
            variant_id: "sweater".into(),
            in_scope: vec!["o1".into()],
            gift_offer_id: None,
            gift_tier_id: None,
        }
    }

    fn claim(id: &str, variant_id: &str) -> CartLine {
        CartLine {
            id: id.into(),
            quantity: 1,
            unit_price: 4000,
            variant_id: variant_id.into(),
            in_scope: vec!["o1".into()],
            gift_offer_id: Some("o1".into()),
            gift_tier_id: Some("t2".into()),
        }
    }

    fn claim_at(id: &str, variant_id: &str, unit_price: i64) -> CartLine {
        let mut l = claim(id, variant_id);
        l.unit_price = unit_price;
        l
    }

    fn cart(lines: Vec<CartLine>) -> Cart {
        Cart { lines }
    }

    /// Total free units the offer would hand over for this cart.
    fn granted_units(m: &HashMap<String, GiftValidation>) -> i64 {
        m.values().map(|v| v.discount_quantity).sum()
    }

    fn accepted_ids(m: &HashMap<String, GiftValidation>) -> Vec<String> {
        let mut ids: Vec<String> = m
            .iter()
            .filter(|(_, v)| v.valid)
            .map(|(k, _)| k.clone())
            .collect();
        ids.sort();
        ids
    }

    // ---------------------------------------------------------------------
    // Claim-count budgets. PICK_ONE and SINGLE cannot be enforced by a
    // per-line predicate — it cannot see what the other lines claimed.
    // ---------------------------------------------------------------------

    #[test]
    fn grants_exactly_one_gift_when_pick_one_and_the_whole_pool_is_claimed() {
        let c = cart(vec![
            spend(12000),
            claim("lm", "mug"),
            claim("lt", "tote"),
            claim("lc", "candle"),
        ]);
        let result = validate_gift_lines(&c, &default_offer());
        assert_eq!(granted_units(&result), 1);
        assert_eq!(accepted_ids(&result).len(), 1);
    }

    #[test]
    fn picks_the_most_valuable_pick_one_claim_not_the_first_in_the_cart() {
        // candle -> min(2000, 1000) = 1000; tote -> floor(3000 * 50/100) = 1500;
        // mug -> 4000. The winner is last in cart order.
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![
                    entry("mug"),
                    entry_with("tote", GiftDiscountType::Percent, 50, 1),
                    entry_with("candle", GiftDiscountType::Fixed, 2000, 1),
                ],
            )],
        );
        let c = cart(vec![
            spend(12000),
            claim_at("lc", "candle", 1000),
            claim_at("lt", "tote", 3000),
            claim_at("lm", "mug", 4000),
        ]);
        let result = validate_gift_lines(&c, &offer);
        assert_eq!(accepted_ids(&result), vec!["lm"]);
        assert_eq!(result.get("lt"), Some(&GiftValidation::rejected()));
        assert_eq!(result.get("lc"), Some(&GiftValidation::rejected()));
    }

    #[test]
    fn grants_one_gift_per_tier_under_pick_one_stack() {
        let mut hoodie = claim("lh", "hoodie");
        hoodie.gift_tier_id = Some("t3".into());
        let c = cart(vec![
            spend(16000),
            claim("lm", "mug"),
            claim("lt", "tote"),
            hoodie,
        ]);
        let result = validate_gift_lines(&c, &default_offer());
        assert_eq!(granted_units(&result), 2);
        assert_eq!(accepted_ids(&result), vec!["lh", "lm"]);
    }

    #[test]
    fn grants_exactly_one_gift_when_single_customer_choice_is_claimed_in_two_tiers() {
        let mut p = policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Single);
        p.single_resolution = Some(SingleTierResolution::CustomerChoice);
        let offer = offer_with(p, default_tiers());
        let mut hoodie = claim("lh", "hoodie");
        hoodie.gift_tier_id = Some("t3".into());
        let c = cart(vec![spend(16000), claim("lm", "mug"), hoodie]);
        let result = validate_gift_lines(&c, &offer);
        assert_eq!(granted_units(&result), 1);
        assert_eq!(accepted_ids(&result).len(), 1);
    }

    // ---------------------------------------------------------------------
    // maxQty budgets — allocated per (tier, variant) across every claiming
    // line, not per line.
    // ---------------------------------------------------------------------

    #[test]
    fn grants_one_unit_when_max_qty_is_one_and_the_variant_is_split_across_three_lines() {
        let offer = offer_with(
            policy(WithinTierPolicy::AllInPool, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![entry_with("mug", GiftDiscountType::Free, 0, 1)],
            )],
        );
        let c = cart(vec![
            spend(12000),
            claim("la", "mug"),
            claim("lb", "mug"),
            claim("lc", "mug"),
        ]);
        let result = validate_gift_lines(&c, &offer);
        assert_eq!(granted_units(&result), 1);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn grants_two_units_when_max_qty_is_two_and_the_variant_is_split_across_three_lines() {
        let offer = offer_with(
            policy(WithinTierPolicy::AllInPool, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![entry_with("mug", GiftDiscountType::Free, 0, 2)],
            )],
        );
        let c = cart(vec![
            spend(12000),
            claim("la", "mug"),
            claim("lb", "mug"),
            claim("lc", "mug"),
        ]);
        let result = validate_gift_lines(&c, &offer);
        assert_eq!(granted_units(&result), 2);
        assert_eq!(accepted_ids(&result), vec!["la", "lb"]);
        assert_eq!(result.get("lc"), Some(&GiftValidation::rejected()));
    }

    #[test]
    fn budgets_separately_per_variant_within_a_tier() {
        let offer = offer_with(
            policy(WithinTierPolicy::AllInPool, AcrossTierPolicy::Stack),
            vec![gift_tier("t2", 10000, vec![entry("mug"), entry("tote")])],
        );
        let c = cart(vec![
            spend(12000),
            claim("la", "mug"),
            claim("lb", "mug"),
            claim("lc", "tote"),
        ]);
        let result = validate_gift_lines(&c, &offer);
        assert_eq!(granted_units(&result), 2);
        assert_eq!(accepted_ids(&result), vec!["la", "lc"]);
    }

    #[test]
    fn caps_a_single_line_at_max_qty() {
        let mut mug = claim("lm", "mug");
        mug.quantity = 5;
        let c = cart(vec![spend(12000), mug]);
        assert_eq!(
            validate_gift_lines(&c, &default_offer()).get("lm"),
            Some(&GiftValidation {
                valid: true,
                entry: Some(entry("mug")),
                discount_quantity: 1,
            })
        );
    }

    #[test]
    fn allows_up_to_max_qty_on_one_line_when_the_pool_entry_permits_more() {
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![entry_with("mug", GiftDiscountType::Free, 0, 2)],
            )],
        );
        let mut mug = claim("lm", "mug");
        mug.quantity = 5;
        let c = cart(vec![spend(12000), mug]);
        assert_eq!(
            validate_gift_lines(&c, &offer).get("lm").unwrap().discount_quantity,
            2
        );
    }

    #[test]
    fn discounts_only_what_is_present_when_quantity_is_below_max_qty() {
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![entry_with("mug", GiftDiscountType::Free, 0, 3)],
            )],
        );
        let mut mug = claim("lm", "mug");
        mug.quantity = 2;
        let c = cart(vec![spend(12000), mug]);
        assert_eq!(
            validate_gift_lines(&c, &offer).get("lm").unwrap().discount_quantity,
            2
        );
    }

    /// Spec §6: a zero-quantity line cannot receive a discount and must not
    /// burn a budget a real line could have used.
    #[test]
    fn a_zero_quantity_claim_does_not_consume_the_pick_one_budget() {
        let mut empty = claim("la", "mug");
        empty.quantity = 0;
        empty.unit_price = 99999; // Would otherwise outrank every other claim.
        let c = cart(vec![spend(12000), empty, claim("lb", "tote")]);
        let result = validate_gift_lines(&c, &default_offer());
        assert_eq!(accepted_ids(&result), vec!["lb"]);
        assert_eq!(result.get("la"), Some(&GiftValidation::rejected()));
        assert_eq!(granted_units(&result), 1);
    }

    #[test]
    fn a_negative_quantity_claim_does_not_consume_the_max_qty_budget() {
        let offer = offer_with(
            policy(WithinTierPolicy::AllInPool, AcrossTierPolicy::Stack),
            vec![gift_tier("t2", 10000, vec![entry("mug")])],
        );
        let mut negative = claim("la", "mug");
        negative.quantity = -3;
        let c = cart(vec![spend(12000), negative, claim("lb", "mug")]);
        let result = validate_gift_lines(&c, &offer);
        assert_eq!(accepted_ids(&result), vec!["lb"]);
        assert_eq!(granted_units(&result), 1);
    }

    #[test]
    fn all_in_pool_stack_grants_every_distinct_entry_across_every_unlocked_tier() {
        let offer = offer_with(
            policy(WithinTierPolicy::AllInPool, AcrossTierPolicy::Stack),
            default_tiers(),
        );
        let mut hoodie = claim("lh", "hoodie");
        hoodie.gift_tier_id = Some("t3".into());
        let c = cart(vec![
            spend(16000),
            claim("lm", "mug"),
            claim("lt", "tote"),
            claim("lc", "candle"),
            hoodie,
        ]);
        let result = validate_gift_lines(&c, &offer);
        assert_eq!(granted_units(&result), 4);
        assert_eq!(accepted_ids(&result), vec!["lc", "lh", "lm", "lt"]);
    }

    // ---------------------------------------------------------------------
    // Claim matching. Line attributes are forgeable hints; entitlement is
    // re-derived from cart state and the claim matched against it.
    // ---------------------------------------------------------------------

    #[test]
    fn accepts_a_genuinely_entitled_gift_line() {
        let c = cart(vec![spend(12000), claim("lm", "mug")]);
        assert_eq!(
            validate_gift_lines(&c, &default_offer()).get("lm"),
            Some(&GiftValidation {
                valid: true,
                entry: Some(entry("mug")),
                discount_quantity: 1,
            })
        );
    }

    #[test]
    fn rejects_a_forged_variant_that_is_in_no_pool() {
        let c = cart(vec![spend(12000), claim_at("lx", "expensive-jacket", 40000)]);
        let result = validate_gift_lines(&c, &default_offer());
        assert_eq!(result.get("lx"), Some(&GiftValidation::rejected()));
        assert_eq!(granted_units(&result), 0);
    }

    #[test]
    fn rejects_a_claim_on_a_tier_that_is_not_unlocked() {
        let mut hoodie = claim("lh", "hoodie");
        hoodie.gift_tier_id = Some("t3".into());
        let c = cart(vec![spend(12000), hoodie]);
        assert!(!validate_gift_lines(&c, &default_offer()).get("lh").unwrap().valid);
    }

    #[test]
    fn rejects_a_claim_on_an_unknown_tier_id() {
        let mut mug = claim("lm", "mug");
        mug.gift_tier_id = Some("does-not-exist".into());
        let c = cart(vec![spend(12000), mug]);
        assert!(!validate_gift_lines(&c, &default_offer()).get("lm").unwrap().valid);
    }

    #[test]
    fn rejects_a_claim_naming_a_different_offer() {
        let mut mug = claim("lm", "mug");
        mug.gift_offer_id = Some("other-offer".into());
        let c = cart(vec![spend(12000), mug]);
        assert_eq!(
            validate_gift_lines(&c, &default_offer()).get("lm"),
            Some(&GiftValidation::rejected())
        );
    }

    #[test]
    fn rejects_a_claim_carrying_an_offer_id_but_no_tier_id() {
        let mut mug = claim("lm", "mug");
        mug.gift_tier_id = None;
        let c = cart(vec![spend(12000), mug]);
        assert!(!validate_gift_lines(&c, &default_offer()).get("lm").unwrap().valid);
    }

    #[test]
    fn rejects_a_claim_on_a_tier_not_granted_under_single_highest() {
        let mut p = policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Single);
        p.single_resolution = Some(SingleTierResolution::Highest);
        let offer = offer_with(p, default_tiers());
        let c = cart(vec![spend(16000), claim("lm", "mug")]);
        assert!(!validate_gift_lines(&c, &offer).get("lm").unwrap().valid);
    }

    #[test]
    fn omits_lines_that_claim_no_gift_at_all() {
        let c = cart(vec![spend(12000), claim("lm", "mug")]);
        let result = validate_gift_lines(&c, &default_offer());
        assert!(!result.contains_key("l1"));
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn includes_every_gift_claiming_line_rejected_ones_at_zero_quantity() {
        let mut other = claim("ly", "mug");
        other.gift_offer_id = Some("other-offer".into());
        let c = cart(vec![
            spend(12000),
            claim("lm", "mug"),
            claim("lx", "forged"),
            other,
        ]);
        let result = validate_gift_lines(&c, &default_offer());
        let mut keys: Vec<&String> = result.keys().collect();
        keys.sort();
        assert_eq!(keys, vec!["lm", "lx", "ly"]);
        assert_eq!(result.get("lx"), Some(&GiftValidation::rejected()));
        assert_eq!(result.get("ly"), Some(&GiftValidation::rejected()));
    }

    // ---------------------------------------------------------------------
    // Arbitration order is part of the parity contract.
    // ---------------------------------------------------------------------

    #[test]
    fn ranks_fixed_percent_and_free_claims_by_the_discount_each_would_yield() {
        // mug -> 500; tote -> min(3000, 4000) = 3000; candle -> floor(10000/10) = 1000.
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![
                    entry("mug"),
                    entry_with("tote", GiftDiscountType::Fixed, 3000, 1),
                    entry_with("candle", GiftDiscountType::Percent, 10, 1),
                ],
            )],
        );
        let c = cart(vec![
            spend(12000),
            claim_at("lm", "mug", 500),
            claim_at("lt", "tote", 4000),
            claim_at("lc", "candle", 10000),
        ]);
        assert_eq!(accepted_ids(&validate_gift_lines(&c, &offer)), vec!["lt"]);
    }

    #[test]
    fn clamps_a_fixed_claim_to_the_line_unit_price() {
        // tote -> min(9000, 1000) = 1000, so the FREE mug at 1500 wins.
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![
                    entry("mug"),
                    entry_with("tote", GiftDiscountType::Fixed, 9000, 1),
                ],
            )],
        );
        let c = cart(vec![
            spend(12000),
            claim_at("lt", "tote", 1000),
            claim_at("lm", "mug", 1500),
        ]);
        assert_eq!(accepted_ids(&validate_gift_lines(&c, &offer)), vec!["lm"]);
    }

    #[test]
    fn floors_a_percent_claim_rather_than_rounding_it() {
        // tote -> floor(999 * 50 / 100) = 499, losing to the FREE mug at 500.
        // Rounding up would tie at 500 and the lower line id 'la' would win,
        // so asserting 'lb' pins the flooring.
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier(
                "t2",
                10000,
                vec![
                    entry("mug"),
                    entry_with("tote", GiftDiscountType::Percent, 50, 1),
                ],
            )],
        );
        let c = cart(vec![
            spend(12000),
            claim_at("la", "tote", 999),
            claim_at("lb", "mug", 500),
        ]);
        assert_eq!(accepted_ids(&validate_gift_lines(&c, &offer)), vec!["lb"]);
    }

    #[test]
    fn breaks_ties_on_the_lower_line_id_regardless_of_cart_order() {
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier("t2", 10000, vec![entry("mug"), entry("tote")])],
        );
        let c = cart(vec![
            spend(12000),
            claim_at("lz", "mug", 4000),
            claim_at("la", "tote", 4000),
        ]);
        assert_eq!(accepted_ids(&validate_gift_lines(&c, &offer)), vec!["la"]);
    }

    #[test]
    fn breaks_ties_byte_lexicographically_not_by_locale_collation() {
        // 'B' is 0x42 and 'a' is 0x61, so byte order puts 'B-line' first.
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier("t2", 10000, vec![entry("mug"), entry("tote")])],
        );
        let c = cart(vec![
            spend(12000),
            claim_at("a-line", "mug", 4000),
            claim_at("B-line", "tote", 4000),
        ]);
        assert_eq!(
            accepted_ids(&validate_gift_lines(&c, &offer)),
            vec!["B-line"]
        );
    }

    #[test]
    fn orders_tied_ids_above_u_ffff_by_utf8_byte_order() {
        // U+FFFD encodes to EF BF BD and U+1F600 to F0 9F 98 80, so UTF-8 puts
        // U+FFFD first. UTF-16 code units disagree, which is the trap the
        // TypeScript side had to hand-roll around.
        let offer = offer_with(
            policy(WithinTierPolicy::PickOne, AcrossTierPolicy::Stack),
            vec![gift_tier("t2", 10000, vec![entry("mug"), entry("tote")])],
        );
        let c = cart(vec![
            spend(12000),
            claim_at("\u{1F600}", "mug", 4000),
            claim_at("\u{FFFD}", "tote", 4000),
        ]);
        assert_eq!(
            accepted_ids(&validate_gift_lines(&c, &offer)),
            vec!["\u{FFFD}"]
        );
    }

    #[test]
    fn returns_the_same_result_whatever_order_the_cart_lines_arrive_in() {
        let mut hoodie = claim("lh", "hoodie");
        hoodie.gift_tier_id = Some("t3".into());
        let lines = vec![
            spend(16000),
            claim("lm", "mug"),
            claim("lt", "tote"),
            hoodie,
        ];
        let forward = validate_gift_lines(&cart(lines.clone()), &default_offer());
        let mut reversed_lines = lines;
        reversed_lines.reverse();
        let reversed = validate_gift_lines(&cart(reversed_lines), &default_offer());
        assert_eq!(forward, reversed);
    }
}
