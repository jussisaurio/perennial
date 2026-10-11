import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { WEBHOOK_SECRET } from "../playwright.config";

const email = () => `learner-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function signIn(page: Page, address: string, cta: string) {
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: cta }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  const res = await page.request.get(`/api/dev/outbox?email=${encodeURIComponent(address)}`);
  const { code } = await res.json();
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function startHosted(page: Page, address: string) {
  await page.goto("/");
  await signIn(page, address, "Start free with my email");
  await expect(page.getByText(`Signed in as ${address}`)).toBeVisible();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByText(/new words are ready/)).toBeVisible();
}

test("new learner: Perennial AI with just an email, no keys", async ({ page }) => {
  await startHosted(page, email());
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText(/Free plan/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Perennial AI/ })).toBeChecked();
  await expect(page.getByText(/AI words left this month/)).toBeVisible();
});

test("a second device signs in and gets the same course through account sync", async ({ browser }) => {
  const address = email();
  const one = await browser.newPage();
  await startHosted(one, address);
  const lang = await one.getByRole("heading", { level: 1 }).locator("em").textContent();

  const two = await (await browser.newContext()).newPage();
  await two.goto("/");
  await two.getByRole("button", { name: /already use Perennial/ }).click();
  await signIn(two, address, "Sign in");
  await expect(two.getByRole("heading", { level: 1 }).locator("em")).toHaveText(lang!, { timeout: 15_000 });
});

test("words from a text use credits; running out offers Pro; paying turns Pro on", async ({ page }) => {
  const address = email();
  await startHosted(page, address);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("button", { name: "Add words" }).click();
  await page.getByPlaceholder(/Paste .* text here/).fill("zorro búho lince nutria tejón garza ciervo");
  // The cost is visible before any tap.
  await expect(page.getByText(/You have 6 of 6 AI words left this month/)).toBeVisible();
  for (const w of ["zorro", "búho", "lince", "nutria", "tejón", "garza", "ciervo"]) await page.locator(".reader .tok", { hasText: w }).click();

  // 7 picked, 6 left: the app says exactly that, and nothing is sent.
  await expect(page.getByRole("button", { name: /Learn 7 words · uses 7 AI words/ })).toBeDisabled();
  await expect(page.getByText(/You selected 7 words, but you have only 6 AI words left this month\. Select 1 fewer/)).toBeVisible();

  // Upgrading has a confirm step that says what you pay and how to cancel.
  await page.getByRole("button", { name: /Pro · \$48 \/ year/ }).click();
  await expect(page.getByText(/renews every year.*cancel at any time/)).toBeVisible();
  await page.route("https://checkout.stripe.com/**", (r) => r.fulfill({ body: "<h1>Stripe Checkout</h1>", contentType: "text/html" }));
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("heading", { name: "Stripe Checkout" })).toBeVisible();

  // Stripe confirms the subscription with a signed webhook.
  const user = await (await page.request.get(`/api/dev/user?email=${encodeURIComponent(address)}`)).json();
  const payload = JSON.stringify({
    id: "evt_e2e",
    object: "event",
    type: "customer.subscription.created",
    data: { object: { id: "sub_e2e", object: "subscription", customer: user.stripe_customer, status: "active", items: { object: "list", data: [{ current_period_end: 1893456000 }] } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  const hook = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" } });
  expect(hook.status()).toBe(200);

  // Back from Checkout: the app confirms, and Pro is visible in Settings.
  await page.goto("/?billing=success");
  await expect(page.getByText("Pro is on. Thank you for supporting Perennial.")).toBeVisible();
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Perennial Pro")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage subscription" })).toBeVisible();
});
