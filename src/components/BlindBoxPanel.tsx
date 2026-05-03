"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { UserLocation, LocationResult } from "./AppContent";
import { Inter } from "next/font/google";
import GroupRoom from "./GroupTravel";

import { 
  LayoutGrid, Utensils, Coffee, Beer, Croissant, Building2, Tent, Home, 
  Camera, Landmark, Castle, Trees, Store, ShoppingBag, Gift, 
  Gamepad2, Sparkles, Dumbbell, FerrisWheel, Umbrella, Mountain, 
  Leaf, Train, Calendar 
} from "lucide-react";

const inter = Inter({ subsets: ["latin", "vietnamese"], display: "swap" });

const CATEGORIES = [
  { value: "all", label: "Tất cả", Icon: LayoutGrid },
  { value: "restaurant", label: "Nhà hàng", Icon: Utensils },
  { value: "cafe", label: "Cà phê", Icon: Coffee },
  { value: "bakery", label: "Tiệm bánh", Icon: Croissant },
  { value: "hotel", label: "Khách sạn", Icon: Building2 },
  { value: "homestay", label: "Homestay", Icon: Home },
  { value: "attraction", label: "Tham quan", Icon: Camera },
  { value: "museum", label: "Bảo tàng", Icon: Landmark },
  { value: "pagoda/temple", label: "Chùa & Đền", Icon: Castle },
  { value: "park", label: "Công viên", Icon: Trees },
  { value: "market", label: "Chợ", Icon: Store },
  { value: "shopping_mall", label: "TTTM", Icon: ShoppingBag },
  { value: "entertainment", label: "Giải trí", Icon: Gamepad2 },
  { value: "sports", label: "Thể thao", Icon: Dumbbell },
  { value: "theme_park", label: "Công viên giải trí", Icon: FerrisWheel },
];

interface Suggestion { id: string; place_name: string; center: [number, number]; }

interface Props {
  userLocation: UserLocation | null;
  setUserLocation: (loc: UserLocation | null) => void;
  radius: number; setRadius: (r: number) => void;
  category: string; setCategory: (c: string) => void;
  onGenerate: (query: string, selectedTags: string[]) => void;
  result: LocationResult | null;
  isGenerating: boolean;
  error: string | null;
  relaxLevel?: number;
}

const sectionLabel: React.CSSProperties = {
  margin: "0 0 0.75rem", 
  fontSize: "0.65rem", 
  fontWeight: 800,
  color: "#64748b", 
  textTransform: "uppercase", 
  letterSpacing: "0.15em",
};

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
  relaxLevel,
}: Props) {
  const [mode, setMode] = useState<"gps" | "address">("gps");
  const [addressInput, setAddressInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [smartQuery, setSmartQuery] = useState("");
  const [selectedBadges, setSelectedBadges] = useState<string[]>([]);
  const [isRevealed, setIsRevealed] = useState(false);
  const [showGroupRoom, setShowGroupRoom] = useState(false);
  const [showRelaxTooltip, setShowRelaxTooltip] = useState(false);

  const [sheetHeight, setSheetHeight] = useState<number>(30);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const dragStartRef = useRef<{ y: number, h: number } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const [panelWidth, setPanelWidth] = useState<number>(380);
  const desktopDragRef = useRef<{ x: number, w: number, currentW?: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    if (newW < 300) newW = 300;
    if (newW > 600) newW = 600;
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
    if (sheetHeight > 55) setSheetHeight(85);
    else setSheetHeight(30);
  };

  useEffect(() => {
    if (result) {
      setIsRevealed(false);
      setSheetHeight(30);
    }
  }, [result]);

  useEffect(() => {
    if (userLocation && gpsStatus === "idle") {
      setGpsStatus("done");
      setMode("gps");
    }
    if (!userLocation) setGpsStatus("idle");
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

  useEffect(() => {
    setCategory(selectedBadges.length > 0 ? selectedBadges[0] : "all");
  }, [selectedBadges, setCategory]);

  const toggleBadge = (catValue: string) => {
    if (catValue === "all") { setSelectedBadges([]); return; }
    setSelectedBadges((prev) => prev.includes(catValue) ? [] : [catValue]);
  };

  const removeBadge = () => setSelectedBadges([]);
  const handleSmartGenerate = () => onGenerate(smartQuery.trim(), selectedBadges);
  const isSmartMode = smartQuery.trim().length > 0;

  return (
    <aside 
      ref={asideRef}
      className={`${inter.className} w-full flex-shrink-0 md:border-r border-slate-200 bg-white flex flex-col overflow-hidden z-10 absolute md:relative bottom-0 left-0 md:bottom-auto md:left-auto rounded-t-[2rem] md:rounded-none shadow-[0_-8px_30px_rgba(0,0,0,0.06)] md:shadow-none`}
      style={isMobile ? { 
        height: `${sheetHeight}%`, 
        transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' 
      } : { width: `${panelWidth}px` }}
    >
      {!isMobile && (
        <div 
          onMouseDown={onDesktopDragStart}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-slate-200 z-50 transition-colors"
        />
      )}
      <div 
        className="w-full flex justify-center items-center pt-4 pb-3 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none md:hidden bg-white z-20 sticky top-0"
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onMouseDown={onTouchStart} onMouseMove={onTouchMove} onMouseUp={onTouchEnd} onMouseLeave={onTouchEnd}
      >
        <div className="w-10 h-1.5 bg-slate-200 rounded-full" />
      </div>

      <div 
        className={`flex-1 overflow-y-auto ${isMobile ? "px-6 pt-1 pb-10" : "p-8"}`}
        style={isMobile ? { paddingBottom: "calc(env(safe-area-inset-bottom, 24px) + 24px)" } : undefined}
      >
        {/* EDITORIAL HEADER */}
        <h2 style={{ margin: "0 0 2rem", fontSize: "0.85rem", fontWeight: 900, color: "#0f172a", letterSpacing: "0.05em", borderBottom: "1px solid #f1f5f9", paddingBottom: "1rem" }}>
          BLIND BOX TRAVELLING
        </h2>

        {/* ── LOCATION ── */}
        <section style={{ marginBottom: "2rem" }}>
          <p style={sectionLabel}>Vị trí của bạn</p>
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "12px", padding: "4px", marginBottom: "0.75rem" }}>
            {(["gps", "address"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setUserLocation(null); setGpsStatus("idle"); setSuggestions([]); setAddressInput(""); }}
                style={{
                  flex: 1, padding: "0.5rem", border: "none", cursor: "pointer", borderRadius: "8px",
                  fontSize: "0.8rem", fontWeight: 700,
                  background: mode === m ? "#fff" : "transparent",
                  color: mode === m ? "#0f172a" : "#64748b", 
                  boxShadow: mode === m ? "0 2px 4px rgba(0,0,0,0.04)" : "none",
                  transition: "all 0.2s ease",
                }}>
                {m === "gps" ? "GPS" : "Địa chỉ"}
              </button>
            ))}
          </div>

          {mode === "gps" ? (
            <button onClick={handleGPS} disabled={gpsStatus === "loading"}
              style={{
                width: "100%", padding: "0.875rem", borderRadius: "12px",
                border: "1px solid #e2e8f0", background: "#fff",
                fontSize: "0.85rem", fontWeight: 700, cursor: "pointer",
                color: gpsStatus === "done" ? "#16a34a" : "#0f172a",
                transition: "all 0.2s"
              }}>
              {gpsStatus === "idle" && "Lấy vị trí hiện tại"}
              {gpsStatus === "loading" && "Đang định vị..."}
              {gpsStatus === "done" && "Đã xác định vị trí"}
              {gpsStatus === "error" && "Không thể lấy vị trí"}
            </button>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                value={addressInput} onChange={(e) => handleAddressChange(e.target.value)}
                placeholder="Nhập địa chỉ của bạn..."
                style={{
                  width: "100%", boxSizing: "border-box", padding: "0.875rem 1rem",
                  borderRadius: "12px", border: "1px solid transparent", background: "#f8fafc",
                  fontSize: "0.85rem", outline: "none", color: "#0f172a", transition: "all 0.2s"
                }}
                onFocus={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.border = "1px solid #0f172a"; }}
                onBlur={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.border = "1px solid transparent"; }}
              />
              {suggestions.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0,
                  background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.05)", zIndex: 20, overflow: "hidden",
                }}>
                  {suggestions.map((s) => (
                    <button key={s.id} onClick={() => selectSuggestion(s)}
                      style={{
                        display: "block", width: "100%", padding: "0.75rem 1rem",
                        background: "none", border: "none", textAlign: "left",
                        fontSize: "0.8rem", color: "#334155", cursor: "pointer",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      {s.place_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── SMART INPUT ── */}
        <section style={{ marginBottom: "2rem" }}>
          <p style={sectionLabel}>Tìm kiếm thông minh</p>
          <div style={{
            border: "1px solid transparent", borderRadius: "16px",
            padding: "10px 12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px",
            background: "#f8fafc", minHeight: "50px", transition: "all 0.2s",
          }}
          onFocus={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#0f172a"; }}
          onBlur={(e) => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "transparent"; }}
          >
            {selectedBadges.map((badge) => {
              const cat = CATEGORIES.find((c) => c.value === badge);
              return (
                <span key={badge} style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  background: "#0f172a", borderRadius: "8px", padding: "4px 10px",
                  fontSize: "0.75rem", fontWeight: 700, color: "#fff",
                }}>
                  {cat?.label}
                  <button onClick={removeBadge} style={{ background: "none", border: "none", cursor: "pointer", color: "#cbd5e1" }}>✕</button>
                </span>
              );
            })}
            <input
              value={smartQuery} onChange={(e) => setSmartQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSmartGenerate(); }}
              placeholder={selectedBadges.length > 0 ? "Thêm yêu cầu..." : "VD: quán cà phê yên tĩnh..."}
              style={{ flex: 1, minWidth: "120px", border: "none", outline: "none", background: "transparent", fontSize: "0.85rem", color: "#0f172a" }}
            />
          </div>
        </section>

        {/* ── CATEGORIES ── */}
        <section style={{ marginBottom: "2rem" }}>
          <p style={sectionLabel}>Bộ sưu tập</p>
          <div ref={scrollRef} style={{
              display: "flex", flexWrap: "wrap", gap: "8px",
            }}>
            {CATEGORIES.map((item) => {
              const isActive = item.value === "all" ? selectedBadges.length === 0 : selectedBadges.includes(item.value);
              const CategoryIcon = item.Icon; 
              return (
                <button
                  key={item.value} onClick={() => toggleBadge(item.value)}
                  style={{
                    padding: "8px 16px", borderRadius: "20px",
                    border: "1px solid", borderColor: isActive ? "#0f172a" : "#e2e8f0",
                    background: isActive ? "#0f172a" : "#fff",
                    color: isActive ? "#fff" : "#475569",
                    fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
                    transition: "all 0.2s",
                    display: "flex", alignItems: "center", gap: "6px" 
                  }}
                >
                  {/* Hiển thị Icon, nếu nút được chọn thì nét vẽ dày hơn một chút */}
                  <CategoryIcon size={16} strokeWidth={isActive ? 2.5 : 2} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── DISTANCE ── */}
        <section style={{ marginBottom: "2.5rem" }}>
          <p style={{ ...sectionLabel, display: "flex", justifyContent: "space-between" }}>
            <span>Khoảng cách</span>
            <span style={{ color: "#0f172a" }}>{radius} KM</span>
          </p>
          <input type="range" min={0.5} max={100} step={0.5} value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#0f172a", cursor: "pointer", height: "4px", background: "#e2e8f0", borderRadius: "4px" }}
          />
        </section>

        {/* ── BUTTONS ── */}
        {error && <div style={{ background: "#fef2f2", color: "#b91c1c", borderRadius: "12px", padding: "1rem", fontSize: "0.8rem", marginBottom: "1rem" }}>{error}</div>}
        
        <button
          onClick={handleSmartGenerate} disabled={isGenerating || !userLocation}
          style={{
            width: "100%", padding: "1rem", borderRadius: "16px", border: "none",
            background: isGenerating || !userLocation ? "#e2e8f0" : "#0f172a",
            color: isGenerating || !userLocation ? "#94a3b8" : "#fff",
            fontSize: "0.9rem", fontWeight: 800, letterSpacing: "0.05em",
            cursor: !userLocation || isGenerating ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
          }}
        >
          {isGenerating ? "ĐANG XỬ LÝ..." : isSmartMode ? "TÌM KIẾM" : "BẮT ĐẦU"}
        </button>

        <button
          onClick={() => setShowGroupRoom((prev) => !prev)}
          style={{
            width: "100%", marginTop: "0.75rem", padding: "1rem", borderRadius: "16px",
            border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a",
            fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease",
          }}
        >
          {showGroupRoom ? "Đóng tạo phòng" : "Tạo phòng nhóm"}
        </button>

        {showGroupRoom && <div style={{ marginTop: "1rem" }}><GroupRoom embedded /></div>}
        
      </div>
    </aside>
  );
}