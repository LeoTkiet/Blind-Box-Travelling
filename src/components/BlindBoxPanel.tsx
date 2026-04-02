"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { UserLocation, LocationResult } from "./AppContent";

const CATEGORIES = [
  { value: "all", label: "Tất cả" },
  { value: "restaurant", label: "Nhà hàng" },
  { value: "cafe", label: "Quán cà phê" },
  { value: "market", label: "Chợ" },
  { value: "hotel", label: "Khách sạn" },
  { value: "motel", label: "Nhà nghỉ" },
  { value: "museum", label: "Bảo tàng" },
  { value: "ruins", label: "Di tích" },
  { value: "memorial", label: "Đài tưởng niệm" },
  { value: "attraction", label: "Điểm tham quan" },
];

interface Suggestion { id: string; place_name: string; center: [number, number]; }

interface Props {
  userLocation: UserLocation | null;
  setUserLocation: (loc: UserLocation | null) => void;
  radius: number; setRadius: (r: number) => void;
  category: string; setCategory: (c: string) => void;
  onGenerate: () => void;
  result: LocationResult | null;
  isGenerating: boolean;
  error: string | null;
}

const sectionLabel: React.CSSProperties = {
  margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 600,
  color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em",
};

export default function BlindBoxPanel({
  userLocation, setUserLocation,
  radius, setRadius, category, setCategory,
  onGenerate, result, isGenerating, error,
}: Props) {
  const [mode, setMode] = useState<"gps" | "address">("gps");
  const [addressInput, setAddressInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Đồng bộ hóa tính năng lấy vị trí của GPS và ChatBox
  useEffect(() => {
    if (userLocation && gpsStatus === "idle") {
      setGpsStatus("done");
      setMode("gps");
    }
    if (!userLocation) {
      setGpsStatus("idle");
    }
  }, [userLocation]);

  const handleGPS = useCallback(() => {
    setGpsStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsStatus("done"); },
      () => setGpsStatus("error")
    );
  }, [setUserLocation]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=vn&language=vi&access_token=${token}`);
    const data = await res.json();
    setSuggestions(data.features || []);
  }, []);

  const handleAddressChange = (v: string) => {
    setAddressInput(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchSuggestions(v), 400);
  };

  const selectSuggestion = (s: Suggestion) => {
    setUserLocation({ lat: s.center[1], lng: s.center[0], address: s.place_name });
    setAddressInput(s.place_name);
    setSuggestions([]);
  };

  return (
    <aside style={{
      width: "340px", flexShrink: 0, borderRight: "1px solid #e5e7eb",
      background: "#fff", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1.25rem", fontSize: "1rem", fontWeight: 700, color: "#111827", letterSpacing: "-0.02em" }}>
          🎲 Du lịch hộp mù
        </h2>

        {/* ── VỊ TRÍ ── */}
        <section style={{ marginBottom: "1.25rem" }}>
          <p style={sectionLabel}>Vị trí của bạn</p>
          <div style={{ display: "flex", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", marginBottom: "0.75rem" }}>
            {(["gps", "address"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setUserLocation(null); setGpsStatus("idle"); setSuggestions([]); setAddressInput(""); }}
                style={{
                  flex: 1, padding: "0.5rem", border: "none", cursor: "pointer",
                  fontSize: "0.8125rem", fontWeight: 500,
                  background: mode === m ? "#111827" : "#fff",
                  color: mode === m ? "#fff" : "#6b7280", transition: "all 0.15s",
                }}>
                {m === "gps" ? "📍 GPS" : "🔍 Địa chỉ"}
              </button>
            ))}
          </div>

          {mode === "gps" ? (
            <div>
              <button onClick={handleGPS} disabled={gpsStatus === "loading"}
                style={{
                  width: "100%", padding: "0.625rem", borderRadius: "8px",
                  border: "1px solid #e5e7eb", background: "#fff",
                  fontSize: "0.875rem", fontWeight: 500, cursor: "pointer",
                  color: gpsStatus === "done" ? "#16a34a" : "#374151",
                }}>
                {gpsStatus === "idle" && "Lấy vị trí hiện tại"}
                {gpsStatus === "loading" && "Đang lấy vị trí..."}
                {gpsStatus === "done" && "✓ Đã lấy vị trí"}
                {gpsStatus === "error" && "⚠ Không thể lấy vị trí. Thử lại?"}
              </button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                value={addressInput} onChange={(e) => handleAddressChange(e.target.value)}
                placeholder="Nhập địa chỉ của bạn..."
                style={{
                  width: "100%", boxSizing: "border-box", padding: "0.625rem 0.75rem",
                  borderRadius: "8px", border: "1px solid #e5e7eb",
                  fontSize: "0.875rem", outline: "none", color: "#111827",
                }}
              />
              {suggestions.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                  background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 20, overflow: "hidden",
                }}>
                  {suggestions.map((s) => (
                    <button key={s.id} onClick={() => selectSuggestion(s)}
                      style={{
                        display: "block", width: "100%", padding: "0.625rem 0.875rem",
                        background: "none", border: "none", textAlign: "left",
                        fontSize: "0.8125rem", color: "#374151", cursor: "pointer",
                        borderBottom: "1px solid #f3f4f6",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      {s.place_name}
                    </button>
                  ))}
                </div>
              )}
              {userLocation && (
                <p style={{ margin: "0.375rem 0 0", fontSize: "0.75rem", color: "#16a34a" }}>✓ Đã chọn địa điểm</p>
              )}
            </div>
          )}
        </section>

        {/* ── CATEGORY ── */}
        <section style={{ marginBottom: "1.25rem" }}>
          <p style={sectionLabel}>Loại địa điểm</p>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            style={{
              width: "100%", padding: "0.625rem 0.75rem", borderRadius: "8px",
              border: "1px solid #e5e7eb", fontSize: "0.875rem", color: "#111827",
              background: "#fff", cursor: "pointer", outline: "none",
            }}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </section>

        {/* ── DISTANCE ── */}
        <section style={{ marginBottom: "1.5rem" }}>
          <p style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
            <span>Khoảng cách</span>
            <span style={{ fontWeight: 700, color: "#111827" }}>{radius} km</span>
          </p>
          <input type="range" min={1} max={25} step={1} value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#111827", cursor: "pointer" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>
            <span>1 km</span><span>25 km</span>
          </div>
        </section>

        {/* ── GENERATE ── */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: "8px", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}
        <button onClick={onGenerate} disabled={isGenerating || !userLocation}
          style={{
            width: "100%", padding: "0.75rem", borderRadius: "10px",
            border: "none", background: isGenerating || !userLocation ? "#e5e7eb" : "#111827",
            color: isGenerating || !userLocation ? "#9ca3af" : "#fff",
            fontSize: "0.9375rem", fontWeight: 600, cursor: !userLocation || isGenerating ? "not-allowed" : "pointer",
            transition: "all 0.15s", letterSpacing: "-0.01em",
          }}>
          {isGenerating ? "Đang tìm kiếm..." : "🎲 Tạo hộp mù"}
        </button>

        {/* ── RESULT ── */}
        {result && (
          <div style={{ marginTop: "1.25rem", border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden" }}>
            {result.photo_url && (
              <img src={result.photo_url} alt={result.name}
                style={{ width: "100%", height: "140px", objectFit: "cover", display: "block" }} />
            )}
            <div style={{ padding: "0.875rem" }}>
              <p style={{ margin: "0 0 0.25rem", fontSize: "0.9375rem", fontWeight: 700, color: "#111827" }}>{result.name}</p>
              <p style={{ margin: "0 0 0.375rem", fontSize: "0.8125rem", color: "#6b7280" }}>{result.address || "Hồ Chí Minh, Việt Nam"}</p>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.8125rem" }}>
                <span>⭐ {result.rating?.toFixed(1)}</span>
                <span style={{ color: "#9ca3af" }}>·</span>
                <span style={{ color: "#6b7280" }}>{result.reviews_count} đánh giá</span>
                <span style={{ color: "#9ca3af" }}>·</span>
                <span style={{ color: "#6b7280", textTransform: "capitalize" }}>{result.category}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}