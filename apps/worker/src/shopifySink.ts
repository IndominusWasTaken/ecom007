import { localDate } from "@ecom/core/dates";
import { and, eq, getDb, inArray, markDirty, orderLines, orders, refundLines, refunds, sql, transactions, type Db } from "@ecom/db";
import { lineSales } from "@ecom/metrics";
import type { shopify } from "@ecom/connectors";
import type { StoreRow } from "./context";

/**
 * Upserts orders with their lines, refunds and transactions, then marks every affected
 * store-day dirty (old and new order date, refund dates, fulfilment date).
 * Children of an order are replaced as a set, so edits and removals on Shopify are mirrored.
 */
export function shopifySink(store: StoreRow, db: Db = getDb()): shopify.ShopifySink {
  return {
    async orders(records) {
      if (!records.length) return 0;
      const dirty = new Set<string>();
      const existing = await db
        .select({ shopifyId: orders.shopifyId, localDate: orders.localDate, fulfilledLocalDate: orders.fulfilledLocalDate })
        .from(orders)
        .where(and(eq(orders.storeId, store.id), inArray(orders.shopifyId, records.map((r) => r.shopifyId))));
      for (const e of existing) {
        dirty.add(e.localDate);
        if (e.fulfilledLocalDate) dirty.add(e.fulfilledLocalDate);
      }
      // existing refund dates too (a refund can be removed or re-dated)
      const oldRefundDates = await db.execute<{ local_date: string }>(sql`
        select distinct r.local_date::text from refunds r join orders o on o.id = r.order_id
        where o.store_id = ${store.id} and o.shopify_id = any(${sql.param(records.map((r) => r.shopifyId))}::text[])`);
      for (const r of oldRefundDates.rows) dirty.add(r.local_date);

      await db.transaction(async (tx) => {
        for (const r of records) {
          const ld = localDate(r.createdAt, store.timeZone);
          const fld = r.fulfilledAt ? localDate(r.fulfilledAt, store.timeZone) : null;
          dirty.add(ld);
          if (fld) dirty.add(fld);
          const values = {
            storeId: store.id,
            shopifyId: r.shopifyId,
            name: r.name,
            createdAtUtc: new Date(r.createdAt),
            updatedAtUtc: new Date(r.updatedAt),
            cancelledAtUtc: r.cancelledAt ? new Date(r.cancelledAt) : null,
            localDate: ld,
            test: r.test,
            currency: r.currency,
            presentmentCurrency: r.presentmentCurrency,
            taxesIncluded: r.taxesIncluded,
            sourceName: r.sourceName,
            channel: r.channel,
            customerId: r.customerId,
            customerOrderIndex: r.customerOrderIndex,
            shippingCountry: r.shippingCountry,
            requiresShipping: r.requiresShipping,
            totalWeightGrams: r.totalWeightGrams,
            financialStatus: r.financialStatus,
            fulfillmentStatus: r.fulfillmentStatus,
            fulfilledAtUtc: r.fulfilledAt ? new Date(r.fulfilledAt) : null,
            fulfilledLocalDate: fld,
            subtotal: r.subtotal,
            totalDiscounts: r.totalDiscounts,
            shippingAmount: r.shippingAmount,
            shippingTax: r.shippingTax,
            totalTax: r.totalTax,
            totalPrice: r.totalPrice,
            utmSource: r.utm.source,
            utmMedium: r.utm.medium,
            utmCampaign: r.utm.campaign,
            utmContent: r.utm.content,
            utmTerm: r.utm.term,
            landingPage: r.landingPage,
            raw: r.raw as object,
            syncedAt: new Date(),
          };
          const [row] = await tx
            .insert(orders)
            .values(values)
            .onConflictDoUpdate({ target: [orders.storeId, orders.shopifyId], set: values })
            .returning({ id: orders.id });
          const orderId = row.id;

          await tx.delete(orderLines).where(eq(orderLines.orderId, orderId));
          if (r.lines.length) {
            await tx.insert(orderLines).values(
              r.lines.map((l) => {
                const s = lineSales(
                  { id: l.shopifyId, variantId: l.variantShopifyId, productId: l.productShopifyId, sku: l.sku, title: l.title, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, tax: l.tax, unitCost: null },
                  r.taxesIncluded,
                );
                return {
                  storeId: store.id,
                  orderId,
                  shopifyId: l.shopifyId,
                  productShopifyId: l.productShopifyId,
                  variantShopifyId: l.variantShopifyId,
                  sku: l.sku,
                  title: l.title,
                  variantTitle: l.variantTitle,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  discount: l.discount,
                  tax: l.tax,
                  grossEx: s.gross.toFixed(6),
                  discountEx: s.discount.toFixed(6),
                  requiresShipping: l.requiresShipping,
                  raw: l.raw as object,
                };
              }),
            );
          }

          await tx.delete(transactions).where(eq(transactions.orderId, orderId));
          if (r.transactions.length) {
            await tx.insert(transactions).values(
              r.transactions.map((t) => ({
                storeId: store.id,
                orderId,
                shopifyId: t.shopifyId,
                kind: t.kind,
                status: t.status,
                gateway: t.gateway,
                amount: t.amount,
                currency: t.currency,
                test: t.test,
                processedAtUtc: t.processedAt ? new Date(t.processedAt) : null,
              })),
            );
          }

          if (r.refunds) {
            await tx.delete(refunds).where(eq(refunds.orderId, orderId));
            for (const f of r.refunds) {
              const rld = localDate(f.createdAt, store.timeZone);
              dirty.add(rld);
              const [rr] = await tx
                .insert(refunds)
                .values({
                  storeId: store.id,
                  orderId,
                  shopifyId: f.shopifyId,
                  createdAtUtc: new Date(f.createdAt),
                  localDate: rld,
                  totalRefunded: f.totalRefunded,
                  shippingAmount: f.shippingAmount,
                  shippingTax: f.shippingTax,
                  otherAmount: f.otherAmount,
                  note: f.note,
                  raw: f.raw as object,
                })
                .returning({ id: refunds.id });
              if (f.lines.length) {
                await tx.insert(refundLines).values(
                  f.lines.map((l) => ({
                    storeId: store.id,
                    refundId: rr.id,
                    shopifyId: l.shopifyId,
                    orderLineShopifyId: l.orderLineShopifyId,
                    quantity: l.quantity,
                    subtotal: l.subtotal,
                    tax: l.tax,
                    restockType: l.restockType,
                    restocked: l.restocked,
                  })),
                );
              }
            }
          }
        }
      });
      await markDirty(db, store.id, dirty);
      return records.length;
    },
  };
}

/**
 * New vs returning is decided per store from our own history: the customer's earliest
 * non-test order is their first. Returns dates whose flag changed.
 */
export async function recomputeFirstOrders(db: Db, storeId: number) {
  const res = await db.execute<{ local_date: string }>(sql`
    with firsts as (
      select distinct on (customer_id) customer_id, id as first_id
      from orders where store_id = ${storeId} and not test and customer_id is not null
      order by customer_id, created_at_utc, id
    ), upd as (
      update orders o set is_first_order = (f.first_id is not null and o.id = f.first_id)
      from orders o2 left join firsts f on f.customer_id = o2.customer_id
      where o.id = o2.id and o.store_id = ${storeId}
        and o.is_first_order is distinct from (f.first_id is not null and o.id = f.first_id)
      returning o.local_date::text as local_date
    ) select distinct local_date from upd`);
  const dates = res.rows.map((r) => r.local_date);
  if (dates.length) await markDirty(db, storeId, dates);
  return dates.length;
}
