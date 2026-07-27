//! Encoding conformance — the anti-drift gate for the compact wire format.
//!
//! The config that reaches this function is written by
//! `app/entitlement/config/encode.ts` and read by `src/config/decode.rs`. Two
//! codecs in two languages drift unless something holds them together.
//!
//! `app/entitlement/config/encoding-golden.json` is that something. Each case
//! carries a `verbose` form and the `compact` form TypeScript produces from it.
//! TypeScript asserts `encode(verbose) == compact`; this file asserts that
//! decoding the same `compact` yields the offers the `verbose` form describes.
//! Between them, neither side can move alone.
//!
//! This matters more than it looks. Shopify delivers an oversized metafield as
//! a silent `null`, and a mis-decoded config is the same class of failure: the
//! function grants the wrong thing, or nothing, with no error anywhere.
//!
//! A failure here is a codec disagreement. It is never fixed by editing the JSON.

use std::fs;
use std::path::PathBuf;

use discount_function::config::{decode_config, offers_of};
use discount_function::entitlement::Offer;
use serde::Deserialize;
use shopify_function::scalars::JsonValue;

/// Asserted so a truncated or partially-parsed file cannot pass by exercising
/// nothing.
const EXPECTED_ENCODING_VECTORS: usize = 47;

#[derive(Debug, Deserialize)]
struct EncodingVector {
    name: String,
    /// The offers as the admin app holds them, before encoding.
    verbose: Vec<Offer>,
    /// What `encode.ts` produces. Decoding this must reproduce `verbose`.
    compact: serde_json::Value,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root should resolve from the crate directory")
}

fn load() -> Vec<EncodingVector> {
    let path = repo_root().join("app/entitlement/config/encoding-golden.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("could not parse {}: {e}", path.display()))
}

/// `decode_config` reads the host's `JsonValue` rather than `serde_json::Value`
/// so that `serde_json` stays out of the Wasm build — the host hands the
/// function an already-parsed value, so pulling in a JSON parser would be pure
/// Wasm weight for nothing.
///
/// `JsonValue` deliberately does not implement `serde::Deserialize` (its
/// `Deserialize` is the wasm-api trait, which reads from host memory), so the
/// bridge is written out by hand. Test-only.
fn as_host_json(value: &serde_json::Value) -> JsonValue {
    match value {
        serde_json::Value::Null => JsonValue::Null,
        serde_json::Value::Bool(b) => JsonValue::Boolean(*b),
        serde_json::Value::Number(n) => {
            JsonValue::Number(n.as_f64().expect("vector numbers should fit an f64"))
        }
        serde_json::Value::String(s) => JsonValue::String(s.clone()),
        serde_json::Value::Array(items) => {
            JsonValue::Array(items.iter().map(as_host_json).collect())
        }
        serde_json::Value::Object(fields) => JsonValue::Object(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), as_host_json(v)))
                .collect(),
        ),
    }
}

#[test]
fn the_vector_file_is_present_and_whole() {
    let vectors = load();
    assert_eq!(
        vectors.len(),
        EXPECTED_ENCODING_VECTORS,
        "encoding vector count changed — regenerate and update the constant deliberately"
    );
}

#[test]
fn every_vector_name_is_unique() {
    let vectors = load();
    let mut names: Vec<&str> = vectors.iter().map(|v| v.name.as_str()).collect();
    names.sort_unstable();
    let before = names.len();
    names.dedup();
    assert_eq!(before, names.len(), "duplicate vector names make failures ambiguous");
}

#[test]
fn decoding_the_compact_form_reproduces_the_verbose_offers() {
    let vectors = load();
    let mut failures = Vec::new();

    for vector in &vectors {
        let host_json = as_host_json(&vector.compact);
        match decode_config(&host_json) {
            Ok(configs) => {
                let decoded: Vec<Offer> = offers_of(&configs);
                if decoded != vector.verbose {
                    failures.push(format!(
                        "{}\n     decoded: {:?}\n    expected: {:?}",
                        vector.name, decoded, vector.verbose
                    ));
                }
            }
            Err(e) => failures.push(format!("{} — decode failed: {e:?}", vector.name)),
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} encoding vectors disagree between encode.ts and decode.rs:\n  - {}",
        failures.len(),
        vectors.len(),
        failures.join("\n  - ")
    );
}
