import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lupus · Campus Transit",
    short_name: "Lupus",
    description: "Fastest walk + bus routes around Stony Brook, with LIRR connections.",
    start_url: "/",
    display: "standalone",
    background_color: "#14110e",
    theme_color: "#a8781f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
