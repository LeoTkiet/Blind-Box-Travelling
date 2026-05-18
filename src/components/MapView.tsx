"use client";

import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import type { UserLocation, LocationResult } from "./AppContent";
import "mapbox-gl/dist/mapbox-gl.css";

interface Props {
  userLocation: UserLocation | null;
  radius: number;
  result: LocationResult | null;
  groupMembers?: any[]; 
}

const DEFAULT_CENTER: [number, number] = [106.6297, 10.8231];

export default function MapView({ userLocation, radius, result, groupMembers = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const resultMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const memberMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  // 1. Khởi tạo mảng bản đồ MapBox
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current || mapRef.current) return;

    const init = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      const container = containerRef.current;
      if (!container) return;

      container.replaceChildren();
      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

      const map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/streets-v12",
        center: DEFAULT_CENTER,
        zoom: 12,
      });

      map.addControl(new mapboxgl.NavigationControl(), "top-right");
      mapRef.current = map;

      map.on("load", () => {
        setMapReady(true);
      });
    };

    init();

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    let rafId: number;
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (mapRef.current) mapRef.current.resize();
      });
    });
    observer.observe(containerRef.current);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  // 2. Vẽ marker vị trí User và hình tròn bán kính
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !userLocation) return;

    const applyMarker = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;

      userMarkerRef.current?.remove();
      const el = document.createElement("div");
      el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#111827;border:3px solid #fff;box-shadow:0 0 0 2px #111827;";
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map);

      map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 13, duration: 1000 });

      const circleGeoJson = createCircle(userLocation.lng, userLocation.lat, radius);
      if (map.getSource("radius-source")) {
        (map.getSource("radius-source") as mapboxgl.GeoJSONSource).setData(circleGeoJson);
      } else {
        map.addSource("radius-source", { type: "geojson", data: circleGeoJson });
        map.addLayer({ id: "radius-fill", type: "fill", source: "radius-source", paint: { "fill-color": "#111827", "fill-opacity": 0.05 } });
        map.addLayer({ id: "radius-line", type: "line", source: "radius-source", paint: { "line-color": "#111827", "line-width": 1.5, "line-dasharray": [4, 3] } });
      }
    };

    applyMarker();
  }, [mapReady, userLocation, radius]);

  // 3. Vẽ marker Kết quả (Blind Box)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !result) return;

    const applyResult = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;

      resultMarkerRef.current?.remove();
      const el = document.createElement("div");
      el.style.cssText = "width:24px;height:24px;border-radius:50%;background:#111827;border:4px solid #fff;box-shadow:0 8px 16px rgba(0,0,0,0.25); cursor: default; transition: transform 0.2s;"; 

      const popup = new mapboxgl.Popup({ offset: 20, closeButton: false }).setHTML(
        `<div style="font-family: ui-sans-serif, system-ui, sans-serif; min-width: 180px; padding: 4px;">
          <p style="margin: 0 0 6px; font-weight: 800; font-size: 15px; color: #0f172a; line-height: 1.2;">${result.name}</p>
          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #64748b;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#111827" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span style="color: #111827">${result.rating?.toFixed(1)}</span>
            <span style="color: #cbd5e1">|</span>
            <span style="text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px">${result.category}</span>
          </div>
        </div>`
      );

      popupRef.current = popup;
      resultMarkerRef.current = new mapboxgl.Marker({ 
        element: el,
        draggable: false 
      })
        .setLngLat([result.lng, result.lat])
        .addTo(map);

      map.flyTo({ center: [result.lng, result.lat], zoom: 15, duration: 1200 });
    };

    applyResult();
  }, [mapReady, result]);

  // 4. Vẽ đường đi tự động (Module 7)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !userLocation?.lng || !result?.lng) return;

    const drawRoute = async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const query = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${userLocation.lng},${userLocation.lat};${result.lng},${result.lat}?geometries=geojson&overview=full&exclude=motorway&access_token=${token}`
        );
        const data = await query.json();
        if (!data.routes?.length) return;

        const routeData = data.routes[0].geometry;
        const distanceKm = (data.routes[0].distance / 1000).toFixed(1);
        const durationMin = Math.round(data.routes[0].duration / 60);

        if (map.getSource("route-source")) {
          (map.getSource("route-source") as mapboxgl.GeoJSONSource).setData(routeData);
        } else {
          map.addSource("route-source", { type: "geojson", data: routeData });
          map.addLayer({
            id: "route-layer", type: "line", source: "route-source",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#3b82f6", "line-width": 6, "line-opacity": 0.85 }
          });
        }

        const midCoords = routeData.coordinates[Math.floor(routeData.coordinates.length / 2)];
        const oldPopups = document.getElementsByClassName('route-info-popup');
        while (oldPopups[0]) oldPopups[0].remove();

        const mapboxgl = (await import("mapbox-gl")).default;
        new mapboxgl.Popup({ closeButton: false, className: 'route-info-popup', offset: [0, -10] })
          .setLngLat(midCoords as [number, number])
          .setHTML(`
            <style>
              .route-info-popup .mapboxgl-popup-content {
                background: none !important;
                box-shadow: none !important;
                padding: 0 !important;
                border: none !important;
              }
              .route-info-popup .mapboxgl-popup-tip {
                display: none !important;
              }
            </style>
            <div style="background: white; color: #0f172a; padding: 8px 16px; border-radius: 30px; font-family: ui-sans-serif, system-ui, sans-serif; font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px rgba(0,0,0,0.15);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              <span>${distanceKm} km · ${durationMin} phút</span>
            </div>
          `).addTo(map);

        const bounds = routeData.coordinates.reduce((b: any, c: any) => [
          [Math.min(b[0][0], c[0]), Math.min(b[0][1], c[1])],
          [Math.max(b[1][0], c[0]), Math.max(b[1][1], c[1])]
        ], [[routeData.coordinates[0][0], routeData.coordinates[0][1]], [routeData.coordinates[0][0], routeData.coordinates[0][1]]]);

        map.fitBounds(bounds, { padding: 80, duration: 1500 });
      } catch (e) { console.error("Lỗi vẽ đường:", e); }
    };

    drawRoute();
  }, [mapReady, userLocation, result]);

  // 5. Ẩn/hiện tên địa điểm theo vị trí thực tế
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !userMarkerRef.current) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const uLat = pos.coords.latitude;
        const uLng = pos.coords.longitude;
        const newPos: [number, number] = [uLng, uLat];
        
        userMarkerRef.current?.setLngLat(newPos);
        map.easeTo({ center: newPos, duration: 1000 });

        if (result && popupRef.current) {
          const dist = getDistanceKm(uLat, uLng, result.lat, result.lng);
          
          if (dist <= 0.2) {
            if (!popupRef.current.isOpen()) {
              popupRef.current.setLngLat([result.lng, result.lat]).addTo(map);
            }
          } else {
            if (popupRef.current.isOpen()) {
              popupRef.current.remove();
            }
          }
        }
      },
      (err) => console.error("Lỗi GPS:", err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [mapReady, result]);

  // 6. Ẩn/hiện địa điểm giả lập
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !userLocation || !result || !popupRef.current) return;

    const dist = getDistanceKm(userLocation.lat, userLocation.lng, result.lat, result.lng);
    if (dist <= 0.2) {
      if (!popupRef.current.isOpen()) popupRef.current.setLngLat([result.lng, result.lat]).addTo(map);
    } else {
      if (popupRef.current.isOpen()) popupRef.current.remove();
    }
  }, [userLocation, result, mapReady]);

  // 7. MỚI: VẼ ĐỊA ĐIỂM CỦA BẠN BÈ LÊN BẢN ĐỒ
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !groupMembers) return;

    const mapboxgl = require("mapbox-gl");
    const currentMemberIds = new Set(groupMembers.map(m => m.user_id));

    // Xóa bạn bè offline
    memberMarkersRef.current.forEach((marker, id) => {
      if (!currentMemberIds.has(id)) {
        marker.remove();
        memberMarkersRef.current.delete(id);
      }
    });

    // Vẽ bạn bè online
    groupMembers.forEach((member) => {
      if (!member.lat || !member.lng) return;

      if (memberMarkersRef.current.has(member.user_id)) {
        memberMarkersRef.current.get(member.user_id)?.setLngLat([member.lng, member.lat]);
      } else {
        const el = document.createElement("div");
        // Style chấm tròn xám nhám Editorial
        el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#475569;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.25); position:relative;";
        
        const textLabel = document.createElement("span");
        textLabel.innerText = `Thành viên ${member.user_id.substring(0,4)}`;
        textLabel.style.cssText = "position:absolute;top:-24px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:800;color:#0f172a;background:white;padding:3px 8px;border-radius:8px;border:1px solid #e2e8f0;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.1);";
        el.appendChild(textLabel);

        const newMarker = new mapboxgl.Marker({ element: el })
          .setLngLat([member.lng, member.lat])
          .addTo(map);

        memberMarkersRef.current.set(member.user_id, newMarker);
      }
    });
  }, [mapReady, groupMembers]);

  return (
    <div className="w-full h-full relative z-0">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

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

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}