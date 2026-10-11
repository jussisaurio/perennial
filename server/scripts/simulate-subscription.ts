// stripe-mock never sends webhooks, so after "paying" locally, send the
// webhook Stripe would send. Signed with the local secret and verified by the
// server exactly like a real one.
//
//   bun server/scripts/simulate-subscription.ts you@example.com [active|past_due|canceled]

import Stripe from "stripe";

const [email, status = "active"] = process.argv.slice(2);
if (!email) {
  console.error("usage: bun server/scripts/simulate-subscription.ts <email> [active|past_due|canceled]");
  process.exit(1);
}
const server = process.env.SERVER ?? "http://localhost:8787";
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_local";

const user = await fetch(`${server}/api/dev/user?email=${encodeURIComponent(email)}`).then((r) => r.json());
if (!user.stripe_customer) {
  console.error(`No Stripe customer for ${email}. Sign in and press an Upgrade button first.`);
  process.exit(1);
}
const type = status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated";
const payload = JSON.stringify({
  id: `evt_local_${Date.now()}`,
  object: "event",
  type,
  data: { object: { id: "sub_local", object: "subscription", customer: user.stripe_customer, status, items: { object: "list", data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } } },
});
const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
const res = await fetch(`${server}/api/billing/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
console.log(res.status, await res.text());
