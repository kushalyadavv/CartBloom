//! The `cart.lines.discounts.generate.run` target — where Shopify's cart meets
//! the entitlement core.
//!
//! This module owns three jobs and deliberately no entitlement logic of its own:
//!
//! 1. Decode the compact config from the discount node's metafield.
//! 2. Normalise Shopify's cart into the core's [`Cart`], resolving `in_scope`
//!    per offer — the core is scope-agnostic by design (spec §4), because the
//!    storefront widget cannot query collection membership and this function
//!    can. Each host resolves scope with whatever it has.
//! 3. Turn the entitlements the core returns into discount operations.
//!
//! Entitlement decisions belong to `discount_function::entitlement`, the half
//! held to the golden vectors. Anything decided *here* is a place where this
//! function and the widget can silently disagree, so keep it to mapping.

use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::HashSet;

use discount_function::config::{decode_config, OfferConfig, OfferScope};
use discount_function::entitlement::{
    resolve_offer, validate_gift_lines, Cart, CartLine, GiftDiscountType,
};

/// Shopify reports money in major units; the core works in integer minor units
/// so that nothing downstream of here touches a float.
fn to_minor_units(amount: f64) -> i64 {
    (amount * 100.0).round() as i64
}

/// Whether an offer's audience gates pass. Empty lists mean "everyone".
///
/// Scheduling is absent on purpose: `type Input` exposes no clock, so a
/// start/end window cannot be evaluated here. Publishing gates that instead.
fn audience_matches(config: &OfferConfig, tags: &HashSet<String>, country: Option<&str>) -> bool {
    let tag_ok = config.audience.customer_tags.is_empty()
        || config.audience.customer_tags.iter().any(|t| tags.contains(t));

    let market_ok = config.audience.markets.is_empty()
        || country.is_some_and(|c| config.audience.markets.iter().any(|m| m == c));

    tag_ok && market_ok
}

/// Whether a line counts toward this offer's threshold.
///
/// `PRODUCTS`/`COLLECTIONS` with an empty list qualify nothing — the decoder's
/// documented rule, deliberately distinct from `EntireCart`.
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
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let empty = || schema::CartLinesDiscountsGenerateRunResult { operations: vec![] };

    let classes = input.discount().discount_classes();
    let wants_product = classes.contains(&schema::DiscountClass::Product);
    let wants_order = classes.contains(&schema::DiscountClass::Order);
    if !wants_product && !wants_order {
        return Ok(empty());
    }

    // An oversized metafield arrives as null rather than as an error, so an
    // absent config is indistinguishable here from one that was too large.
    // Publish-time size validation is what prevents that; granting nothing is
    // the only safe reading of "no config".
    let Some(metafield) = input.discount().config() else {
        return Ok(empty());
    };
    let Ok(configs) = decode_config(metafield.json_value()) else {
        return Ok(empty());
    };

    // The tags this customer actually has. `hasAnyTag` collapses to a single
    // boolean across the whole list and cannot answer "which of *this* offer's
    // tags matched", which per-offer targeting needs.
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

    // ---- Normalise the cart, resolving in_scope per offer -------------------

    let mut lines = Vec::with_capacity(input.cart().lines().len());
    for line in input.cart().lines() {
        // Only product variants can be discounted or granted as gifts.
        let schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise::ProductVariant(variant) =
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
            // Shopify's Int is i32; the core uses i64 throughout.
            quantity: i64::from(*line.quantity()),
            unit_price: to_minor_units(line.cost().amount_per_quantity().amount().0),
            variant_id: variant.id().to_string(),
            in_scope,
            // Claims only. Entitlement is re-derived; these are never evidence.
            gift_offer_id: line.cartbloom_offer().and_then(|a| a.value().map(String::from)),
            gift_tier_id: line.cartbloom_tier().and_then(|a| a.value().map(String::from)),
        });
    }
    let cart = Cart { lines };

    // ---- Turn entitlements into operations ----------------------------------

    let mut product_candidates = Vec::new();
    let mut order_candidates = Vec::new();

    for config in &eligible {
        let offer = &config.offer;

        if wants_product {
            // The security boundary: entitlement is recomputed from cart state
            // and arbitrated across lines. A forged claim yields nothing here,
            // so the line bills at full price.
            for (line_id, validation) in validate_gift_lines(&cart, offer) {
                if !validation.valid || validation.discount_quantity <= 0 {
                    continue;
                }
                let Some(entry) = validation.entry else { continue };

                let value = match entry.discount_type {
                    GiftDiscountType::Free => {
                        schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                            value: Decimal(100.0),
                        })
                    }
                    GiftDiscountType::Percent => {
                        schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                            value: Decimal(entry.value as f64),
                        })
                    }
                    GiftDiscountType::Fixed => {
                        schema::ProductDiscountCandidateValue::FixedAmount(
                            schema::ProductDiscountCandidateFixedAmount {
                                amount: Decimal(entry.value as f64 / 100.0),
                                // Per unit: the pool entry's value is the
                                // discount on one item, and quantity is
                                // already capped to the entitled units.
                                applies_to_each_item: Some(true),
                            },
                        )
                    }
                };

                product_candidates.push(schema::ProductDiscountCandidate {
                    targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                        schema::CartLineTarget {
                            id: line_id.clone(),
                            // Capping here is what stops an inflated gift-line
                            // quantity from multiplying free units. Shopify's
                            // Int is i32; a value that cannot fit becomes None,
                            // which means "the whole line" — so clamp instead.
                            quantity: Some(
                                i32::try_from(validation.discount_quantity).unwrap_or(i32::MAX),
                            ),
                        },
                    )],
                    message: None,
                    value,
                    associated_discount_code: None,
                    prerequisites: None,
                });
            }
        }

        if wants_order {
            // Highest single value per type, never accumulated — spec §6.
            let rewards = resolve_offer(&cart, offer).rewards;
            if rewards.order_percent > 0 {
                order_candidates.push(order_candidate(
                    schema::OrderDiscountCandidateValue::Percentage(schema::Percentage {
                        value: Decimal(rewards.order_percent as f64),
                    }),
                ));
            }
            if rewards.order_fixed > 0 {
                order_candidates.push(order_candidate(
                    schema::OrderDiscountCandidateValue::FixedAmount(schema::FixedAmount {
                        amount: Decimal(rewards.order_fixed as f64 / 100.0),
                    }),
                ));
            }
        }
    }

    let mut operations = Vec::new();
    if !product_candidates.is_empty() {
        operations.push(schema::CartOperation::ProductDiscountsAdd(
            schema::ProductDiscountsAddOperation {
                // Each candidate is a distinct entitled line; all should apply.
                selection_strategy: schema::ProductDiscountSelectionStrategy::All,
                candidates: product_candidates,
            },
        ));
    }
    if !order_candidates.is_empty() {
        operations.push(schema::CartOperation::OrderDiscountsAdd(
            schema::OrderDiscountsAddOperation {
                selection_strategy: schema::OrderDiscountSelectionStrategy::Maximum,
                candidates: order_candidates,
            },
        ));
    }

    Ok(schema::CartLinesDiscountsGenerateRunResult { operations })
}

fn order_candidate(value: schema::OrderDiscountCandidateValue) -> schema::OrderDiscountCandidate {
    schema::OrderDiscountCandidate {
        targets: vec![schema::OrderDiscountCandidateTarget::OrderSubtotal(
            schema::OrderSubtotalTarget {
                excluded_cart_line_ids: vec![],
            },
        )],
        message: None,
        value,
        conditions: None,
        associated_discount_code: None,
    }
}
