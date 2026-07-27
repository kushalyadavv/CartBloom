//! Mirror of `app/entitlement/withinTier.ts`.

use super::types::{GiftEntitlement, RewardKind, Tier, WithinTierPolicy};

/// Axis A. Turns one unlocked tier into a gift entitlement, or `None` when the
/// tier grants no gift.
///
/// PICK_ONE with a single-entry pool sets `requires_choice` false — there is
/// nothing to choose, and a chooser with one option is noise.
pub fn resolve_within_tier(
    offer_id: &str,
    tier: &Tier,
    policy: WithinTierPolicy,
) -> Option<GiftEntitlement> {
    if tier.reward != RewardKind::Gift {
        return None;
    }
    if tier.gift_pool.is_empty() {
        return None;
    }

    Some(GiftEntitlement {
        offer_id: offer_id.to_string(),
        tier_id: tier.id.clone(),
        candidates: tier.gift_pool.clone(),
        requires_choice: policy == WithinTierPolicy::PickOne && tier.gift_pool.len() > 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entitlement::types::{GiftDiscountType, GiftPoolEntry};

    fn gift(variant_id: &str) -> GiftPoolEntry {
        GiftPoolEntry {
            variant_id: variant_id.into(),
            discount_type: GiftDiscountType::Free,
            value: 0,
            max_qty: 1,
        }
    }

    fn tier(id: &str, pool: Vec<GiftPoolEntry>) -> Tier {
        Tier {
            id: id.into(),
            threshold: 10000,
            reward: RewardKind::Gift,
            value: None,
            gift_pool: pool,
        }
    }

    #[test]
    fn grants_the_whole_pool_under_all_in_pool() {
        let t = tier("t1", vec![gift("v1"), gift("v2"), gift("v3")]);
        let result = resolve_within_tier("o1", &t, WithinTierPolicy::AllInPool).unwrap();
        assert_eq!(
            result,
            GiftEntitlement {
                offer_id: "o1".into(),
                tier_id: "t1".into(),
                candidates: vec![gift("v1"), gift("v2"), gift("v3")],
                requires_choice: false,
            }
        );
    }

    #[test]
    fn offers_the_pool_as_a_choice_under_pick_one() {
        let t = tier("t1", vec![gift("v1"), gift("v2"), gift("v3")]);
        let result = resolve_within_tier("o1", &t, WithinTierPolicy::PickOne).unwrap();
        assert!(result.requires_choice);
        assert_eq!(
            result
                .candidates
                .iter()
                .map(|c| c.variant_id.as_str())
                .collect::<Vec<_>>(),
            vec!["v1", "v2", "v3"]
        );
    }

    #[test]
    fn does_not_require_a_choice_under_pick_one_with_a_single_entry_pool() {
        let t = tier("t1", vec![gift("v1")]);
        let result = resolve_within_tier("o1", &t, WithinTierPolicy::PickOne).unwrap();
        assert!(!result.requires_choice);
    }

    #[test]
    fn returns_none_for_a_tier_with_an_empty_pool() {
        assert_eq!(
            resolve_within_tier("o1", &tier("t1", vec![]), WithinTierPolicy::PickOne),
            None
        );
    }

    #[test]
    fn returns_none_for_a_tier_whose_reward_is_not_gift() {
        let t = Tier {
            id: "t1".into(),
            threshold: 10000,
            reward: RewardKind::FreeShipping,
            value: None,
            gift_pool: vec![gift("v1")],
        };
        assert_eq!(
            resolve_within_tier("o1", &t, WithinTierPolicy::PickOne),
            None
        );
    }

    #[test]
    fn preserves_per_entry_max_qty_and_discount_settings() {
        let custom = GiftPoolEntry {
            variant_id: "v9".into(),
            discount_type: GiftDiscountType::Percent,
            value: 50,
            max_qty: 2,
        };
        let result =
            resolve_within_tier("o1", &tier("t1", vec![custom.clone()]), WithinTierPolicy::PickOne)
                .unwrap();
        assert_eq!(result.candidates[0], custom);
    }
}
