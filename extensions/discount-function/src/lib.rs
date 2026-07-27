//! Library face of the discount function extension.
//!
//! The Wasm entry points live in `src/main.rs`; this crate exists so the
//! entitlement core can be unit-tested and driven by the vector conformance
//! suite in `tests/conformance.rs` without a Wasm host. Task 23 wires
//! `cart_lines_discounts_generate_run` to this core.

pub mod config;
pub mod entitlement;
