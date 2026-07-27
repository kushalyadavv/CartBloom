//! Vector conformance — the parity gate.
//!
//! The discount function (Rust) and the storefront widget (TypeScript) are two
//! implementations of one specification. Nothing binds them at compile time.
//! `app/entitlement/vectors/golden.json` and `validation-golden.json` are the
//! entire contract: if the bar says "unlocked" and checkout charges full price,
//! it is because a case escaped these files.
//!
//! The canonical vectors are read from the repo root by relative path. They are
//! deliberately **not** copied into this crate — a copy drifts, and a drifted
//! copy is exactly the divergence the vectors exist to prevent.
//!
//! A failure here is either a bug in this implementation or a genuine
//! specification disagreement. It is never fixed by editing the JSON.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use discount_function::entitlement::{
    resolve_offer, validate_gift_lines, Cart, GiftValidation, Offer, OfferEntitlements,
};
use serde::Deserialize;

/// Case counts are asserted so a truncated or partially-parsed vector file
/// cannot pass by exercising nothing.
const EXPECTED_ENTITLEMENT_VECTORS: usize = 2146;
const EXPECTED_VALIDATION_VECTORS: usize = 14;

#[derive(Debug, Deserialize)]
struct EntitlementVector {
    name: String,
    cart: Cart,
    offer: Offer,
    expected: OfferEntitlements,
}

#[derive(Debug, Deserialize)]
struct ValidationVector {
    name: String,
    cart: Cart,
    offer: Offer,
    expected: HashMap<String, GiftValidation>,
}

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../app/entitlement/vectors")
}

fn read_vectors(file: &str) -> String {
    let path = vectors_dir().join(file);
    fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read the canonical vectors at {path:?}: {e}"))
}

#[test]
fn entitlement_vectors() {
    let raw = read_vectors("golden.json");
    let vectors: Vec<EntitlementVector> =
        serde_json::from_str(&raw).expect("golden.json did not deserialise into the core's types");

    assert_eq!(
        vectors.len(),
        EXPECTED_ENTITLEMENT_VECTORS,
        "golden.json case count changed; the parity gate must not silently shrink"
    );

    let mut failures: Vec<String> = Vec::new();
    for v in &vectors {
        let actual = resolve_offer(&v.cart, &v.offer);
        if actual != v.expected {
            failures.push(format!(
                "\n  vector: {}\n    expected: {:?}\n    actual:   {:?}",
                v.name, v.expected, actual
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} entitlement vectors failed:{}",
        failures.len(),
        vectors.len(),
        failures.join("")
    );
}

#[test]
fn validation_vectors() {
    let raw = read_vectors("validation-golden.json");
    let vectors: Vec<ValidationVector> = serde_json::from_str(&raw)
        .expect("validation-golden.json did not deserialise into the core's types");

    assert_eq!(
        vectors.len(),
        EXPECTED_VALIDATION_VECTORS,
        "validation-golden.json case count changed; the parity gate must not silently shrink"
    );

    let mut failures: Vec<String> = Vec::new();
    for v in &vectors {
        // Compared as maps: iteration order of a HashMap is not part of the
        // contract, the contents are.
        let actual = validate_gift_lines(&v.cart, &v.offer);
        if actual != v.expected {
            failures.push(format!(
                "\n  vector: {}\n    expected: {:?}\n    actual:   {:?}",
                v.name, v.expected, actual
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} validation vectors failed:{}",
        failures.len(),
        vectors.len(),
        failures.join("")
    );
}

/// Deserialisation is silent about fields it does not recognise: a mistyped
/// `#[serde(rename)]` would leave a field at its default and the vector would
/// still "pass" for the wrong reason. Re-serialising every parsed vector and
/// comparing it to the original JSON proves the core's types capture the
/// vectors exactly, with nothing dropped and nothing invented.
#[test]
fn vector_types_round_trip_without_losing_fields() {
    for file in ["golden.json", "validation-golden.json"] {
        let raw = read_vectors(file);
        let original: Vec<serde_json::Value> =
            serde_json::from_str(&raw).expect("vectors are not a JSON array");

        for case in &original {
            let name = case["name"].as_str().unwrap_or("<unnamed>");

            let cart: Cart = serde_json::from_value(case["cart"].clone())
                .unwrap_or_else(|e| panic!("{file} / {name}: cart did not deserialise: {e}"));
            assert_eq!(
                serde_json::to_value(&cart).unwrap(),
                case["cart"],
                "{file} / {name}: cart did not round-trip"
            );

            let offer: Offer = serde_json::from_value(case["offer"].clone())
                .unwrap_or_else(|e| panic!("{file} / {name}: offer did not deserialise: {e}"));
            assert_eq!(
                serde_json::to_value(&offer).unwrap(),
                case["offer"],
                "{file} / {name}: offer did not round-trip"
            );

            if file == "golden.json" {
                let expected: OfferEntitlements =
                    serde_json::from_value(case["expected"].clone()).unwrap_or_else(|e| {
                        panic!("{file} / {name}: expected did not deserialise: {e}")
                    });
                assert_eq!(
                    serde_json::to_value(&expected).unwrap(),
                    case["expected"],
                    "{file} / {name}: expected did not round-trip"
                );
            } else {
                let expected: HashMap<String, GiftValidation> =
                    serde_json::from_value(case["expected"].clone()).unwrap_or_else(|e| {
                        panic!("{file} / {name}: expected did not deserialise: {e}")
                    });
                assert_eq!(
                    serde_json::to_value(&expected).unwrap(),
                    case["expected"],
                    "{file} / {name}: expected did not round-trip"
                );
            }
        }
    }
}
