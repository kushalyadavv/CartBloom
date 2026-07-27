//! Mirror of `app/entitlement/subtotal.ts`.

use super::types::{Cart, CartLine, Offer, TriggerMetric};

/// A line is a gift if **any** offer marked it as one. Gifts never count.
fn is_gift_line(line: &CartLine) -> bool {
    line.gift_offer_id.is_some()
}

/// The measure compared against tier thresholds.
///
/// Deliberately computed from UNDISCOUNTED unit prices of NON-GIFT lines only.
/// Any other basis causes oscillation (spec §7 Trap 1): a gift zeroes out, the
/// subtotal drops below the threshold, the entitlement is lost, the discount is
/// removed, the subtotal rises, and the entitlement returns.
pub fn qualifying_measure(cart: &Cart, offer: &Offer) -> i64 {
    let mut total: i64 = 0;
    for line in &cart.lines {
        if is_gift_line(line) {
            continue;
        }
        if !line.in_scope.iter().any(|id| id == &offer.id) {
            continue;
        }
        total += match offer.trigger {
            TriggerMetric::Quantity => line.quantity,
            TriggerMetric::Subtotal => line.unit_price * line.quantity,
        };
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entitlement::types::{AcrossTierPolicy, ClaimPolicy, WithinTierPolicy};

    fn offer(trigger: TriggerMetric) -> Offer {
        Offer {
            id: "o1".into(),
            trigger,
            claim_policy: ClaimPolicy {
                within_tier: WithinTierPolicy::PickOne,
                across_tiers: AcrossTierPolicy::Stack,
                single_resolution: None,
                pinned_tier_id: None,
            },
            tiers: vec![],
        }
    }

    fn line(
        id: &str,
        quantity: i64,
        unit_price: i64,
        in_scope: &[&str],
        gift_offer_id: Option<&str>,
    ) -> CartLine {
        CartLine {
            id: id.into(),
            quantity,
            unit_price,
            variant_id: format!("v-{id}"),
            in_scope: in_scope.iter().map(|s| s.to_string()).collect(),
            gift_offer_id: gift_offer_id.map(|s| s.to_string()),
            gift_tier_id: gift_offer_id.map(|_| "t1".to_string()),
        }
    }

    fn cart(lines: Vec<CartLine>) -> Cart {
        Cart { lines }
    }

    #[test]
    fn sums_unit_price_times_quantity_for_in_scope_lines() {
        let c = cart(vec![
            line("l1", 2, 2500, &["o1"], None),
            line("l2", 1, 1000, &["o1"], None),
        ]);
        assert_eq!(qualifying_measure(&c, &offer(TriggerMetric::Subtotal)), 6000);
    }

    #[test]
    fn excludes_gift_lines_belonging_to_the_same_offer() {
        let c = cart(vec![
            line("l1", 1, 10000, &["o1"], None),
            line("l2", 1, 4000, &["o1"], Some("o1")),
        ]);
        assert_eq!(qualifying_measure(&c, &offer(TriggerMetric::Subtotal)), 10000);
    }

    #[test]
    fn excludes_gift_lines_belonging_to_any_other_offer() {
        let c = cart(vec![
            line("l1", 1, 10000, &["o1"], None),
            line("l2", 1, 4000, &["o1"], Some("other-offer")),
        ]);
        assert_eq!(qualifying_measure(&c, &offer(TriggerMetric::Subtotal)), 10000);
    }

    #[test]
    fn excludes_lines_not_in_scope_for_this_offer() {
        let c = cart(vec![
            line("l1", 1, 5000, &["o1"], None),
            line("l2", 1, 9900, &["o2"], None),
        ]);
        assert_eq!(qualifying_measure(&c, &offer(TriggerMetric::Subtotal)), 5000);
    }

    #[test]
    fn counts_items_rather_than_money_when_trigger_is_quantity() {
        let c = cart(vec![
            line("l1", 3, 2500, &["o1"], None),
            line("l2", 2, 1000, &["o1"], None),
        ]);
        assert_eq!(qualifying_measure(&c, &offer(TriggerMetric::Quantity)), 5);
    }

    #[test]
    fn excludes_gift_lines_from_the_quantity_measure_too() {
        let c = cart(vec![
            line("l1", 3, 2500, &["o1"], None),
            line("l2", 4, 0, &["o1"], Some("o1")),
        ]);
        assert_eq!(qualifying_measure(&c, &offer(TriggerMetric::Quantity)), 3);
    }

    #[test]
    fn returns_zero_for_an_empty_cart() {
        assert_eq!(
            qualifying_measure(&cart(vec![]), &offer(TriggerMetric::Subtotal)),
            0
        );
    }

    #[test]
    fn returns_zero_when_every_line_is_a_gift() {
        let c = cart(vec![line("l1", 1, 4000, &["o1"], Some("o1"))]);
        assert_eq!(qualifying_measure(&c, &offer(TriggerMetric::Subtotal)), 0);
    }
}
