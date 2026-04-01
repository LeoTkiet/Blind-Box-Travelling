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
// 3. Vẽ đường đi (Module 7)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation?.lng || !result?.lng) return;

    const drawRoute = async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const query = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${userLocation.lng},${userLocation.lat};${result.lng},${result.lat}?geometries=geojson&overview=full&access_token=${token}`
        );
        const data = await query.json();
        if (!data.routes?.length) return;

        const routeData = data.routes[0].geometry;
        const distanceKm = (data.routes[0].distance / 1000).toFixed(1);
        const durationMin = Math.round(data.routes[0].duration / 60);

        // Update hoặc tạo mới Source đường đi
        if (map.getSource("route-source")) {
          (map.getSource("route-source") as any).setData(routeData);
        } else {
          map.addSource("route-source", { type: "geojson", data: routeData });
          map.addLayer({
            id: "route-layer", type: "line", source: "route-source",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#3b82f6", "line-width": 6, "line-opacity": 0.8 }
          });
        }

        // Cập nhật Popup thông tin
        const midCoords = routeData.coordinates[Math.floor(routeData.coordinates.length / 2)];
        const oldPopups = document.getElementsByClassName('route-info-popup');
        while(oldPopups[0]) oldPopups[0].remove();

        const mapboxgl = (await import("mapbox-gl")).default;
        new mapboxgl.Popup({ closeButton: false, className: 'route-info-popup', offset: [0, -10] })
          .setLngLat(midCoords as [number, number])
          .setHTML(`
            <div style="background: white; color: black; padding: 6px 12px; border-radius: 24px; font-weight: bold; display: flex; align-items: center; gap: 8px; border: 2px solid #111827; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
              <span style="font-size: 18px;">🛵</span>
              <span>${distanceKm} km (${durationMin} phút)</span>
            </div>
          `).addTo(map);


        const bounds = routeData.coordinates.reduce((b: any, c: any) => [
          [Math.min(b[0][0], c[0]), Math.min(b[0][1], c[1])],
          [Math.max(b[1][0], c[0]), Math.max(b[1][1], c[1])]
        ], [[routeData.coordinates[0][0], routeData.coordinates[0][1]], [routeData.coordinates[0][0], routeData.coordinates[0][1]]]);
        
        map.fitBounds(bounds, { padding: 80, duration: 1500 });
      } catch (e) { console.error("Lỗi vẽ đường:", e); }
    };

    if (map.isStyleLoaded()) drawRoute(); else map.once("idle", drawRoute);
  }, [userLocation, result]); 
  // kết thúc 
  
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
