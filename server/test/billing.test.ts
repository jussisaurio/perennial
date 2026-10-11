// Runs the real Stripe SDK against stripe-mock (Docker). Skipped when Docker
// isn't available. Webhooks are signed with Stripe's own test helper and
// verified by the real constructEventAsync.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { startApp, stopMockLLM } from "./helpers";

const dockerOk = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
const PORT = 12111 + Math.floor(Math.random() * 1000);
const WEBHOOK_SECRET = "whsec_test_secret";
let container = "";

describe.skipIf(!dockerOk)("billing (stripe-mock)", () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => {
    const run = Bun.spawnSync(["docker", "run", "-d", "--rm", "-p", `${PORT}:12111`, "stripe/stripe-mock:latest"]);
    container = run.stdout.toString().trim();
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`http://localhost:${PORT}/v1/customers`, { headers: { authorization: "Bearer sk_test_123" } });
        break;
      } catch {
        await Bun.sleep(100);
      }
    }
    t = await startApp({
      stripe: { secretKey: "sk_test_123", webhookSecret: WEBHOOK_SECRET, priceMonthly: "price_monthly", priceYearly: "price_yearly", host: "localhost", port: PORT, protocol: "http" },
    });
  }, 30_000);
  afterAll(() => {
    t?.stop();
    stopMockLLM();
    if (container) Bun.spawnSync(["docker", "rm", "-f", container]);
  });

  const signed = async (event: unknown) => {
    const payload = JSON.stringify(event);
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET });
    return fetch(`${t.url}/api/billing/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": header, "content-type": "application/json" } });
  };
  const subEvent = (type: string, customer: string, status: string) => ({
    id: `evt_${Math.random()}`,
    object: "event",
    type,
    data: { object: { id: "sub_1", object: "subscription", customer, status, items: { object: "list", data: [{ current_period_end: 1893456000 }] } } },
  });

  test("checkout creates a Stripe customer and returns a Checkout URL", async () => {
    const token = await t.signIn("payer@example.com");
    const r = await t.call("/api/billing/checkout", { interval: "year" }, token);
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\//);
    const user = t.app.auth.userByEmail("payer@example.com")!;
    expect(user.stripe_customer).toMatch(/^cus_/);
    const portal = await t.call("/api/billing/portal", {}, token);
    expect(portal.body.url).toMatch(/^https:\/\//);
  });

  test("signed subscription webhooks switch the plan; unsigned ones are rejected", async () => {
    const token = await t.signIn("sub@example.com");
    await t.call("/api/billing/checkout", { interval: "month" }, token);
    const customer = t.app.auth.userByEmail("sub@example.com")!.stripe_customer!;

    const forged = await fetch(`${t.url}/api/billing/webhook`, { method: "POST", body: JSON.stringify(subEvent("customer.subscription.created", customer, "active")), headers: { "stripe-signature": "t=1,v1=nope" } });
    expect(forged.status).toBe(400);
    expect((await t.call("/api/me", undefined, token)).body.plan).toBe("free");

    expect((await signed(subEvent("customer.subscription.created", customer, "active"))).status).toBe(200);
    const me = (await t.call("/api/me", undefined, token)).body;
    expect(me).toMatchObject({ plan: "pro", credits: { limit: 2000 }, subscription: { status: "active", periodEnd: 1893456000 } });
    expect((await t.call("/api/billing/checkout", { interval: "month" }, token)).body.error).toBe("already_subscribed");

    await signed(subEvent("customer.subscription.updated", customer, "past_due"));
    expect((await t.call("/api/me", undefined, token)).body.plan).toBe("pro"); // grace during retries

    await signed(subEvent("customer.subscription.deleted", customer, "canceled"));
    expect((await t.call("/api/me", undefined, token)).body.plan).toBe("free");
  });

  test("without Stripe configured, billing says so instead of crashing", async () => {
    const plain = await startApp({ stripe: {} });
    const token = await plain.signIn("nobill@example.com");
    expect((await plain.call("/api/billing/checkout", { interval: "month" }, token)).body.error).toBe("billing_not_configured");
    plain.stop();
  });
});
