// Small browser file helper: the data export uses it.

/** Saves a file through the browser's download. */
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  // Not at once: some browsers cancel a download whose URL is revoked during the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
