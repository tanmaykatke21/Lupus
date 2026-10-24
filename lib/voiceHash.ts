// Deterministic key for a spoken clip. Web Crypto works in both the browser and Node.
export async function voiceHash(text: string, lang: string, version: string) {
  const bytes = new TextEncoder().encode(`${version}|${lang}|${text}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
