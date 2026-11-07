// Demo data: an anonymous learner whose garden has a realistic 90-day review
// history over the deck (plan.ts), so the garden, progress and sessions can be
// tried without weeks of practice. The server makes the history and writes it,
// in one request (#784). In production builds too, behind ?demo (#751): it
// never writes into a real account.

import { Effect, Schema } from "effect";
import type { DemoIn } from "perennial-contract";
import { currentUser, ensureUser, markDemoUser, signOut } from "../data/auth";
import { keepCourse } from "../data/device";
import { request } from "../data/http";

/** A fresh anonymous learner of `size`. The app opens on this course. */
export async function seedDemo(lang: DemoIn["lang"], size: DemoIn["size"]): Promise<void> {
  const before = await currentUser();
  await signOut();
  // signOut only warns when it fails: then this is still the old user, maybe a real account.
  const user = await ensureUser();
  if (user.id === before?.id) throw new Error("sign-out failed, so the demo would write into the learner who is signed in");
  // Before any write: a sign-in from the demo deletes it, so its reviews never join a real account (data/auth.ts).
  markDemoUser(user.id);
  keepCourse(lang);
  const ask = request(Schema.Struct({ ok: Schema.Literal(true) }), "/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang, size, now: Date.now() } satisfies DemoIn) });
  await Effect.runPromise(ask).catch((e: unknown) => {
    // "ApiError: bad_request", "HttpError: http_502", …
    throw new Error(`demo seed failed: ${String(e)}`);
  });
}

/** Throw the demo learner away. Only an anonymous one: a real account is never deleted here. */
export async function removeDemo(): Promise<void> {
  // Only a learner known to be anonymous: no session, or a failed session check, deletes nothing.
  if (!(await currentUser())?.anonymous) return console.warn("[demo] not signed in as a demo learner: nothing deleted");
  // If the delete fails, say so and sign out anyway: this device forgets the learner,
  // and the server's housekeeping deletes old anonymous users.
  const res = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch((e: unknown) => e);
  if (!(res instanceof Response) || !res.ok) console.warn("[demo] could not delete the demo learner on the server:", res instanceof Response ? res.status : res);
  await signOut();
}
