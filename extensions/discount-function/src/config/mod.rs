//! The config layer — the boundary between Shopify's metafield and the
//! entitlement core.
//!
//! `decode` turns the compact wire format written by
//! `app/entitlement/config/encode.ts` into the `Offer` values the core already
//! takes, plus the scope and audience qualifiers the *host* needs in order to
//! hand the core a cart with `in_scope` already resolved.
//!
//! Unlike `entitlement`, this module knows about `shopify_function` — decoding
//! from the host's own `JsonValue` is what keeps `serde_json` out of the Wasm
//! build. That is the boundary this module exists to hold: everything below it
//! stays host-agnostic.

pub mod decode;

pub use decode::{
    decode_config, decode_shards, offers_of, DecodeError, OfferAudience, OfferConfig, OfferScope,
    CONFIG_FORMAT_VERSION, MAX_SHARDS,
};
