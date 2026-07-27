//! The `cart.delivery-options.discounts.generate.run` target — free shipping.
//!
//! Structurally a twin of the cart-lines target: decode the same config,
//! normalise the same cart, ask the same core which tiers are unlocked. The
//! only difference is what it does with the answer.
//!
//! The mapping below is duplicated from `cart_lines_discounts_generate_run`
//! rather than shared, because `#[typegen]` generates a distinct `Input` type
//! per query and unifying them would need generics costing more Wasm than they
//! save. **If you change one mapping, change the other** — a cart that
//! qualifies in one target and not the other is exactly the divergence class
//! this project exists to avoid.

use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::HashSet;

use discount_function::config::{decode_config, OfferConfig, OfferScope};
use discount_function::entitlement::{resolve_offer, Cart, CartLine};

fn to_minor_units(amount: f64) -> i64 {
    (amount * 100.0).round() as i64
}

fn audience_matches(config: &OfferConfig, tags: &HashSet<String>, country: Option<&str>) -> bool {
    let tag_ok = config.audience.customer_tags.is_empty()
        || config.audience.customer_tags.iter().any(|t| tags.contains(t));

    let market_ok = config.audience.markets.is_empty()
        || country.is_some_and(|c| config.audience.markets.iter().any(|m| m == c));

    tag_ok && market_ok
}

fn line_in_scope(scope: &OfferScope, product_id: &str, memberships: &[(String, bool)]) -> bool {
    match scope {
        OfferScope::EntireCart => true,
        OfferScope::Products(ids) => ids.iter().any(|id| id == product_id),
        OfferScope::Collections(ids) => memberships
            .iter()
            .any(|(cid, is_member)| *is_member && ids.iter().any(|id| id == cid)),
    }
}

#[shopify_function]
fn cart_delivery_options_discounts_generate_run(
    input: schema::cart_delivery_options_discounts_generate_run::Input,
) -> Result<schema::CartDeliveryOptionsDiscountsGenerateRunResult> {
    let empty = || schema::CartDeliveryOptionsDiscountsGenerateRunResult { operations: vec![] };

    if !input
        .discount()
        .discount_classes()
        .contains(&schema::DiscountClass::Shipping)
    {
        return Ok(empty());
    }

    // An oversized metafield arrives as null rather than as an error, so no
    // config is indistinguishable from a config that was too large. Granting
    // nothing is the only safe reading; publish-time validation prevents it.
    let Some(metafield) = input.discount().config() else {
        return Ok(empty());
    };
    let Ok(configs) = decode_config(metafield.json_value()) else {
        return Ok(empty());
    };

    let mut tags: HashSet<String> = HashSet::new();
    if let Some(customer) = input.cart().buyer_identity().and_then(|b| b.customer()) {
        for t in customer.has_tags() {
            if *t.has_tag() {
                tags.insert(t.tag().to_string());
            }
        }
    }

    let country = input.localization().country().iso_code().to_string();

    let eligible: Vec<OfferConfig> = configs
        .into_iter()
        .filter(|c| audience_matches(c, &tags, Some(country.as_str())))
        .collect();
    if eligible.is_empty() {
        return Ok(empty());
    }

    let mut lines = Vec::with_capacity(input.cart().lines().len());
    for line in input.cart().lines() {
        let schema::cart_delivery_options_discounts_generate_run::input::cart::lines::Merchandise::ProductVariant(variant) =
            line.merchandise()
        else {
            continue;
        };

        let product_id = variant.product().id().to_string();
        let memberships: Vec<(String, bool)> = variant
            .product()
            .in_collections()
            .iter()
            .map(|m| (m.collection_id().to_string(), *m.is_member()))
            .collect();

        let in_scope = eligible
            .iter()
            .filter(|c| line_in_scope(&c.scope, &product_id, &memberships))
            .map(|c| c.offer.id.clone())
            .collect();

        lines.push(CartLine {
            id: line.id().to_string(),
            quantity: i64::from(*line.quantity()),
            unit_price: to_minor_units(line.cost().amount_per_quantity().amount().0),
            variant_id: variant.id().to_string(),
            in_scope,
            // Requested only so that gift lines are excluded from the measure.
            gift_offer_id: line.cartbloom_offer().and_then(|a| a.value().map(String::from)),
            gift_tier_id: line.cartbloom_tier().and_then(|a| a.value().map(String::from)),
        });
    }
    let cart = Cart { lines };

    // Free shipping applies if *any* unlocked tier grants it. It is not
    // governed by the claim policy, which covers gifts only (spec §6).
    let free_shipping = eligible
        .iter()
        .any(|c| resolve_offer(&cart, &c.offer).rewards.free_shipping);
    if !free_shipping {
        return Ok(empty());
    }

    // Every delivery group, not just the first: a cart split across locations
    // would otherwise ship one parcel free and charge for the rest.
    let candidates: Vec<schema::DeliveryDiscountCandidate> = input
        .cart()
        .delivery_groups()
        .iter()
        .map(|group| schema::DeliveryDiscountCandidate {
            targets: vec![schema::DeliveryDiscountCandidateTarget::DeliveryGroup(
                schema::DeliveryGroupTarget {
                    id: group.id().clone(),
                },
            )],
            value: schema::DeliveryDiscountCandidateValue::Percentage(schema::Percentage {
                value: Decimal(100.0),
            }),
            message: None,
            associated_discount_code: None,
        })
        .collect();

    if candidates.is_empty() {
        return Ok(empty());
    }

    Ok(schema::CartDeliveryOptionsDiscountsGenerateRunResult {
        operations: vec![schema::DeliveryOperation::DeliveryDiscountsAdd(
            schema::DeliveryDiscountsAddOperation {
                selection_strategy: schema::DeliveryDiscountSelectionStrategy::All,
                candidates,
            },
        )],
    })
}
