// The service worker (vite-plugin-pwa builds /sw.js) is what makes the app open offline.
// Registered here, not by the plugin's generated script, so a refusal is handled: an
// in-app browser or an extension can refuse it, and then the app works online only.

type Registrar = Pick<ServiceWorkerContainer, "register">;

export function registerServiceWorker(sw: Registrar | undefined = navigator.serviceWorker): Promise<void> {
  if (!sw) return Promise.resolve(); // no service workers here (e.g. not a secure context)
  return sw.register("/sw.js", { scope: "/" }).then(
    () => undefined,
    (e: unknown) => console.warn("[sw] not registered, so the app works online only:", e),
  );
}
