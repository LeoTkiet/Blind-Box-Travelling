"use client";

import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import type { UserLocation, LocationResult } from "./AppContent";

interface Props {
  userLocation: UserLocation | null;
  radius: number;
  result: LocationResult | null;
}

// HCM City default center
const DEFAULT_CENTER: [number, number] = [106.6297, 10.8231];

export default function MapView({ userLocation, radius, result }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const resultMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Initialize map
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current || mapRef.current) return;

    const init = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css" as never);

      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

      mapRef.current = new mapboxgl.Map({
        container: containerRef.current!,
        style: "mapbox://styles/mapbox/streets-v12",
        center: DEFAULT_CENTER,
        zoom: 12,
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    };

    init();

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Update user location marker + radius circle
  useEffect(() => {
    if (!mapRef.current || !userLocation) return;
    const map = mapRef.current;

    const applyMarker = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;

      // User marker
      userMarkerRef.current?.remove();
      const el = document.createElement("div");
      el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#111827;border:3px solid #fff;box-shadow:0 0 0 2px #111827;";
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map);

      // Fly to user
      map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 13, duration: 1000 });

      // Radius circle (GeoJSON)
      const circleGeoJson = createCircle(userLocation.lng, userLocation.lat, radius);
      if (map.getSource("radius-source")) {
        (map.getSource("radius-source") as mapboxgl.GeoJSONSource).setData(circleGeoJson);
      } else {
        map.addSource("radius-source", { type: "geojson", data: circleGeoJson });
        map.addLayer({ id: "radius-fill", type: "fill", source: "radius-source", paint: { "fill-color": "#111827", "fill-opacity": 0.05 } });
        map.addLayer({ id: "radius-line", type: "line", source: "radius-source", paint: { "line-color": "#111827", "line-width": 1.5, "line-dasharray": [4, 3] } });
      }
    };

    if (map.isStyleLoaded()) {
      applyMarker();
    } else {
      map.once("load", applyMarker);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation, radius]);


  // Update result marker
  useEffect(() => {
    if (!mapRef.current || !result) return;
    const map = mapRef.current;

    const applyResult = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;

      resultMarkerRef.current?.remove();
      const el = document.createElement("div");
      el.style.cssText = "width:28px;height:28px;border-radius:50%;background:#fff;border:2.5px solid #111827;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.2);cursor:pointer;";
      el.textContent = "📍";

      const popup = new mapboxgl.Popup({ offset: 18, closeButton: false }).setHTML(
        `<div style="font-family:system-ui;min-width:160px">
          <p style="margin:0 0 4px;font-weight:700;font-size:14px;color:#111827">${result.name}</p>
          <p style="margin:0;font-size:12px;color:#6b7280">⭐ ${result.rating?.toFixed(1)} · ${result.category}</p>
        </div>`
      );

      resultMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([result.lng, result.lat])
        .setPopup(popup)
        .addTo(map);

      resultMarkerRef.current.togglePopup();
      map.flyTo({ center: [result.lng, result.lat], zoom: 15, duration: 1200 });
    };

    if (map.isStyleLoaded()) applyResult(); else map.once("load", applyResult);
  }, [result]);

  return (
    <div style={{ flex: 1, position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

/** Generate a GeoJSON circle polygon from center + radius (km) */
function createCircle(lng: number, lat: number, radiusKm: number): GeoJSON.Feature {
  const points = 64;
  const coords: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * (2 * Math.PI);
    const dx = radiusKm / 111.32;
    const dy = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    coords.push([lng + dy * Math.cos(angle), lat + dx * Math.sin(angle)]);
  }
  coords.push(coords[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}
