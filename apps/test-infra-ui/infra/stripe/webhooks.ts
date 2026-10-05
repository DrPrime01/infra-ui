import Stripe from "stripe";
import { stripe } from "./client";
import { adapter } from "./adapter";

export interface SubscriptionData {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  priceId: string;
  status: string;
}

function subscriptionIdOf(
  v: string | Stripe.Subscription | null | undefined,
): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string }).subscription;
  const modern = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string } };
  }).parent?.subscription_details?.subscription;
  return modern ?? legacy ?? null;
}

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = subscriptionIdOf(session.subscription);
      if (!subId) break;
      const subscription = await stripe.subscriptions.retrieve(subId);
      const priceId = subscription.items.data[0]?.price.id ?? "";
      if (!priceId) {
        console.warn(
          `[stripe webhook] No price on subscription ${subId} — recording with empty priceId.`,
        );
      }
      await adapter.updateSubscription({
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subId,
        priceId,
        status: "active",
      });
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await adapter.updateSubscription({
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        priceId: subscription.items.data[0]?.price.id ?? "",
        status: subscription.status,
      });
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await adapter.updateSubscription({
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        priceId: subscription.items.data[0]?.price.id ?? "",
        status: "canceled",
      });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(invoice);
      if (!subId) break;
      const firstLine = invoice.lines.data[0] as unknown as {
        pricing?: { price?: string };
        price?: { id?: string };
      };
      const priceId =
        firstLine?.pricing?.price ?? firstLine?.price?.id ?? "";
      await adapter.updateSubscription({
        stripeCustomerId: invoice.customer as string,
        stripeSubscriptionId: subId,
        priceId,
        status: "past_due",
      });
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
}
