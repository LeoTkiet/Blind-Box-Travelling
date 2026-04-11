"use client";

import { useState, useCallback } from "react";
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

  const handleGenerate = useCallback(async () => {
    if (!userLocation) { setError("Vui lòng chọn vị trí trước."); return; }
    setIsGenerating(true);
    setError(null);
    setResult(null);
    setAiPayload(null);
    try {
      const res = await fetch("/api/blind-box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: userLocation.lat, lng: userLocation.lng, radius, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không tìm thấy địa điểm.");
      setResult(data.location);

      // Sau khi có địa điểm, gọi AI Server Action
      const aiRes = await getBlindBoxAI(data.location);
      setAiPayload(aiRes);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra.");
    } finally {
      setIsGenerating(false);
    }
  }, [userLocation, radius, category]);

  return (
    <div className="flex flex-col md:flex-row flex-1 w-full overflow-hidden relative bg-[#f1f5f9]">
      <BlindBoxPanel
        userLocation={userLocation} setUserLocation={setUserLocation}
        radius={radius} setRadius={setRadius}
        category={category} setCategory={setCategory}
        onGenerate={handleGenerate}
        result={result} isGenerating={isGenerating} error={error}
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