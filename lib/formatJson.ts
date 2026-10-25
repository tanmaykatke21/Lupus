/** JSON with arrays of plain values (coordinates, hour pairs, aliases) kept on one line. */
export function formatJson(value: unknown, indent: number) {
  return JSON.stringify(value, null, indent).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${inner.replace(/\s*\n\s*/g, " ")}]`) + "\n";
}
