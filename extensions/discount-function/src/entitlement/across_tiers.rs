//! Mirror of `app/entitlement/acrossTiers.ts`.

use super::types::{AcrossTierPolicy, ClaimPolicy, RewardKind, SingleTierResolution, Tier};

/// Axis B. Reduces the unlocked tiers to those that may grant gifts.
///
/// CUSTOMER_CHOICE returns every unlocked gift tier — the customer needs to see
/// all options. The "only one may be claimed" constraint cannot be applied
/// here, because it depends on what the cart lines actually claim; it is
/// enforced by `validate_gift_lines`, the cart-level entry point. Nothing
/// between here and there restricts the count.
pub fn resolve_across_tiers(unlocked: &[Tier], policy: &ClaimPolicy) -> Vec<Tier> {
    let gift_tiers: Vec<Tier> = unlocked
        .iter()
        .filter(|t| t.reward == RewardKind::Gift && !t.gift_pool.is_empty())
        .cloned()
        .collect();

    if gift_tiers.is_empty() {
        return vec![];
    }
    if policy.across_tiers == AcrossTierPolicy::Stack {
        return gift_tiers;
    }

    // Mirrors the TypeScript `policy.singleResolution ?? 'HIGHEST'`. The type
    // requires a resolution whenever acrossTiers is SINGLE; this is the
    // defensive default for a malformed config, not a documented mode.
    let resolution = policy
        .single_resolution
        .unwrap_or(SingleTierResolution::Highest);

    match resolution {
        SingleTierResolution::CustomerChoice => gift_tiers,

        // PINNED fails closed. A pin that is absent, unknown, or naming a
        // locked tier all grant nothing — a malformed config must never
        // quietly hand out the most valuable tier, and two malformed configs
        // must not disagree. There is deliberately no HIGHEST fallback here.
        SingleTierResolution::Pinned => match &policy.pinned_tier_id {
            Some(pinned_id) => match gift_tiers.iter().find(|t| &t.id == pinned_id) {
                Some(pinned) => vec![pinned.clone()],
                None => vec![],
            },
            None => vec![],
        },

        SingleTierResolution::Highest => vec![gift_tiers[gift_tiers.len() - 1].clone()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entitlement::types::{GiftDiscountType, GiftPoolEntry, WithinTierPolicy};

    fn gift(variant_id: &str) -> GiftPoolEntry {
        GiftPoolEntry {
            variant_id: variant_id.into(),
            discount_type: GiftDiscountType::Free,
            value: 0,
            max_qty: 1,
        }
    }

    fn gift_tier(id: &str, threshold: i64) -> Tier {
        Tier {
            id: id.into(),
            threshold,
            reward: RewardKind::Gift,
            value: None,
            gift_pool: vec![gift(&format!("v-{id}"))],
        }
    }

    fn ship_tier(id: &str, threshold: i64) -> Tier {
        Tier {
            id: id.into(),
            threshold,
            reward: RewardKind::FreeShipping,
            value: None,
            gift_pool: vec![],
        }
    }

    fn policy(
        across_tiers: AcrossTierPolicy,
        single_resolution: Option<SingleTierResolution>,
        pinned_tier_id: Option<&str>,
    ) -> ClaimPolicy {
        ClaimPolicy {
            within_tier: WithinTierPolicy::PickOne,
            across_tiers,
            single_resolution,
            pinned_tier_id: pinned_tier_id.map(|s| s.to_string()),
        }
    }

    fn unlocked() -> Vec<Tier> {
        vec![
            gift_tier("t1", 5000),
            gift_tier("t2", 10000),
            gift_tier("t3", 15000),
        ]
    }

    fn ids(tiers: &[Tier]) -> Vec<&str> {
        tiers.iter().map(|t| t.id.as_str()).collect()
    }

    #[test]
    fn grants_every_unlocked_gift_tier_under_stack() {
        let result = resolve_across_tiers(&unlocked(), &policy(AcrossTierPolicy::Stack, None, None));
        assert_eq!(ids(&result), vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn grants_only_the_highest_tier_under_single_highest() {
        let result = resolve_across_tiers(
            &unlocked(),
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::Highest),
                None,
            ),
        );
        assert_eq!(ids(&result), vec!["t3"]);
    }

    #[test]
    fn grants_the_pinned_tier_under_single_pinned() {
        let result = resolve_across_tiers(
            &unlocked(),
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::Pinned),
                Some("t2"),
            ),
        );
        assert_eq!(ids(&result), vec!["t2"]);
    }

    #[test]
    fn grants_nothing_when_the_pinned_tier_is_not_unlocked() {
        let result = resolve_across_tiers(
            &[gift_tier("t1", 5000)],
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::Pinned),
                Some("t3"),
            ),
        );
        assert!(result.is_empty());
    }

    #[test]
    fn grants_nothing_when_pinned_has_no_pinned_tier_id_at_all() {
        let result = resolve_across_tiers(
            &unlocked(),
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::Pinned),
                None,
            ),
        );
        assert!(result.is_empty());
    }

    #[test]
    fn grants_nothing_when_pinned_names_a_tier_id_that_exists_nowhere() {
        let result = resolve_across_tiers(
            &unlocked(),
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::Pinned),
                Some("no-such-tier"),
            ),
        );
        assert!(result.is_empty());
    }

    #[test]
    fn returns_every_unlocked_gift_tier_under_single_customer_choice() {
        let result = resolve_across_tiers(
            &unlocked(),
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::CustomerChoice),
                None,
            ),
        );
        assert_eq!(ids(&result), vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn ignores_non_gift_tiers_when_picking_the_highest() {
        let mixed = vec![gift_tier("t1", 5000), ship_tier("t2", 10000)];
        let result = resolve_across_tiers(
            &mixed,
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::Highest),
                None,
            ),
        );
        assert_eq!(ids(&result), vec!["t1"]);
    }

    #[test]
    fn returns_nothing_when_no_tiers_are_unlocked() {
        assert!(resolve_across_tiers(&[], &policy(AcrossTierPolicy::Stack, None, None)).is_empty());
    }

    #[test]
    fn defaults_to_highest_when_single_has_no_resolution_set() {
        let result =
            resolve_across_tiers(&unlocked(), &policy(AcrossTierPolicy::Single, None, None));
        assert_eq!(ids(&result), vec!["t3"]);
    }

    /// A tier with a GIFT reward but an empty pool grants nothing and must not
    /// shadow a lower tier that does have a pool.
    #[test]
    fn ignores_gift_tiers_with_empty_pools_when_picking_the_highest() {
        let mixed = vec![
            gift_tier("t1", 5000),
            Tier {
                id: "t2".into(),
                threshold: 10000,
                reward: RewardKind::Gift,
                value: None,
                gift_pool: vec![],
            },
        ];
        let result = resolve_across_tiers(
            &mixed,
            &policy(
                AcrossTierPolicy::Single,
                Some(SingleTierResolution::Highest),
                None,
            ),
        );
        assert_eq!(ids(&result), vec!["t1"]);
    }
}
