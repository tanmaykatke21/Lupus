import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lupus · Campus Transit",
    short_name: "Lupus",
    description: "Fastest walk + bus routes around Stony Brook, with LIRR connections.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#007aff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
