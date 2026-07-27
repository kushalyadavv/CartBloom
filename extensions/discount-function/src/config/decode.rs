//! Compact config wire format — the decoder (function side).
//!
//! The other half of the contract implemented by
//! `app/entitlement/config/encode.ts`. The format is specified in
//! `docs/compact-config-format.md`, and `app/entitlement/config/
//! encoding-golden.json` is what stops the two drifting: TypeScript asserts
//! `encode(verbose)` equals each vector's `compact`, this crate asserts
//! `decode_config(compact)` equals the `OfferConfig` the verbose form
//! describes.
//!
//! ## Why the input is `JsonValue` and not a `&str`
//!
//! The metafield is requested as `metafield { jsonValue }`, so the Function
//! host parses the JSON and hands Wasm an already-structured value. Decoding
//! from that rather than from a string keeps `serde_json` out of the Wasm
//! build entirely — it stays a dev-dependency, as `Cargo.toml` intends, and
//! the 256 kB size budget is unaffected.
//!
//! It also makes the decoder honest about the host's number representation:
//! `JsonValue::Number` is an `f64`, so every integer this module reads is
//! validated as an exact integer within the safe range rather than assumed to
//! be one.
//!
//! ## What this module does not do
//!
//! Nothing here touches entitlement semantics. `resolve_offer` and
//! `validate_gift_lines` take the `Offer` this module produces and are
//! unchanged by its existence.

use core::fmt;

use shopify_function::scalars::JsonValue;

use crate::entitlement::{
    AcrossTierPolicy, ClaimPolicy, GiftDiscountType, GiftPoolEntry, Offer, RewardKind,
    SingleTierResolution, Tier, TriggerMetric, WithinTierPolicy,
};

/// The only format version this build understands.
///
/// A document carrying anything else is rejected rather than guessed at. A
/// misread config grants the wrong discounts silently, which is strictly worse
/// than granting none.
pub const CONFIG_FORMAT_VERSION: i64 = 1;

pub const VARIANT_GID_PREFIX: &str = "gid://shopify/ProductVariant/";
pub const COLLECTION_GID_PREFIX: &str = "gid://shopify/Collection/";
pub const PRODUCT_GID_PREFIX: &str = "gid://shopify/Product/";

/// Largest integer a JSON number can carry through the host's `f64` without
/// losing precision. Mirrors `Number.MAX_SAFE_INTEGER` on the encoder side.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

// ---------------------------------------------------------------------------
// Decoded shape
// ---------------------------------------------------------------------------

/// Which cart lines count toward an offer's threshold.
///
/// The entitlement core is scope-agnostic (spec §4): it takes a cart whose
/// lines already carry a resolved `in_scope` list. This is the config the host
/// uses to resolve that, which is why it sits beside `Offer` rather than
/// inside it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OfferScope {
    EntireCart,
    /// Collection GIDs. An empty list means the offer qualifies nothing —
    /// deliberately distinct from `EntireCart`.
    Collections(Vec<String>),
    /// Product GIDs. Same emptiness rule as `Collections`.
    Products(Vec<String>),
}

/// Audience gates the host evaluates before an offer applies.
///
/// Both lists empty means "everyone". The scheduling window from spec §5 is
/// deliberately absent: `type Input` in the Function schema exposes no clock,
/// so a function cannot evaluate a date range.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OfferAudience {
    /// Matched via `buyerIdentity.customer.hasAnyTag`.
    pub customer_tags: Vec<String>,
    /// ISO 3166-1 alpha-2 codes, matched against `localization.country.isoCode`.
    pub markets: Vec<String>,
}

/// One published offer: the entitlement core's `Offer` plus the qualifiers the
/// host resolves before calling the core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfferConfig {
    pub offer: Offer,
    pub scope: OfferScope,
    pub audience: OfferAudience,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Why a config could not be decoded.
///
/// Every variant carries only `&'static str` or an integer, so error handling
/// costs no formatting machinery in the Wasm build.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    /// The document, or a nested value, was not the JSON type the format says.
    WrongType(&'static str),
    /// A key the format requires was absent.
    MissingField(&'static str),
    /// `v` was not `CONFIG_FORMAT_VERSION`.
    UnsupportedVersion(i64),
    /// An enum code outside the documented range.
    UnknownEnumValue(&'static str, i64),
    /// A number that was not an exact integer inside the safe range.
    NotAnInteger(&'static str),
    /// A gift pool entry that was not a four-element array.
    MalformedGiftEntry,
    /// A numeric id that could not be turned back into a GID.
    MalformedId(&'static str),
    /// Shards disagreed about the format version.
    ShardVersionMismatch,
    /// Shards disagreed about how many of them there are.
    ShardCountMismatch,
    /// A shard index was absent, duplicated, or out of range — which is what a
    /// metafield delivered as `null` looks like from in here.
    ShardMissing(usize),
    /// More shards were supplied than the format allows.
    TooManyShards,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WrongType(what) => write!(f, "wrong JSON type for {what}"),
            Self::MissingField(what) => write!(f, "missing field {what}"),
            Self::UnsupportedVersion(v) => write!(f, "unsupported config format version {v}"),
            Self::UnknownEnumValue(what, v) => write!(f, "unknown {what} code {v}"),
            Self::NotAnInteger(what) => write!(f, "{what} is not an exact integer"),
            Self::MalformedGiftEntry => write!(f, "gift pool entry is not a 4-element array"),
            Self::MalformedId(what) => write!(f, "malformed {what} id"),
            Self::ShardVersionMismatch => write!(f, "shards declare different format versions"),
            Self::ShardCountMismatch => write!(f, "shards disagree about the shard count"),
            Self::ShardMissing(k) => write!(f, "config shard {k} is missing"),
            Self::TooManyShards => write!(f, "too many config shards"),
        }
    }
}

/// Matches `MAX_SHARDS` in `app/entitlement/config/encode.ts`.
pub const MAX_SHARDS: usize = 4;

// ---------------------------------------------------------------------------
// JSON accessors
// ---------------------------------------------------------------------------

type Object = std::collections::BTreeMap<String, JsonValue>;

fn object<'a>(value: &'a JsonValue, what: &'static str) -> Result<&'a Object, DecodeError> {
    match value {
        JsonValue::Object(map) => Ok(map),
        _ => Err(DecodeError::WrongType(what)),
    }
}

fn array<'a>(value: &'a JsonValue, what: &'static str) -> Result<&'a [JsonValue], DecodeError> {
    match value {
        JsonValue::Array(items) => Ok(items),
        _ => Err(DecodeError::WrongType(what)),
    }
}

fn required<'a>(map: &'a Object, key: &str, what: &'static str) -> Result<&'a JsonValue, DecodeError> {
    map.get(key).ok_or(DecodeError::MissingField(what))
}

/// A JSON number read as an exact integer.
///
/// The host hands numbers to Wasm as `f64`. A fractional or out-of-range value
/// is a corrupt config, not something to truncate: rounding a variant id would
/// silently target the wrong product.
fn integer(value: &JsonValue, what: &'static str) -> Result<i64, DecodeError> {
    match value {
        JsonValue::Number(n) => {
            if !n.is_finite() || n.fract() != 0.0 || n.abs() > MAX_SAFE_INTEGER {
                Err(DecodeError::NotAnInteger(what))
            } else {
                Ok(*n as i64)
            }
        }
        _ => Err(DecodeError::WrongType(what)),
    }
}

fn text(value: &JsonValue, what: &'static str) -> Result<String, DecodeError> {
    match value {
        JsonValue::String(s) => Ok(s.clone()),
        _ => Err(DecodeError::WrongType(what)),
    }
}

fn string_list(map: &Object, key: &str, what: &'static str) -> Result<Vec<String>, DecodeError> {
    match map.get(key) {
        None => Ok(Vec::new()),
        Some(value) => array(value, what)?.iter().map(|v| text(v, what)).collect(),
    }
}

fn optional_integer(map: &Object, key: &str, what: &'static str) -> Result<Option<i64>, DecodeError> {
    map.get(key).map(|v| integer(v, what)).transpose()
}

// ---------------------------------------------------------------------------
// Enum codes
//
// The integers below are live in merchants' shops. Appending is safe;
// reordering silently reinterprets every published config. The table is
// duplicated verbatim in `app/entitlement/config/encode.ts` and pinned by the
// encoding vectors.
// ---------------------------------------------------------------------------

fn trigger(code: i64) -> Result<TriggerMetric, DecodeError> {
    match code {
        0 => Ok(TriggerMetric::Subtotal),
        1 => Ok(TriggerMetric::Quantity),
        _ => Err(DecodeError::UnknownEnumValue("trigger", code)),
    }
}

fn reward(code: i64) -> Result<RewardKind, DecodeError> {
    match code {
        0 => Ok(RewardKind::FreeShipping),
        1 => Ok(RewardKind::OrderPercent),
        2 => Ok(RewardKind::OrderFixed),
        3 => Ok(RewardKind::Gift),
        _ => Err(DecodeError::UnknownEnumValue("reward", code)),
    }
}

fn gift_discount(code: i64) -> Result<GiftDiscountType, DecodeError> {
    match code {
        0 => Ok(GiftDiscountType::Free),
        1 => Ok(GiftDiscountType::Percent),
        2 => Ok(GiftDiscountType::Fixed),
        _ => Err(DecodeError::UnknownEnumValue("gift discount type", code)),
    }
}

fn within_tier(code: i64) -> Result<WithinTierPolicy, DecodeError> {
    match code {
        0 => Ok(WithinTierPolicy::AllInPool),
        1 => Ok(WithinTierPolicy::PickOne),
        _ => Err(DecodeError::UnknownEnumValue("withinTier policy", code)),
    }
}

fn across_tiers(code: i64) -> Result<AcrossTierPolicy, DecodeError> {
    match code {
        0 => Ok(AcrossTierPolicy::Stack),
        1 => Ok(AcrossTierPolicy::Single),
        _ => Err(DecodeError::UnknownEnumValue("acrossTiers policy", code)),
    }
}

fn single_resolution(code: i64) -> Result<SingleTierResolution, DecodeError> {
    match code {
        0 => Ok(SingleTierResolution::Highest),
        1 => Ok(SingleTierResolution::Pinned),
        2 => Ok(SingleTierResolution::CustomerChoice),
        _ => Err(DecodeError::UnknownEnumValue("single resolution", code)),
    }
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/// A number becomes `prefix + digits`; a string is the id, exactly.
///
/// The encoder only ever emits the number form for an id that genuinely
/// carried `prefix`, so the mapping is injective in both directions and an id
/// that merely looks numeric survives unchanged.
fn id(value: &JsonValue, prefix: &str, what: &'static str) -> Result<String, DecodeError> {
    match value {
        JsonValue::String(s) => Ok(s.clone()),
        JsonValue::Number(_) => {
            let n = integer(value, what)?;
            if n <= 0 {
                return Err(DecodeError::MalformedId(what));
            }
            let digits = n.to_string();
            let mut out = String::with_capacity(prefix.len() + digits.len());
            out.push_str(prefix);
            out.push_str(&digits);
            Ok(out)
        }
        _ => Err(DecodeError::WrongType(what)),
    }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

fn decode_gift(value: &JsonValue) -> Result<GiftPoolEntry, DecodeError> {
    let items = array(value, "gift pool entry")?;
    if items.len() != 4 {
        return Err(DecodeError::MalformedGiftEntry);
    }
    Ok(GiftPoolEntry {
        variant_id: id(&items[0], VARIANT_GID_PREFIX, "variant")?,
        discount_type: gift_discount(integer(&items[1], "gift discount type")?)?,
        value: integer(&items[2], "gift value")?,
        max_qty: integer(&items[3], "gift maxQty")?,
    })
}

fn decode_tier(value: &JsonValue) -> Result<Tier, DecodeError> {
    let map = object(value, "tier")?;
    let gift_pool = match map.get("g") {
        None => Vec::new(),
        Some(pool) => array(pool, "gift pool")?.iter().map(decode_gift).collect::<Result<_, _>>()?,
    };
    Ok(Tier {
        id: text(required(map, "i", "tier id")?, "tier id")?,
        threshold: integer(required(map, "t", "tier threshold")?, "tier threshold")?,
        reward: reward(integer(required(map, "r", "tier reward")?, "tier reward")?)?,
        value: optional_integer(map, "v", "tier value")?,
        gift_pool,
    })
}

fn decode_offer(value: &JsonValue) -> Result<OfferConfig, DecodeError> {
    let map = object(value, "offer")?;

    let tiers = array(required(map, "r", "tiers")?, "tiers")?
        .iter()
        .map(decode_tier)
        .collect::<Result<Vec<_>, _>>()?;

    let claim_policy = ClaimPolicy {
        within_tier: within_tier(integer(required(map, "w", "withinTier")?, "withinTier")?)?,
        across_tiers: across_tiers(integer(required(map, "a", "acrossTiers")?, "acrossTiers")?)?,
        single_resolution: optional_integer(map, "s", "single resolution")?
            .map(single_resolution)
            .transpose()?,
        pinned_tier_id: map.get("p").map(|v| text(v, "pinnedTierId")).transpose()?,
    };

    let scope_code = optional_integer(map, "y", "scope kind")?.unwrap_or(0);
    let scope = match scope_code {
        0 => OfferScope::EntireCart,
        1 => OfferScope::Collections(scope_ids(map, COLLECTION_GID_PREFIX, "collection")?),
        2 => OfferScope::Products(scope_ids(map, PRODUCT_GID_PREFIX, "product")?),
        _ => return Err(DecodeError::UnknownEnumValue("scope kind", scope_code)),
    };

    Ok(OfferConfig {
        offer: Offer {
            id: text(required(map, "i", "offer id")?, "offer id")?,
            trigger: trigger(integer(required(map, "t", "trigger")?, "trigger")?)?,
            claim_policy,
            tiers,
        },
        scope,
        audience: OfferAudience {
            customer_tags: string_list(map, "x", "customer tag")?,
            markets: string_list(map, "m", "market")?,
        },
    })
}

fn scope_ids(map: &Object, prefix: &str, what: &'static str) -> Result<Vec<String>, DecodeError> {
    match map.get("c") {
        None => Ok(Vec::new()),
        Some(value) => array(value, "scope ids")?
            .iter()
            .map(|v| id(v, prefix, what))
            .collect(),
    }
}

/// Decode a single, unsharded config document.
pub fn decode_config(value: &JsonValue) -> Result<Vec<OfferConfig>, DecodeError> {
    decode_shards(std::slice::from_ref(&value))
}

/// Decode a config spread across one or more metafields on the discount node.
///
/// Shards may arrive in any order; offers are reassembled in shard-index
/// order, which is publish order.
///
/// **The point of the shard header is detection.** An over-cap metafield is
/// delivered as `null`, silently. If a shard goes missing, every shard that
/// did arrive still declares `n`, so the count will not match and this returns
/// `ShardMissing` rather than a config that is quietly short a few offers.
/// A caller that gets an error here must fail closed and grant nothing; a
/// partially-applied config is the failure mode this whole format exists to
/// prevent.
pub fn decode_shards(shards: &[&JsonValue]) -> Result<Vec<OfferConfig>, DecodeError> {
    if shards.is_empty() {
        return Err(DecodeError::ShardMissing(0));
    }
    if shards.len() > MAX_SHARDS {
        return Err(DecodeError::TooManyShards);
    }

    // (index, offers) for each shard, then ordered by index.
    let mut parsed: Vec<(usize, Vec<OfferConfig>)> = Vec::with_capacity(shards.len());
    let mut declared_count: Option<usize> = None;

    for shard in shards {
        let map = object(shard, "config document")?;

        let version = integer(required(map, "v", "format version")?, "format version")?;
        if version != CONFIG_FORMAT_VERSION {
            return Err(if parsed.is_empty() {
                DecodeError::UnsupportedVersion(version)
            } else {
                DecodeError::ShardVersionMismatch
            });
        }

        let index = optional_integer(map, "k", "shard index")?.unwrap_or(0);
        let count = optional_integer(map, "n", "shard count")?.unwrap_or(1);
        if count < 1 || count > MAX_SHARDS as i64 {
            return Err(DecodeError::TooManyShards);
        }
        if index < 0 || index >= count {
            return Err(DecodeError::ShardCountMismatch);
        }
        match declared_count {
            None => declared_count = Some(count as usize),
            Some(seen) if seen != count as usize => return Err(DecodeError::ShardCountMismatch),
            Some(_) => {}
        }

        let offers = array(required(map, "o", "offers")?, "offers")?
            .iter()
            .map(decode_offer)
            .collect::<Result<Vec<_>, _>>()?;

        parsed.push((index as usize, offers));
    }

    let expected = declared_count.unwrap_or(1);
    if parsed.len() != expected {
        // Either a shard did not arrive, or one arrived twice.
        let present: Vec<usize> = parsed.iter().map(|(k, _)| *k).collect();
        let missing = (0..expected).find(|k| !present.contains(k)).unwrap_or(0);
        return Err(DecodeError::ShardMissing(missing));
    }

    parsed.sort_by_key(|(index, _)| *index);
    for (position, (index, _)) in parsed.iter().enumerate() {
        if position != *index {
            return Err(DecodeError::ShardMissing(position));
        }
    }

    Ok(parsed.into_iter().flat_map(|(_, offers)| offers).collect())
}

/// The `Offer`s alone, for callers that only need the entitlement core.
pub fn offers_of(configs: &[OfferConfig]) -> Vec<Offer> {
    configs.iter().map(|c| c.offer.clone()).collect()
}
