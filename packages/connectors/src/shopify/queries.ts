/**
 * GraphQL Admin API operations. Every operation here was validated against the Admin
 * schema (version in @ecom/core/config) before use. Field names: see
 * https://shopify.dev/docs/api/admin-graphql — do not edit from memory; re-validate.
 */

const MONEY = "shopMoney { amount }";

const ORDER_FIELDS = `
  id name createdAt updatedAt cancelledAt processedAt test taxesIncluded currencyCode presentmentCurrencyCode sourceName
  displayFinancialStatus displayFulfillmentStatus requiresShipping totalWeight
  channelInformation { channelDefinition { channelName handle } }
  customer { id }
  shippingAddress { countryCodeV2 }
  subtotalPriceSet { ${MONEY} }
  totalDiscountsSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  totalTaxSet { ${MONEY} }
  totalPriceSet { shopMoney { amount currencyCode } }
  customerJourneySummary { customerOrderIndex lastVisit { landingPage utmParameters { source medium campaign content term } } }
`;

/**
 * Incremental orders page. Kept to 10 orders per page so the requested query cost stays
 * under Shopify's 1,000-point single-query limit. Orders with more lines than fit, or
 * with refunds, are completed with ORDER_DETAIL_QUERY.
 */
export const ORDERS_QUERY = `
query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ${ORDER_FIELDS}
      shippingLines(first: 3) { nodes { discountedPriceSet { ${MONEY} } taxLines { priceSet { ${MONEY} } } } }
      fulfillments(first: 3) { createdAt status }
      lineItems(first: 30) {
        pageInfo { hasNextPage }
        nodes { id sku name title variantTitle quantity requiresShipping
          originalUnitPriceSet { ${MONEY} }
          totalDiscountSet { ${MONEY} }
          taxLines { priceSet { ${MONEY} } }
          variant { id }
          product { id } }
      }
      transactions(first: 10) { id kind status gateway processedAt test amountSet { shopMoney { amount currencyCode } } }
    }
  }
}`;

/** Everything for one order, with large limits, plus refunds. */
export const ORDER_DETAIL_QUERY = `
query OrderDetail($id: ID!) {
  order(id: $id) {
    ${ORDER_FIELDS}
    shippingLines(first: 10) { nodes { discountedPriceSet { ${MONEY} } taxLines { priceSet { ${MONEY} } } } }
    fulfillments(first: 10) { createdAt status }
    lineItems(first: 250) {
      pageInfo { hasNextPage }
      nodes { id sku name title variantTitle quantity requiresShipping
        originalUnitPriceSet { ${MONEY} }
        totalDiscountSet { ${MONEY} }
        taxLines { priceSet { ${MONEY} } }
        variant { id }
        product { id } }
    }
    transactions(first: 50) { id kind status gateway processedAt test amountSet { shopMoney { amount currencyCode } } }
    refunds(first: 50) {
      id createdAt note
      totalRefundedSet { ${MONEY} }
      refundShippingLines(first: 10) { nodes { subtotalAmountSet { ${MONEY} } taxAmountSet { ${MONEY} } } }
      refundLineItems(first: 250) { nodes { id quantity restockType restocked lineItem { id } subtotalSet { ${MONEY} } totalTaxSet { ${MONEY} } } }
    }
  }
}`;

/** Bulk operation for the history load (no cost limit; output is JSONL with __parentId). */
export function bulkOrdersQuery(sinceIso: string): string {
  return `{
  orders(query: "created_at:>=${sinceIso}") { edges { node {
    ${ORDER_FIELDS}
    fulfillments { createdAt status }
    transactions { id kind status gateway processedAt test amountSet { shopMoney { amount currencyCode } } }
    lineItems { edges { node { id sku name title variantTitle quantity requiresShipping
      originalUnitPriceSet { ${MONEY} } totalDiscountSet { ${MONEY} } taxLines { priceSet { ${MONEY} } } variant { id } product { id } } } }
    shippingLines { edges { node { discountedPriceSet { ${MONEY} } taxLines { priceSet { ${MONEY} } } } } }
  } } }
}`;
}

export const BULK_RUN_MUTATION = `
mutation Bulk($query: String!) {
  bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { field message } }
}`;

export const BULK_STATUS_QUERY = `
query BulkStatus($id: ID!) { node(id: $id) { ... on BulkOperation { id status errorCode objectCount url partialDataUrl } } }`;

export const VARIANTS_QUERY = `
query Variants($first: Int!, $after: String, $query: String) {
  productVariants(first: $first, after: $after, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes { id sku title price updatedAt inventoryQuantity
      product { id title status productType vendor updatedAt featuredMedia { preview { image { url } } } }
      inventoryItem { unitCost { amount currencyCode } measurement { weight { unit value } } } }
  }
}`;

export const BALANCE_TXNS_QUERY = `
query Fees($first: Int!, $after: String, $query: String) {
  shopifyPaymentsAccount { balanceTransactions(first: $first, after: $after, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes { id type test transactionDate amount { amount currencyCode } fee { amount currencyCode } net { amount currencyCode } associatedOrder { id name } sourceOrderTransactionId } } }
}`;

export const SHOP_QUERY = `query Shop { shop { id name myshopifyDomain currencyCode ianaTimezone taxesIncluded plan { publicDisplayName } } }`;

export const SHOPIFYQL_QUERY = `query QL($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name dataType displayName } rows } parseErrors } }`;

export const ORDERS_COUNT_PROBE = `query Probe { orders(first: 1, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt totalPriceSet { shopMoney { amount currencyCode } } } } }`;
