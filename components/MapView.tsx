"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { MapProps } from "@/lib/mapShared";

const GoogleMapView = dynamic(() => import("./GoogleMapView"), { ssr: false });
const MapLibreView = dynamic(() => import("./MapLibreView"), { ssr: false });

const HAS_GOOGLE_KEY = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// Google Maps when a key is configured; the free MapLibre map if there's no key or Google fails
// (bad key, billing, quota, blocked network), so the demo never shows a blank map.
export default function MapView(props: MapProps) {
  const [googleFailed, setGoogleFailed] = useState(false);
  if (HAS_GOOGLE_KEY && !googleFailed) {
    return <GoogleMapView {...props} onError={() => setGoogleFailed(true)} />;
  }
  return <MapLibreView {...props} />;
}
