/**
 * The publish pipeline.
 *
 * Turns drafts into the three payloads a storefront actually reads, creates or
 * updates the single automatic app discount, and records the version so a
 * publish can be undone.
 *
 * The GraphQL here was validated against the 2026-07 schema rather than written
 * from memory.
 */

import type { AdminApiContext } from '@shopify/shopify-app-react-router/server';

import { compile, type CompiledPublish } from './compile';
import type { GiftDisplay, OfferDraft } from './offer-draft';

export const CONFIG_NAMESPACE = '$app';
export const CONFIG_KEY = 'cartbloom-config';
export const INPUT_VARIABLES_KEY = 'cartbloom-input-variables';
export const WIDGET_CONFIG_KEY = 'cartbloom-widget-config';

const FUNCTIONS_QUERY = `#graphql
  query CartBloomFunctions {
    shopifyFunctions(apiType: "discount", first: 25) {
      nodes { id handle title apiType }
    }
  }`;

const SHOP_QUERY = `#graphql
  query CartBloomShop {
    shop { id currencyFormats { moneyFormat } }
  }`;

/**
 * Resolved without a single image field.
 *
 * Every way of reaching a variant's image — `image`, `media`, the product's
 * featured media — requires `read_files`, `read_orders` and more. CartBloom
 * requests `read_products` and nothing else, because staying out of Protected
 * Customer Data entirely is worth more than server-resolved thumbnails. Images
 * come from the App Bridge picker instead, which hands them over client-side at
 * the moment a merchant chooses the product.
 */
const VARIANTS_QUERY = `#graphql
  query CartBloomVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        availableForSale
        product { title status }
      }
    }
  }`;

const DISCOUNT_CREATE = `#graphql
  mutation CartBloomDiscountCreate($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId title status startsAt }
      userErrors { field message }
    }
  }`;

const DISCOUNT_UPDATE = `#graphql
  mutation CartBloomDiscountUpdate($id: ID!, $discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId title status }
      userErrors { field message }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation CartBloomMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }`;

type Admin = AdminApiContext;

async function gql<T>(admin: Admin, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  if (body.data === undefined) throw new Error('Shopify returned no data');
  return body.data;
}

export interface ResolvedVariants {
  displays: GiftDisplay[];
  /** Variant GID to the reason it cannot be bought. */
  unbuyable: Map<string, string>;
  /** Variants Shopify no longer knows about. */
  missing: string[];
}

/**
 * Resolve gift variants in one batched query rather than one per variant.
 *
 * A merchant with six tiers of four gifts would otherwise make 24 round trips
 * inside a request budgeted at roughly 6 ms of CPU.
 */
export async function resolveVariants(
  admin: Admin,
  variantIds: string[],
  known: GiftDisplay[]
): Promise<ResolvedVariants> {
  if (variantIds.length === 0) {
    return { displays: [], unbuyable: new Map(), missing: [] };
  }

  const data = await gql<{
    nodes: Array<
      | {
          id: string;
          title: string;
          price: string;
          availableForSale: boolean;
          product: { title: string; status: string };
        }
      | null
    >;
  }>(admin, VARIANTS_QUERY, { ids: variantIds });

  const displays: GiftDisplay[] = [];
  const unbuyable = new Map<string, string>();
  const seen = new Set<string>();

  for (const node of data.nodes) {
    if (node === null) continue;
    seen.add(node.id);

    // "Small / Black" alone is meaningless in a gift chooser; the product name
    // is what a shopper recognises.
    const title =
      node.title === 'Default Title' ? node.product.title : `${node.product.title} — ${node.title}`;

    displays.push({
      variantId: node.id,
      title,
      // Kept from the picker: resolving it server-side would cost scopes that
      // pull CartBloom into Protected Customer Data.
      image: known.find((d) => d.variantId === node.id)?.image,
      price: Math.round(Number(node.price) * 100),
    });

    if (node.product.status !== 'ACTIVE') {
      unbuyable.set(node.id, 'is not published to your storefront');
    } else if (!node.availableForSale) {
      unbuyable.set(node.id, 'is out of stock');
    }
  }

  return {
    displays,
    unbuyable,
    missing: variantIds.filter((id) => !seen.has(id)),
  };
}

export async function getShopInfo(admin: Admin): Promise<{ id: string; moneyFormat: string }> {
  const data = await gql<{ shop: { id: string; currencyFormats: { moneyFormat: string } } }>(
    admin,
    SHOP_QUERY
  );
  return { id: data.shop.id, moneyFormat: data.shop.currencyFormats.moneyFormat };
}

export async function getDiscountFunctionId(admin: Admin): Promise<string> {
  const data = await gql<{
    shopifyFunctions: { nodes: Array<{ id: string; handle: string; title: string }> };
  }>(admin, FUNCTIONS_QUERY);

  const fn =
    data.shopifyFunctions.nodes.find((n) => n.handle === 'discount-function') ??
    data.shopifyFunctions.nodes[0];

  if (fn === undefined) {
    throw new Error(
      'No discount function is installed for this app. Deploy the app extensions before publishing.'
    );
  }
  return fn.id;
}

interface UserError {
  field?: string[] | null;
  message: string;
}

function throwOnUserErrors(errors: UserError[] | undefined, what: string): void {
  if (errors && errors.length > 0) {
    throw new Error(`${what}: ${errors.map((e) => e.message).join('; ')}`);
  }
}

/**
 * Create or update the shop's single automatic app discount.
 *
 * Exactly one per shop, recorded in D1. The 25-node cap is shared with every
 * other app the merchant has installed, so creating a node per offer would
 * spend a budget that is not ours.
 *
 * `startsAt` is always now or in the past. Task 25 found the API accepts a
 * future date, reports SCHEDULED, and then silently does nothing.
 */
export async function ensureDiscountNode(
  admin: Admin,
  existingId: string | null,
  compiled: CompiledPublish
): Promise<string> {
  const metafields = [
    {
      namespace: CONFIG_NAMESPACE,
      key: CONFIG_KEY,
      type: 'json',
      value: compiled.compactJson,
    },
    {
      namespace: CONFIG_NAMESPACE,
      key: INPUT_VARIABLES_KEY,
      type: 'json',
      value: JSON.stringify(compiled.inputVariables),
    },
  ];

  if (existingId !== null) {
    const data = await gql<{
      discountAutomaticAppUpdate: {
        automaticAppDiscount: { discountId: string } | null;
        userErrors: UserError[];
      };
    }>(admin, DISCOUNT_UPDATE, {
      id: existingId,
      discount: {
        title: 'CartBloom rewards',
        discountClasses: compiled.discountClasses,
        metafields,
      },
    });

    throwOnUserErrors(data.discountAutomaticAppUpdate.userErrors, 'Could not update the discount');
    const id = data.discountAutomaticAppUpdate.automaticAppDiscount?.discountId;
    if (id !== undefined) return id;
    // Fall through: the node was deleted in the admin behind our back, so
    // recreate rather than leaving the shop with no discount.
  }

  const functionId = await getDiscountFunctionId(admin);

  const data = await gql<{
    discountAutomaticAppCreate: {
      automaticAppDiscount: { discountId: string } | null;
      userErrors: UserError[];
    };
  }>(admin, DISCOUNT_CREATE, {
    discount: {
      title: 'CartBloom rewards',
      functionId,
      // Mandatory for functions on the `discounts` API type. Derived from what
      // the live offers award; see discountClassesFor.
      discountClasses: compiled.discountClasses,
      startsAt: new Date().toISOString(),
      metafields,
    },
  });

  throwOnUserErrors(data.discountAutomaticAppCreate.userErrors, 'Could not create the discount');
  const id = data.discountAutomaticAppCreate.automaticAppDiscount?.discountId;
  if (id === undefined) throw new Error('Shopify did not return a discount id');
  return id;
}

/** Write the widget payload to the shop, where Liquid can read it. */
export async function writeWidgetConfig(
  admin: Admin,
  shopId: string,
  compiled: CompiledPublish
): Promise<void> {
  const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(admin, METAFIELDS_SET, {
    metafields: [
      {
        ownerId: shopId,
        namespace: CONFIG_NAMESPACE,
        key: WIDGET_CONFIG_KEY,
        type: 'json',
        value: JSON.stringify(compiled.widget),
      },
    ],
  });

  throwOnUserErrors(data.metafieldsSet.userErrors, 'Could not write the widget configuration');
}

export { compile };
export type { CompiledPublish, OfferDraft };
