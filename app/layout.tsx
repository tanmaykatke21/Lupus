import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

// Rubik (SIL Open Font License, see app/fonts/RUBIK-OFL.txt), self-hosted so builds need no network.
const rubik = localFont({
  src: "./fonts/rubik-latin-wght.woff2",
  variable: "--font-rubik",
  weight: "300 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lupus",
  description: "Live Stony Brook buses, with the stop and time that get you there.",
  appleWebApp: { capable: true, title: "Lupus", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#262840",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${rubik.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
