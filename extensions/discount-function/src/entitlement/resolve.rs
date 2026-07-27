//! Mirror of `app/entitlement/resolve.ts`.

use super::across_tiers::resolve_across_tiers;
use super::rewards::resolve_non_gift_rewards;
use super::subtotal::qualifying_measure;
use super::tiers::unlocked_tiers;
use super::types::{Cart, GiftEntitlement, Offer, OfferEntitlements};
use super::within_tier::resolve_within_tier;

/// The public entry point. Given a normalised cart and one offer, returns
/// everything the customer is entitled to.
///
/// Pure and deterministic: identical inputs always produce identical output.
///
/// This is the Rust half of a two-implementation contract. The TypeScript core
/// in `app/entitlement/` is the other half, and `golden.json` is what binds
/// them — not shared code.
///
/// It answers what the customer is *entitled to*, not what they may keep: under
/// PICK_ONE and SINGLE:CUSTOMER_CHOICE the gifts list deliberately contains
/// every option so a chooser can render them. `validate_gift_lines` is what
/// decides which claims are actually honoured.
pub fn resolve_offer(cart: &Cart, offer: &Offer) -> OfferEntitlements {
    let measure = qualifying_measure(cart, offer);
    let unlocked = unlocked_tiers(&offer.tiers, measure);
    let granting_tiers = resolve_across_tiers(&unlocked, &offer.claim_policy);

    let mut gifts: Vec<GiftEntitlement> = Vec::new();
    for tier in &granting_tiers {
        if let Some(entitlement) =
            resolve_within_tier(&offer.id, tier, offer.claim_policy.within_tier)
        {
            gifts.push(entitlement);
        }
    }

    OfferEntitlements {
        offer_id: offer.id.clone(),
        measure,
        unlocked_tier_ids: unlocked.iter().map(|t| t.id.clone()).collect(),
        gifts,
        rewards: resolve_non_gift_rewards(&unlocked),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entitlement::types::{
        AcrossTierPolicy, CartLine, ClaimPolicy, GiftDiscountType, GiftPoolEntry, RewardKind,
        SingleTierResolution, Tier, TriggerMetric, WithinTierPolicy,
    };

    fn gift(variant_id: &str) -> GiftPoolEntry {
        GiftPoolEntry {
            variant_id: variant_id.into(),
            discount_type: GiftDiscountType::Free,
            value: 0,
            max_qty: 1,
        }
    }

    fn ladder() -> Vec<Tier> {
        vec![
            Tier {
                id: "t1".into(),
                threshold: 5000,
                reward: RewardKind::FreeShipping,
                value: None,
                gift_pool: vec![],
            },
            Tier {
                id: "t2".into(),
                threshold: 10000,
                reward: RewardKind::Gift,
                value: None,
                gift_pool: vec![gift("mug"), gift("tote"), gift("candle")],
            },
            Tier {
                id: "t3".into(),
                threshold: 15000,
                reward: RewardKind::Gift,
                value: None,
                gift_pool: vec![gift("hoodie"), gift("backpack")],
            },
        ]
    }

    fn offer(policy: ClaimPolicy, trigger: TriggerMetric, tiers: Vec<Tier>) -> Offer {
        Offer {
            id: "o1".into(),
            trigger,
            claim_policy: policy,
            tiers,
        }
    }

    fn default_offer() -> Offer {
        offer(
            ClaimPolicy {
                within_tier: WithinTierPolicy::PickOne,
                across_tiers: AcrossTierPolicy::Stack,
                single_resolution: None,
                pinned_tier_id: None,
            },
            TriggerMetric::Subtotal,
            ladder(),
        )
    }

    fn line(id: &str, quantity: i64, unit_price: i64, variant_id: &str) -> CartLine {
        CartLine {
            id: id.into(),
            quantity,
            unit_price,
            variant_id: variant_id.into(),
            in_scope: vec!["o1".into()],
            gift_offer_id: None,
            gift_tier_id: None,
        }
    }

    fn cart_at(amount: i64) -> Cart {
        Cart {
            lines: vec![line("l1", 1, amount, "sweater")],
        }
    }

    fn tier_ids(gifts: &[GiftEntitlement]) -> Vec<&str> {
        gifts.iter().map(|g| g.tier_id.as_str()).collect()
    }

    #[test]
    fn unlocks_nothing_below_the_first_threshold() {
        let r = resolve_offer(&cart_at(4999), &default_offer());
        assert!(r.unlocked_tier_ids.is_empty());
        assert!(r.gifts.is_empty());
        assert!(!r.rewards.free_shipping);
    }

    #[test]
    fn reports_the_measure_it_used() {
        assert_eq!(resolve_offer(&cart_at(16000), &default_offer()).measure, 16000);
    }

    #[test]
    fn grants_free_shipping_and_both_gift_tiers_under_pick_one_stack() {
        let r = resolve_offer(&cart_at(16000), &default_offer());
        assert_eq!(r.unlocked_tier_ids, vec!["t1", "t2", "t3"]);
        assert!(r.rewards.free_shipping);
        assert_eq!(tier_ids(&r.gifts), vec!["t2", "t3"]);
        assert!(r.gifts.iter().all(|g| g.requires_choice));
    }

    #[test]
    fn grants_only_the_highest_gift_tier_under_single_highest_keeping_free_shipping() {
        let o = offer(
            ClaimPolicy {
                within_tier: WithinTierPolicy::PickOne,
                across_tiers: AcrossTierPolicy::Single,
                single_resolution: Some(SingleTierResolution::Highest),
                pinned_tier_id: None,
            },
            TriggerMetric::Subtotal,
            ladder(),
        );
        let r = resolve_offer(&cart_at(16000), &o);
        assert_eq!(tier_ids(&r.gifts), vec!["t3"]);
        assert!(r.rewards.free_shipping);
    }

    #[test]
    fn exposes_every_unlocked_gift_tier_under_single_customer_choice() {
        let o = offer(
            ClaimPolicy {
                within_tier: WithinTierPolicy::PickOne,
                across_tiers: AcrossTierPolicy::Single,
                single_resolution: Some(SingleTierResolution::CustomerChoice),
                pinned_tier_id: None,
            },
            TriggerMetric::Subtotal,
            ladder(),
        );
        assert_eq!(tier_ids(&resolve_offer(&cart_at(16000), &o).gifts), vec!["t2", "t3"]);
    }

    #[test]
    fn does_not_require_a_choice_under_all_in_pool() {
        let o = offer(
            ClaimPolicy {
                within_tier: WithinTierPolicy::AllInPool,
                across_tiers: AcrossTierPolicy::Stack,
                single_resolution: None,
                pinned_tier_id: None,
            },
            TriggerMetric::Subtotal,
            ladder(),
        );
        let r = resolve_offer(&cart_at(16000), &o);
        assert!(r.gifts.iter().all(|g| !g.requires_choice));
        assert_eq!(r.gifts[0].candidates.len(), 3);
    }

    #[test]
    fn does_not_count_an_already_claimed_gift_toward_thresholds() {
        let mut claimed = line("l2", 1, 6000, "mug");
        claimed.gift_offer_id = Some("o1".into());
        claimed.gift_tier_id = Some("t2".into());
        let cart = Cart {
            lines: vec![line("l1", 1, 10000, "sweater"), claimed],
        };
        let r = resolve_offer(&cart, &default_offer());
        assert_eq!(r.measure, 10000);
        assert_eq!(r.unlocked_tier_ids, vec!["t1", "t2"]);
    }

    #[test]
    fn is_stable_across_repeated_evaluation_with_the_gift_present() {
        let mut claimed = line("l2", 1, 4000, "mug");
        claimed.gift_offer_id = Some("o1".into());
        claimed.gift_tier_id = Some("t2".into());
        let cart = Cart {
            lines: vec![line("l1", 1, 10000, "sweater"), claimed],
        };
        let first = resolve_offer(&cart, &default_offer());
        let second = resolve_offer(&cart, &default_offer());
        assert_eq!(first, second);
        assert!(first.unlocked_tier_ids.contains(&"t2".to_string()));
    }

    #[test]
    fn unlocks_by_item_count_when_trigger_is_quantity() {
        let o = offer(
            ClaimPolicy {
                within_tier: WithinTierPolicy::PickOne,
                across_tiers: AcrossTierPolicy::Stack,
                single_resolution: None,
                pinned_tier_id: None,
            },
            TriggerMetric::Quantity,
            vec![Tier {
                id: "q1".into(),
                threshold: 3,
                reward: RewardKind::Gift,
                value: None,
                gift_pool: vec![gift("mug")],
            }],
        );
        let cart = Cart {
            lines: vec![line("l1", 3, 100, "sock")],
        };
        assert_eq!(resolve_offer(&cart, &o).unlocked_tier_ids, vec!["q1"]);
    }
}
