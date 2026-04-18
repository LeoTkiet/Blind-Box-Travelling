"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import BlindBoxPanel from "./BlindBoxPanel";
import MapView from "./MapView";
import ChatBox from "./ChatBox";
import { getBlindBoxAI } from "@/lib/groq";
import type { AIGeneratedContent } from "@/types";

export interface UserLocation {
  lat: number;
  lng: number;
  address?: string;
}

export interface LocationResult {
  name: string;
  lat: number;
  lng: number;
  rating: number;
  reviews_count: number;
  category: string;
  address?: string;
  photo_url?: string;
}

export default function AppContent() {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [radius, setRadius] = useState(5);
  const [category, setCategory] = useState("all");
  const [result, setResult] = useState<LocationResult | null>(null);
  const [aiPayload, setAiPayload] = useState<AIGeneratedContent | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relaxLevel, setRelaxLevel] = useState<number>(0);

  // ── Dual-Routing Handler ──
  // query: text from Magic Bar, selectedTags: badges selected
  const handleGenerate = useCallback(async (query: string, selectedTags: string[]) => {
    if (!userLocation) { setError("Vui lòng chọn vị trí trước."); return; }
    setIsGenerating(true);
    setError(null);
    setResult(null);
    setAiPayload(null);
    setRelaxLevel(0);

    try {
      const hasTextQuery = query.trim().length > 0;

      if (hasTextQuery) {
        // ── CASE 1: Smart Search (AI multi-tier) ──
        const res = await fetch("/api/smart-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            selectedTags,
            lat: userLocation.lat,
            lng: userLocation.lng,
            radius,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Không tìm thấy địa điểm.");
        setResult(data.location);
        setRelaxLevel(data.relaxLevel ?? 0);
      } else {
        // ── CASE 2: Classic Blind-Box (fast column filter) ──
        // Use first selectedTag as category, fallback to current category state
        const effectiveCategory = selectedTags.length > 0 ? selectedTags[0] : category;
        const res = await fetch("/api/blind-box", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: userLocation.lat,
            lng: userLocation.lng,
            radius,
            category: effectiveCategory,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Không tìm thấy địa điểm.");
        setResult(data.location);
        setRelaxLevel(0);
      }

      // Sau khi có địa điểm, gọi AI Server Action (cho cả 2 luồng)
      // Lấy result mới nhất từ state setter callback
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra.");
    } finally {
      setIsGenerating(false);
    }
  }, [userLocation, radius, category]);

  // Gọi AI content khi result thay đổi
  const prevResultRef = useRef<LocationResult | null>(null);
  useEffect(() => {
    if (!result || result === prevResultRef.current) return;
    prevResultRef.current = result;
    (async () => {
      try {
        const aiRes = await getBlindBoxAI({
          id: "",
          name: result.name,
          category: result.category,
          lat: result.lat,
          lng: result.lng,
          rating: result.rating,
          reviews_count: result.reviews_count,
          tags: [result.category],
        });
        setAiPayload(aiRes);
      } catch {
        console.warn("AI content generation failed");
      }
    })();
  }, [result]);

  return (
    <div className="flex flex-col md:flex-row flex-1 w-full overflow-hidden relative bg-[#f1f5f9]">
      <BlindBoxPanel
        userLocation={userLocation} setUserLocation={setUserLocation}
        radius={radius} setRadius={setRadius}
        category={category} setCategory={setCategory}
        onGenerate={handleGenerate}
        result={result} isGenerating={isGenerating} error={error}
        relaxLevel={relaxLevel}
      />
      {/* MapView container */}
      <div className="absolute inset-0 md:relative md:flex-1 md:order-2 z-0">
        <MapView userLocation={userLocation} radius={radius} result={result} />
      </div>

      {/* onLocationUpdate syncs ChatBox's geolocation button back to AppContent state,
          so BlindBoxPanel and MapView automatically reflect the new position too. */}
      <ChatBox
        userLocation={userLocation}
        result={result}
        aiPayload={aiPayload}
        onLocationUpdate={setUserLocation}
      />
    </div>
  );
}