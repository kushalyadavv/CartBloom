//! Mirror of `app/entitlement/tiers.ts`.

use super::types::Tier;

/// Tiers unlocked by `measure`, always returned ascending by threshold.
///
/// Sorting defensively rather than trusting callers: downstream policy code
/// treats the last element as the highest tier, so order is load-bearing.
///
/// `sort_by` is deliberate. The sort must be **stable** so that tiers sharing a
/// threshold keep config order — that tie-break is part of the parity contract
/// with the TypeScript core, whose `Array.prototype.sort` is stable.
/// `sort_unstable_by` is free to reorder equal elements and would break it.
pub fn unlocked_tiers(tiers: &[Tier], measure: i64) -> Vec<Tier> {
    let mut unlocked: Vec<Tier> = tiers
        .iter()
        .filter(|t| measure >= t.threshold)
        .cloned()
        .collect();
    unlocked.sort_by(|a, b| a.threshold.cmp(&b.threshold));
    unlocked
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entitlement::types::RewardKind;

    fn tier(id: &str, threshold: i64) -> Tier {
        Tier {
            id: id.into(),
            threshold,
            reward: RewardKind::Gift,
            value: None,
            gift_pool: vec![],
        }
    }

    fn ids(tiers: &[Tier]) -> Vec<&str> {
        tiers.iter().map(|t| t.id.as_str()).collect()
    }

    fn ladder() -> Vec<Tier> {
        vec![tier("t1", 5000), tier("t2", 10000), tier("t3", 15000)]
    }

    #[test]
    fn returns_nothing_below_the_first_threshold() {
        assert!(unlocked_tiers(&ladder(), 4999).is_empty());
    }

    #[test]
    fn unlocks_a_tier_exactly_at_its_threshold() {
        assert_eq!(ids(&unlocked_tiers(&ladder(), 5000)), vec!["t1"]);
    }

    #[test]
    fn unlocks_every_tier_at_or_below_the_measure() {
        assert_eq!(ids(&unlocked_tiers(&ladder(), 12000)), vec!["t1", "t2"]);
    }

    #[test]
    fn unlocks_all_tiers_when_the_measure_exceeds_the_top() {
        assert_eq!(
            ids(&unlocked_tiers(&ladder(), 99999)),
            vec!["t1", "t2", "t3"]
        );
    }

    #[test]
    fn returns_tiers_ascending_regardless_of_input_order() {
        let shuffled = vec![tier("t3", 15000), tier("t1", 5000), tier("t2", 10000)];
        assert_eq!(
            ids(&unlocked_tiers(&shuffled, 15000)),
            vec!["t1", "t2", "t3"]
        );
    }

    #[test]
    fn returns_nothing_for_an_empty_ladder() {
        assert!(unlocked_tiers(&[], 10000).is_empty());
    }

    #[test]
    fn handles_a_zero_threshold_as_always_unlocked() {
        assert_eq!(ids(&unlocked_tiers(&[tier("t0", 0)], 0)), vec!["t0"]);
    }

    /// The tie-break is config order. A stable sort is the whole reason
    /// `sort_by` is used here; an unstable sort is licensed to fail this.
    #[test]
    fn tied_thresholds_keep_config_order() {
        let tied = vec![
            tier("b", 5000),
            tier("a", 5000),
            tier("c", 5000),
            tier("z", 1000),
        ];
        assert_eq!(ids(&unlocked_tiers(&tied, 5000)), vec!["z", "b", "a", "c"]);
    }
}
