import { afterEach, expect, mock, test } from "bun:test";

const reports: unknown[] = [];
mock.module("../observability", () => ({
  reportBadAnswer: (path: string) => reports.push(path),
  reportError: (e: unknown) => reports.push(e),
}));
const { getMe } = await import("./ai");
const { HttpError } = await import("./http");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  reports.length = 0;
});

test("a failed account fetch is reported with its status, so missing credits are not a silent fault", async () => {
  globalThis.fetch = (async () => new Response("<h1>Bad gateway</h1>", { status: 502 })) as unknown as typeof fetch;
  await getMe().then(
    () => expect.unreachable("it should fail"),
    () => {},
  );
  expect(reports).toHaveLength(1);
  expect(reports[0]).toBeInstanceOf(HttpError);
  expect((reports[0] as InstanceType<typeof HttpError>).message).toBe("http_502");
});

test("offline is not reported", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  await getMe().then(
    () => expect.unreachable("it should fail"),
    () => {},
  );
  expect(reports).toEqual([]);
});
