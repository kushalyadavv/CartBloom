//! Mirror of `app/entitlement/rewards.ts`.

use super::types::{NonGiftRewards, RewardKind, Tier};

/// Non-gift rewards from the unlocked tiers.
///
/// Deliberately independent of the claim policy: a merchant restricting gifts
/// to one tier has not thereby restricted their free shipping. Order discounts
/// take the highest single value per type rather than summing — a 10% tier and
/// a 20% tier both unlocked yields 20%, not 30% (spec §6).
pub fn resolve_non_gift_rewards(unlocked: &[Tier]) -> NonGiftRewards {
    let mut free_shipping = false;
    let mut order_percent: i64 = 0;
    let mut order_fixed: i64 = 0;

    for tier in unlocked {
        match tier.reward {
            RewardKind::FreeShipping => free_shipping = true,
            RewardKind::OrderPercent => order_percent = order_percent.max(tier.value.unwrap_or(0)),
            RewardKind::OrderFixed => order_fixed = order_fixed.max(tier.value.unwrap_or(0)),
            RewardKind::Gift => {}
        }
    }

    NonGiftRewards {
        free_shipping,
        order_percent,
        order_fixed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(id: &str, reward: RewardKind, value: Option<i64>) -> Tier {
        Tier {
            id: id.into(),
            threshold: 1000,
            reward,
            value,
            gift_pool: vec![],
        }
    }

    fn empty() -> NonGiftRewards {
        NonGiftRewards {
            free_shipping: false,
            order_percent: 0,
            order_fixed: 0,
        }
    }

    #[test]
    fn returns_empty_rewards_for_no_unlocked_tiers() {
        assert_eq!(resolve_non_gift_rewards(&[]), empty());
    }

    #[test]
    fn grants_free_shipping_when_any_unlocked_tier_offers_it() {
        let r = resolve_non_gift_rewards(&[
            t("t1", RewardKind::Gift, None),
            t("t2", RewardKind::FreeShipping, None),
        ]);
        assert!(r.free_shipping);
    }

    #[test]
    fn takes_the_highest_percent_and_does_not_accumulate() {
        let r = resolve_non_gift_rewards(&[
            t("t1", RewardKind::OrderPercent, Some(10)),
            t("t2", RewardKind::OrderPercent, Some(20)),
        ]);
        assert_eq!(r.order_percent, 20);
    }

    #[test]
    fn takes_the_highest_fixed_amount_and_does_not_accumulate() {
        let r = resolve_non_gift_rewards(&[
            t("t1", RewardKind::OrderFixed, Some(500)),
            t("t2", RewardKind::OrderFixed, Some(1500)),
        ]);
        assert_eq!(r.order_fixed, 1500);
    }

    /// "Highest", not "last" — a descending ladder must still yield the max.
    #[test]
    fn a_lower_value_tier_later_in_the_ladder_does_not_lower_the_result() {
        let r = resolve_non_gift_rewards(&[
            t("t1", RewardKind::OrderPercent, Some(20)),
            t("t2", RewardKind::OrderPercent, Some(10)),
        ]);
        assert_eq!(r.order_percent, 20);
    }

    #[test]
    fn tracks_percent_and_fixed_independently() {
        let r = resolve_non_gift_rewards(&[
            t("t1", RewardKind::OrderPercent, Some(15)),
            t("t2", RewardKind::OrderFixed, Some(1000)),
        ]);
        assert_eq!(
            r,
            NonGiftRewards {
                free_shipping: false,
                order_percent: 15,
                order_fixed: 1000,
            }
        );
    }

    #[test]
    fn ignores_gift_tiers_entirely() {
        assert_eq!(
            resolve_non_gift_rewards(&[t("t1", RewardKind::Gift, None)]),
            empty()
        );
    }

    #[test]
    fn treats_a_missing_value_as_zero() {
        assert_eq!(
            resolve_non_gift_rewards(&[t("t1", RewardKind::OrderPercent, None)]).order_percent,
            0
        );
    }
}
