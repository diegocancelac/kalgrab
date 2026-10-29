// Traces for development builds only (`pnpm dev`, `pnpm build:dev`), in the console of the
// context that calls them. In a production build trace() is empty and the bundler drops the
// calls, so details are passed as a function: nothing is computed there. Never trace a ks, a
// URL or a page value that could hold either.

export function trace(step: string, details?: () => unknown): void {
  if (import.meta.env.MODE !== 'development') return;
  if (details) console.log(`[kalgrab] ${step}`, details());
  else console.log(`[kalgrab] ${step}`);
}

/** An error message from Chrome or the network with any URL in it cut out. */
export function withoutUrls(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, '<url>');
}
