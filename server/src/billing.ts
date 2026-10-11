// Stripe subscriptions. The webhook is the only thing that changes a plan, so
// access always follows Stripe's view of the subscription, never the browser.

import type { Database } from "bun:sqlite";
import Stripe from "stripe";
import type { User } from "./auth";
import type { Config } from "./config";

export class BillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Subscription states that keep Pro features on. `past_due` keeps them during Stripe's retry window. */
const ACTIVE = new Set(["active", "trialing", "past_due"]);

export class Billing {
  readonly stripe: Stripe | null;

  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {
    const s = config.stripe;
    this.stripe = s.secretKey ? new Stripe(s.secretKey, { host: s.host, port: s.port, protocol: s.protocol }) : null;
  }

  private require(): Stripe {
    if (!this.stripe) throw new BillingError(503, "billing_not_configured");
    return this.stripe;
  }

  private async customerFor(user: User): Promise<string> {
    if (user.stripe_customer) return user.stripe_customer;
    const customer = await this.require().customers.create({ email: user.email, metadata: { user_id: user.id } });
    this.db.query("UPDATE users SET stripe_customer = ? WHERE id = ?").run(customer.id, user.id);
    return customer.id;
  }

  async checkout(user: User, interval: "month" | "year"): Promise<string> {
    const price = interval === "year" ? this.config.stripe.priceYearly : this.config.stripe.priceMonthly;
    if (!price) throw new BillingError(503, "billing_not_configured");
    if (user.plan === "pro") throw new BillingError(409, "already_subscribed");
    const session = await this.require().checkout.sessions.create({
      mode: "subscription",
      customer: await this.customerFor(user),
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${this.config.appUrl}/?billing=success`,
      cancel_url: `${this.config.appUrl}/?billing=cancelled`,
    });
    if (!session.url) throw new BillingError(502, "no_checkout_url");
    return session.url;
  }

  async portal(user: User): Promise<string> {
    if (!user.stripe_customer) throw new BillingError(400, "no_subscription");
    const session = await this.require().billingPortal.sessions.create({ customer: user.stripe_customer, return_url: this.config.appUrl });
    return session.url;
  }

  /** Verify and apply a webhook. Returns the event type, for logging. */
  async webhook(rawBody: string, signature: string | null): Promise<string> {
    const stripe = this.require();
    if (!this.config.stripe.webhookSecret || !signature) throw new BillingError(400, "bad_signature");
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, this.config.stripe.webhookSecret);
    } catch {
      throw new BillingError(400, "bad_signature");
    }
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.client_reference_id && typeof s.customer === "string")
          this.db.query("UPDATE users SET stripe_customer = ? WHERE id = ? AND stripe_customer IS NULL").run(s.customer, s.client_reference_id);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const active = event.type !== "customer.subscription.deleted" && ACTIVE.has(sub.status);
        const periodEnd = sub.items?.data?.[0]?.current_period_end ?? null;
        this.db
          .query("UPDATE users SET plan = ?, sub_status = ?, sub_period_end = ? WHERE stripe_customer = ?")
          .run(active ? "pro" : "free", sub.status, periodEnd, customer);
        break;
      }
    }
    return event.type;
  }
}
