// Perennial on Railway, as code (`railway config plan` / `railway config apply`).
// Replaces railway.json / railway.housekeeping.json (Config as Code is
// deprecated). Variables are unmanaged: secrets live only in Railway, never
// in this file. See docs/DEPLOY.md.

import { defineRailway, github, image, project, service, volume } from "railway/iac";

const REGION = "europe-west4-drams3a";

export default defineRailway(() => {
  // Deploys from main only after CI is green (checkSuites).
  const repo = github("jussisaurio/perennial", { branch: "main", checkSuites: true });

  // The web app and API. Migrations run before each deploy; /health checks the database too.
  const web = service("perennial", {
    source: repo,
    replicas: { [REGION]: 1 },
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: {
      preDeployCommand: ["bun src/migrate.ts"],
      healthcheckPath: "/health",
      healthcheckTimeout: 60,
      // Restarts on failure (Railway's default policy), at most 5 times.
      restartPolicyMaxRetries: 5,
    },
  });

  // Sync. Private network only (no public domain); shapes persist on the volume.
  const electricVolume = volume("electric-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: REGION, sizeMB: 5000 });
  const electric = service("electric", {
    source: image("electricsql/electric:1.8.1"),
    replicas: { [REGION]: 1 },
    volumeMounts: { "/var/lib/electric": electricVolume },
    deploy: { healthcheckPath: "/v1/health", restartPolicyMaxRetries: 5 },
  });

  // Daily cleanup (stale anonymous learners, old logs), then exits.
  const housekeeping = service("housekeeping", {
    source: repo,
    replicas: { [REGION]: 1 },
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { startCommand: "bun --preload ./instrument.ts src/housekeeping.ts", cronSchedule: "17 3 * * *", restartPolicyType: "NEVER" },
  });

  return project("bountiful-friendship", {
    variables: { managed: false },
    resources: [web, electric, housekeeping, electricVolume],
  });
});
