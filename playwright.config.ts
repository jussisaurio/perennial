// Playwright runs in web/, where its config, servers and pinned version are. From the repo root,
// `bunx` quietly fetched the newest Playwright, which then said "Project desktop not found" (#656).
// This file makes that mistake fail at once, with the fix.
throw new Error("Run Playwright in web/, not at the repo root: cd web && bunx playwright test e2e/<spec>.ts");
