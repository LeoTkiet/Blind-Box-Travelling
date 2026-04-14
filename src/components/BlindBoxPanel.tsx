"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { UserLocation, LocationResult } from "./AppContent";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin", "vietnamese"], display: "swap" });

const CATEGORIES = [
  { value: "all", label: "Tất cả", icon: "🎲" },
  { value: "restaurant", label: "Nhà hàng", icon: "🍽️" },
  { value: "cafe", label: "Cà phê", icon: "☕" },
  { value: "attraction", label: "Tham quan", icon: "📸" },
  { value: "museum", label: "Bảo tàng", icon: "🏛️" },
  { value: "ruins", label: "Di tích", icon: "🏺" },
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
  margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 700,
  color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em",
};

// Helper function to calculate distance for the "Clue"
function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

  // State to manage name visibility (Unlock)
  const [isRevealed, setIsRevealed] = useState(false);

  // DRAG SHEET LOGIC
  const [sheetHeight, setSheetHeight] = useState<number>(30); // 30vh
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const dragStartRef = useRef<{ y: number, h: number } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // DESKTOP RESIZE LOGIC
  const [panelWidth, setPanelWidth] = useState<number>(360);
  const desktopDragRef = useRef<{ x: number, w: number, currentW?: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);

  const onDesktopDragStart = (e: React.MouseEvent) => {
    desktopDragRef.current = { x: e.clientX, w: panelWidth };
    document.addEventListener("mousemove", onDesktopDrag);
    document.addEventListener("mouseup", onDesktopDragEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onDesktopDrag = useCallback((e: MouseEvent) => {
    if (!desktopDragRef.current) return;
    const delta = e.clientX - desktopDragRef.current.x;
    let newW = desktopDragRef.current.w + delta;
    if (newW < 280) newW = 280;
    if (newW > 600) newW = 600;
    
    // Direct DOM manipulation for maximum smoothness without triggering React re-renders constantly
    if (asideRef.current && !isMobile) {
      asideRef.current.style.width = `${newW}px`;
    }
    desktopDragRef.current.currentW = newW;
  }, [isMobile]);

  const onDesktopDragEnd = useCallback(() => {
    if (desktopDragRef.current && desktopDragRef.current.currentW) {
      setPanelWidth(desktopDragRef.current.currentW);
    }
    desktopDragRef.current = null;
    document.removeEventListener("mousemove", onDesktopDrag);
    document.removeEventListener("mouseup", onDesktopDragEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onDesktopDrag]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const onTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isMobile) return;
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { y, h: sheetHeight };
    setIsDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!dragStartRef.current || !isDragging) return;
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = dragStartRef.current.y - y;
    const deltaVh = (deltaY / window.innerHeight) * 100;
    
    let newHeight = dragStartRef.current.h + deltaVh;
    if (newHeight < 15) newHeight = 15;
    if (newHeight > 90) newHeight = 90;
    
    setSheetHeight(newHeight);
  };

  const onTouchEnd = () => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setIsDragging(false);
    // Snap logic
    if (sheetHeight > 55) {
      setSheetHeight(85);
    } else {
      setSheetHeight(30);
    }
  };

  // Close the box when a new result arrives
  useEffect(() => {
    if (result) {
      setIsRevealed(false);
      setSheetHeight(30); // Snap down to let user see the map!
    }
  }, [result]);

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
    <aside 
      ref={asideRef}
      className={`${inter.className} w-full flex-shrink-0 md:border-r border-[#e5e7eb] bg-white flex flex-col overflow-hidden z-10 absolute md:relative bottom-0 left-0 md:bottom-auto md:left-auto rounded-t-3xl md:rounded-none shadow-[0_-8px_30px_rgba(0,0,0,0.12)] md:shadow-none`}
      style={isMobile ? { 
        height: `${sheetHeight}%`, 
        transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' 
      } : { width: `${panelWidth}px` }}
    >
      {!isMobile && (
        <div 
          onMouseDown={onDesktopDragStart}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-gray-300 z-50 transition-colors"
        />
      )}
      {/* Drag Handle for Mobile */}
      <div 
        className="w-full flex justify-center items-center pt-3 pb-2 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none md:hidden bg-white z-20 sticky top-0"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onTouchStart}
        onMouseMove={onTouchMove}
        onMouseUp={onTouchEnd}
        onMouseLeave={onTouchEnd}
      >
        <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
      </div>

      <div 
        className={`flex-1 overflow-y-auto ${isMobile ? "px-5 pt-1 pb-10" : "p-5"}`}
        style={isMobile ? { paddingBottom: "calc(env(safe-area-inset-bottom, 24px) + 24px)" } : undefined}
      >
        <h2 style={{ margin: "0 0 1.25rem", fontSize: "1.2rem", fontWeight: 800, color: "#111827", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>🎲</span> Du lịch hộp mù
        </h2>

        {/* ── LOCATION ── */}
        <section style={{ marginBottom: "1.25rem" }}>
          <p style={sectionLabel}>Vị trí của bạn</p>
          <div style={{ display: "flex", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", marginBottom: "0.75rem" }}>
            {(["gps", "address"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setUserLocation(null); setGpsStatus("idle"); setSuggestions([]); setAddressInput(""); }}
                style={{
                  flex: 1, padding: "0.625rem", border: "none", cursor: "pointer",
                  fontSize: "0.875rem", fontWeight: 600,
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

        {/* ── COLLECTION ── */}
        <section style={{ marginBottom: "1.25rem" }}>
          <p style={sectionLabel}>Chọn Bộ Sưu Tập</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {CATEGORIES.map((item) => (
              <button 
                key={item.value} 
                onClick={() => setCategory(item.value)}
                style={{
                  padding: "12px", 
                  borderRadius: "12px",
                  border: category === item.value ? "2px solid #111827" : "1px solid #e5e7eb",
                  // Đổi màu ô đã chọn thành xám nhạt thay vì tím nhạt
                  background: category === item.value ? "#f3f4f6" : "#fff",
                  cursor: "pointer", 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "8px",
                  transition: "all 0.2s ease"
                }}>
                <span style={{ fontSize: "1.3rem" }}>{item.icon}</span>
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151" }}>{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── DISTANCE ── */}
        <section style={{ marginBottom: "1.5rem" }}>
          <p style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
            <span>Khoảng cách</span>
            <span style={{ fontWeight: 800, color: "#111827" }}>{radius} KM</span>
          </p>
          <input type="range" min={1} max={25} step={1} value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#111827", cursor: "pointer", height: "6px" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#64748b", marginTop: "0.5rem", fontWeight: 500 }}>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{color: "#eab308"}}></span> 1km
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{color: "#ef4444"}}></span> 25km
            </span>
          </div>
        </section>

        {/* ── GENERATE BUTTON ── */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: "8px", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}
        <button onClick={onGenerate} disabled={isGenerating || !userLocation}
          style={{
            width: "100%", padding: "0.875rem", borderRadius: "12px",
            border: "none", 
            // Đổi màu gradient tím thành màu đen tuyền nguyên khối
            background: isGenerating || !userLocation ? "#e2e8f0" : "#111827",
            color: isGenerating || !userLocation ? "#94a3b8" : "#fff",
            fontSize: "1rem", fontWeight: 700, cursor: !userLocation || isGenerating ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
            // Đổi bóng đổ (shadow) thành màu xám/đen
            boxShadow: isGenerating || !userLocation ? "none" : "0 4px 12px rgba(17, 24, 39, 0.25)"
          }}
          onMouseDown={(e) => { if(!isGenerating && userLocation) e.currentTarget.style.transform = "scale(0.97)" }}
          onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          {isGenerating ? "⏳ Đang lắc hộp..." : "🎲 Tạo hộp mù"}
        </button>

        {/* ── RESULT READY (Blind Box) ── */}
        {result && (
          <div style={{ marginTop: "1.5rem" }}>
            {!isRevealed ? (
              // Hidden name state (Clue)
              <div style={{ 
                padding: "1.25rem", textAlign: "center", background: "#f8fafc", 
                border: "1px dashed #cbd5e1", borderRadius: "12px" 
              }}>
                <h3 style={{ margin: "0 0 12px", fontSize: "1.1rem", color: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                  <span>🤫</span> Hộp mù đã sẵn sàng!
                </h3>
                <p style={{ fontSize: "0.875rem", color: "#475569", marginBottom: "1.25rem", lineHeight: "1.6" }}>
                  Gợi ý: Địa điểm này cách bạn khoảng <br/>
                  <strong style={{fontSize: "1rem", color: "#334155"}}>{userLocation ? haversineDist(userLocation.lat, userLocation.lng, result.lat, result.lng).toFixed(1) : "?"} km</strong>. <br/>
                  Nơi đây đã có <strong style={{color: "#334155"}}>{result.reviews_count}</strong> người đến khám phá và được đánh giá <strong style={{color: "#334155"}}>{result.rating}⭐</strong>.
                </p>
                <button onClick={() => setIsRevealed(true)}
                  style={{ 
                    width: "100%", padding: "0.75rem", borderRadius: "8px", 
                    // Nút mở khóa đổi thành xám đậm, rê chuột vào sẽ ra đen
                    background: "#374151", 
                    color: "#fff", border: "none", cursor: "pointer", fontSize: "0.875rem", fontWeight: 700,
                    transition: "background 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#111827"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "#374151"}
                  >
                  🔓 Mở khóa xem tên (Mất vui nhé!)
                </button>
              </div>
            ) : (
              // Unlocked state
              <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden", animation: "fadeIn 0.5s ease" }}>
                {result.photo_url ? (
                  <img src={result.photo_url} alt={result.name}
                    style={{ width: "100%", height: "140px", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: "100%", height: "120px", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3rem" }}>
                    🎁
                  </div>
                )}
                <div style={{ padding: "1rem" }}>
                  <p style={{ margin: "0 0 0.35rem", fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>{result.name}</p>
                  
                  {/* Đã xóa phần || "Chưa rõ địa chỉ cụ thể", chỉ render khi result.address có tồn tại */}
                  {result.address && (
                    <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", color: "#64748b", lineHeight: "1.4" }}>{result.address}</p>
                  )}
                  
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.8125rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, color: "#eab308" }}>⭐ {result.rating?.toFixed(1)}</span>
                    <span style={{ color: "#cbd5e1" }}>|</span>
                    <span style={{ color: "#64748b" }}>{result.reviews_count} đánh giá</span>
                    <span style={{ color: "#cbd5e1" }}>|</span>
                    
                    {/* Đổi màu nền của category tag thành màu xám, chữ đen thay vì màu tím */}
                    <span style={{ color: "#111827", fontWeight: 600, background: "#e5e7eb", padding: "2px 8px", borderRadius: "6px" }}>
                      {CATEGORIES.find(c => c.value === result.category)?.label || result.category}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}