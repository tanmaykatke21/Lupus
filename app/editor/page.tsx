import type { Metadata } from "next";
import MapEditor from "@/components/MapEditor";

export const metadata: Metadata = { title: "Lupus · Campus editor", robots: { index: false } };

// Dev tool: run `npm run dev` and open /editor. Saving is refused on deployed builds.
export default function EditorPage() {
  return <MapEditor />;
}
