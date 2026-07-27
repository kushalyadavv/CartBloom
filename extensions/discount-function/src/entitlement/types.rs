//! Shared entitlement types — the Rust mirror of `app/entitlement/types.ts`.
//!
//! All money is `i64` integer minor units (cents). Percentages are integers
//! 0-100. The JSON representation is the golden-vector representation: the
//! enums are SCREAMING_SNAKE strings and the struct fields are camelCase, so
//! these types deserialise `app/entitlement/vectors/*.json` directly. That is
//! deliberate — a hand-written adapter between the vectors and these types
//! would be a place where the two implementations could quietly disagree.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TriggerMetric {
    Subtotal,
    Quantity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RewardKind {
    FreeShipping,
    OrderPercent,
    OrderFixed,
    Gift,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GiftDiscountType {
    Free,
    Percent,
    Fixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WithinTierPolicy {
    AllInPool,
    PickOne,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AcrossTierPolicy {
    Stack,
    Single,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SingleTierResolution {
    Highest,
    Pinned,
    CustomerChoice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftPoolEntry {
    pub variant_id: String,
    pub discount_type: GiftDiscountType,
    /// Percent 0-100 when PERCENT; minor units when FIXED; ignored when FREE.
    pub value: i64,
    pub max_qty: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    pub id: String,
    /// Minor units when trigger is SUBTOTAL; item count when QUANTITY.
    pub threshold: i64,
    pub reward: RewardKind,
    /// Percent 0-100 for ORDER_PERCENT; minor units for ORDER_FIXED.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<i64>,
    pub gift_pool: Vec<GiftPoolEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimPolicy {
    pub within_tier: WithinTierPolicy,
    pub across_tiers: AcrossTierPolicy,
    /// Required when `across_tiers` is SINGLE.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub single_resolution: Option<SingleTierResolution>,
    /// Required when `single_resolution` is PINNED.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_tier_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub id: String,
    pub trigger: TriggerMetric,
    pub claim_policy: ClaimPolicy,
    /// Callers are expected to supply these ascending by threshold, but
    /// `unlocked_tiers` sorts defensively rather than trusting that.
    pub tiers: Vec<Tier>,
}

/// A cart line already normalised by its host.
///
/// `in_scope` is resolved by the caller, not by this module — the discount
/// function can query collection membership live, the widget cannot. See the
/// scope-agnostic qualifier in the design spec (§4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CartLine {
    pub id: String,
    pub quantity: i64,
    /// Undiscounted unit price in minor units.
    pub unit_price: i64,
    pub variant_id: String,
    /// Offer ids for which this line counts toward the threshold.
    pub in_scope: Vec<String>,
    /// Set from the `_cartbloom_offer` line attribute. Never trusted for
    /// entitlement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gift_offer_id: Option<String>,
    /// Set from the `_cartbloom_tier` line attribute. Never trusted for
    /// entitlement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gift_tier_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cart {
    pub lines: Vec<CartLine>,
}

/// A customer's selection, when the policy requires one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftSelection {
    pub offer_id: String,
    pub tier_id: String,
    pub variant_id: String,
}

/// A right to a gift. Not a cart line — the customer may not have claimed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftEntitlement {
    pub offer_id: String,
    pub tier_id: String,
    /// Products the customer may claim. Length > 1 means a chooser is required.
    pub candidates: Vec<GiftPoolEntry>,
    /// True when the customer must pick; false when all candidates are granted.
    pub requires_choice: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NonGiftRewards {
    pub free_shipping: bool,
    /// Highest single percent among unlocked tiers, or 0.
    pub order_percent: i64,
    /// Highest single fixed amount in minor units among unlocked tiers, or 0.
    pub order_fixed: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferEntitlements {
    pub offer_id: String,
    /// Measure that was compared against thresholds.
    pub measure: i64,
    pub unlocked_tier_ids: Vec<String>,
    pub gifts: Vec<GiftEntitlement>,
    pub rewards: NonGiftRewards,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The enum wire strings are part of the vector contract. Asserted against
    /// the literal strings that appear in `golden.json` rather than assumed
    /// from the `rename_all` attribute.
    #[test]
    fn enums_use_the_exact_screaming_snake_strings_from_the_vectors() {
        let cases: Vec<(String, &str)> = vec![
            (serde_json::to_string(&TriggerMetric::Subtotal).unwrap(), "\"SUBTOTAL\""),
            (serde_json::to_string(&TriggerMetric::Quantity).unwrap(), "\"QUANTITY\""),
            (serde_json::to_string(&RewardKind::FreeShipping).unwrap(), "\"FREE_SHIPPING\""),
            (serde_json::to_string(&RewardKind::OrderPercent).unwrap(), "\"ORDER_PERCENT\""),
            (serde_json::to_string(&RewardKind::OrderFixed).unwrap(), "\"ORDER_FIXED\""),
            (serde_json::to_string(&RewardKind::Gift).unwrap(), "\"GIFT\""),
            (serde_json::to_string(&GiftDiscountType::Free).unwrap(), "\"FREE\""),
            (serde_json::to_string(&GiftDiscountType::Percent).unwrap(), "\"PERCENT\""),
            (serde_json::to_string(&GiftDiscountType::Fixed).unwrap(), "\"FIXED\""),
            (serde_json::to_string(&WithinTierPolicy::AllInPool).unwrap(), "\"ALL_IN_POOL\""),
            (serde_json::to_string(&WithinTierPolicy::PickOne).unwrap(), "\"PICK_ONE\""),
            (serde_json::to_string(&AcrossTierPolicy::Stack).unwrap(), "\"STACK\""),
            (serde_json::to_string(&AcrossTierPolicy::Single).unwrap(), "\"SINGLE\""),
            (serde_json::to_string(&SingleTierResolution::Highest).unwrap(), "\"HIGHEST\""),
            (serde_json::to_string(&SingleTierResolution::Pinned).unwrap(), "\"PINNED\""),
            (
                serde_json::to_string(&SingleTierResolution::CustomerChoice).unwrap(),
                "\"CUSTOMER_CHOICE\"",
            ),
        ];
        for (actual, expected) in cases {
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn cart_line_deserialises_from_the_vector_shape() {
        let line: CartLine = serde_json::from_str(
            r#"{"id":"lg","quantity":1,"unitPrice":4000,"variantId":"v-mug",
                "inScope":["o1"],"giftOfferId":"o1","giftTierId":"v-t1"}"#,
        )
        .unwrap();
        assert_eq!(line.unit_price, 4000);
        assert_eq!(line.in_scope, vec!["o1".to_string()]);
        assert_eq!(line.gift_offer_id.as_deref(), Some("o1"));
        assert_eq!(line.gift_tier_id.as_deref(), Some("v-t1"));
    }

    #[test]
    fn optional_fields_default_to_none_when_absent() {
        let line: CartLine = serde_json::from_str(
            r#"{"id":"l1","quantity":2,"unitPrice":2500,"variantId":"v1","inScope":["o1"]}"#,
        )
        .unwrap();
        assert_eq!(line.gift_offer_id, None);
        assert_eq!(line.gift_tier_id, None);

        let tier: Tier = serde_json::from_str(
            r#"{"id":"t1","threshold":5000,"reward":"FREE_SHIPPING","giftPool":[]}"#,
        )
        .unwrap();
        assert_eq!(tier.value, None);

        let policy: ClaimPolicy =
            serde_json::from_str(r#"{"withinTier":"PICK_ONE","acrossTiers":"STACK"}"#).unwrap();
        assert_eq!(policy.single_resolution, None);
        assert_eq!(policy.pinned_tier_id, None);
    }
}
