//! The entitlement core — the Rust half of a two-implementation contract.
//!
//! Structure mirrors `app/entitlement/` one file at a time so the two stay
//! reviewable side by side. The TypeScript core is the storefront widget's
//! implementation and the source the golden vectors were generated from; this
//! is the discount function's. Nothing is shared between them at compile time —
//! `app/entitlement/vectors/golden.json` (2,146 cases) and
//! `validation-golden.json` (14 cases) are the only thing binding them, and
//! `tests/conformance.rs` is the gate.
//!
//! A vector this module cannot satisfy is a specification disagreement to
//! escalate, never a vector to edit.
//!
//! Deliberately free of `shopify_function` and any I/O: the core is
//! scope-agnostic and takes a normalised `Cart` in which each line already
//! carries a resolved `in_scope` list. Mapping Shopify's function input onto
//! that is the host's job (Task 23), not the core's.

pub mod across_tiers;
pub mod resolve;
pub mod rewards;
pub mod subtotal;
pub mod tiers;
pub mod types;
pub mod validate_gifts;
pub mod within_tier;

pub use across_tiers::resolve_across_tiers;
pub use resolve::resolve_offer;
pub use rewards::resolve_non_gift_rewards;
pub use subtotal::qualifying_measure;
pub use tiers::unlocked_tiers;
pub use types::*;
pub use validate_gifts::{validate_gift_lines, GiftValidation};
pub use within_tier::resolve_within_tier;
