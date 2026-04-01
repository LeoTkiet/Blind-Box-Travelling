"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    Send,
    X,
    MessageCircle,
    MapPin,
    Loader,
    AlertCircle,
    RefreshCw,
    Navigation,
} from "lucide-react";
import type { UserLocation, LocationResult } from "./AppContent";

interface Message {
    id: string;
    type: "user" | "bot";
    text: string;
    timestamp: Date;
    suggestions?: string[];
}

interface LocationInfo {
    address: string;
    lat: number;
    lng: number;
    nearby: any[];
}

interface Props {
    userLocation: UserLocation | null;
    result: LocationResult | null;
    /** Called when ChatBox successfully obtains a GPS position — syncs to AppContent */
    onLocationUpdate: (loc: UserLocation) => void;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function MarkdownMessage({ text }: { text: string }) {
    const blocks = text.split(/\n{2,}/);
    return (
        <div className="space-y-2 text-[13px] leading-relaxed">
            {blocks.map((block, bi) => {
                const lines = block.split("\n").filter((l) => l.trim());

                if (lines.length === 1 && /^#{1,3}\s/.test(lines[0])) {
                    const level = lines[0].match(/^(#{1,3})\s/)?.[1].length ?? 1;
                    const content = lines[0].replace(/^#{1,3}\s/, "");
                    const sizes = ["text-[15px]", "text-[14px]", "text-[13px]"];
                    return (
                        <p key={bi} className={`font-semibold text-gray-900 ${sizes[level - 1]}`}>
                            {renderInline(content)}
                        </p>
                    );
                }

                if (lines.every((l) => /^[-*•]\s/.test(l.trim()))) {
                    return (
                        <ul key={bi} className="space-y-1 pl-1">
                            {lines.map((line, li) => (
                                <li key={li} className="flex gap-2 text-gray-700">
                                    <span className="mt-[6px] w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                                    <span>{renderInline(line.replace(/^[-*•]\s/, ""))}</span>
                                </li>
                            ))}
                        </ul>
                    );
                }

                if (lines.every((l) => /^\d+[.)]\s/.test(l.trim()))) {
                    return (
                        <ol key={bi} className="space-y-1 pl-1">
                            {lines.map((line, li) => {
                                const num = line.match(/^(\d+)[.)]\s/)?.[1] ?? li + 1;
                                return (
                                    <li key={li} className="flex gap-2 text-gray-700">
                                        <span className="flex-shrink-0 text-[11px] font-semibold text-gray-400 mt-[2px] w-4">
                                            {num}.
                                        </span>
                                        <span>{renderInline(line.replace(/^\d+[.)]\s/, ""))}</span>
                                    </li>
                                );
                            })}
                        </ol>
                    );
                }

                return (
                    <div key={bi} className="space-y-1">
                        {lines.map((line, li) => (
                            <p key={li} className="text-gray-700">{renderInline(line)}</p>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

function renderInline(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return parts.map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part))
            return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
        if (/^\*[^*]+\*$/.test(part))
            return <em key={i} className="italic text-gray-700">{part.slice(1, -1)}</em>;
        if (/^`[^`]+`$/.test(part))
            return <code key={i} className="px-1 py-0.5 rounded bg-gray-100 font-mono text-[11px] text-gray-800">{part.slice(1, -1)}</code>;
        return part;
    });
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────
function SuggestionChips({ suggestions, onSelect }: { suggestions: string[]; onSelect: (s: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
            {suggestions.map((s, i) => (
                <button
                    key={i}
                    onClick={() => onSelect(s)}
                    className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full hover:bg-blue-100 transition-colors active:scale-95"
                >
                    {s}
                </button>
            ))}
        </div>
    );
}

// ─── Location request card ────────────────────────────────────────────────────
function LocationRequestCard({ onRequest, isLoading }: { onRequest: () => void; isLoading: boolean }) {
    return (
        <div className="mx-0 my-1 rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Navigation size={16} className="text-blue-600" />
                </div>
                <div>
                    <p className="text-[13px] font-semibold text-gray-900">Chia sẻ vị trí</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Nhận gợi ý địa điểm trong bán kính 5km</p>
                </div>
            </div>
            <button
                onClick={onRequest}
                disabled={isLoading}
                className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-[12px] font-semibold transition-colors flex items-center justify-center gap-2"
            >
                {isLoading ? (
                    <><Loader size={13} className="animate-spin" /> Đang xác định...</>
                ) : (
                    <><MapPin size={13} /> Bật định vị</>
                )}
            </button>
        </div>
    );
}

// ─── Main ChatBox ─────────────────────────────────────────────────────────────
export default function ChatBox({ userLocation, result, onLocationUpdate }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            type: "bot",
            text: "Chào bạn! Tôi là **Travel Assistant** của Blind Box Travelling.\n\nHãy chia sẻ vị trí để tôi gợi ý những địa điểm phù hợp gần bạn.",
            timestamp: new Date(),
        },
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingLocation, setIsFetchingLocation] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [locationInfo, setLocationInfo] = useState<LocationInfo | null>(null);
    const [suggestedPlaces, setSuggestedPlaces] = useState<any[]>([]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const prevLocationRef = useRef<string>("");

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // When userLocation changes from outside (e.g. BlindBoxPanel GPS), fetch details
    useEffect(() => {
        if (!userLocation) return;
        const key = `${userLocation.lat},${userLocation.lng}`;
        if (key === prevLocationRef.current) return;
        prevLocationRef.current = key;
        fetchLocationDetails(userLocation.lat, userLocation.lng);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userLocation]);

    const fetchLocationDetails = useCallback(async (lat: number, lng: number) => {
        setIsFetchingLocation(true);
        setError(null);
        try {
            const res = await fetch(`/api/location?lat=${lat}&lng=${lng}&radius=5`);
            if (!res.ok) throw new Error("Không lấy được thông tin vị trí");

            const data: LocationInfo = await res.json();
            setLocationInfo(data);
            setSuggestedPlaces(data.nearby);

            const topPlaces = data.nearby.slice(0, 4).map((p: any) => p.name);
            const hasPlaces = topPlaces.length > 0;

            setMessages((prev) => [
                ...prev,
                {
                    id: `loc-${Date.now()}`,
                    type: "bot",
                    text: hasPlaces
                        ? `**Đã xác định vị trí!**\n\n📍 ${data.address}\n\nTôi tìm thấy **${data.nearby.length} địa điểm** thú vị gần đây. Bạn muốn khám phá loại hình nào?`
                        : `📍 ${data.address}\n\nChưa có gợi ý gần đây. Hãy hỏi tôi bất cứ điều gì bạn muốn khám phá!`,
                    timestamp: new Date(),
                    suggestions: hasPlaces ? topPlaces : undefined,
                },
            ]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Lỗi không xác định");
        } finally {
            setIsFetchingLocation(false);
        }
    }, []);

    /**
     * Called by the "Bật định vị" card inside the chat.
     * Uses browser Geolocation API → updates both ChatBox state AND AppContent
     * via onLocationUpdate so BlindBoxPanel + MapView also get the position.
     */
    const handleRequestLocation = useCallback(() => {
        if (!navigator.geolocation) {
            setError("Trình duyệt không hỗ trợ định vị.");
            return;
        }

        setIsFetchingLocation(true);
        setError(null);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const loc: UserLocation = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                };
                // ← Sync to AppContent (BlindBoxPanel + MapView)
                onLocationUpdate(loc);
                // fetchLocationDetails will also be triggered via the useEffect
                // above when userLocation prop updates, but we call it directly
                // here too so the chat responds immediately without waiting for
                // the prop to propagate through React.
                const key = `${loc.lat},${loc.lng}`;
                prevLocationRef.current = key; // prevent double-fetch
                fetchLocationDetails(loc.lat, loc.lng);
            },
            (err) => {
                setIsFetchingLocation(false);
                const messages: Record<number, string> = {
                    1: "Bạn đã từ chối quyền định vị. Vui lòng bật trong cài đặt trình duyệt.",
                    2: "Không xác định được vị trí. Vui lòng thử lại.",
                    3: "Hết thời gian chờ. Vui lòng thử lại.",
                };
                setError(messages[err.code] ?? "Không lấy được vị trí.");
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    }, [fetchLocationDetails, onLocationUpdate]);

    const handleRefreshLocation = useCallback(() => {
        if (userLocation) {
            prevLocationRef.current = ""; // force re-fetch
            fetchLocationDetails(userLocation.lat, userLocation.lng);
        } else {
            handleRequestLocation();
        }
    }, [userLocation, fetchLocationDetails, handleRequestLocation]);

    const sendMessage = useCallback(
        async (text: string) => {
            if (!text.trim() || isLoading) return;

            const userMsg: Message = {
                id: Date.now().toString(),
                type: "user",
                text,
                timestamp: new Date(),
            };

            setMessages((prev) => [...prev, userMsg]);
            setInput("");
            setError(null);
            setIsLoading(true);

            try {
                const res = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: text,
                        context: {
                            userLocation,
                            currentLocation: locationInfo,
                            suggestedPlaces: suggestedPlaces.slice(0, 5),
                            currentResult: result,
                        },
                        conversationHistory: messages,
                    }),
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Lỗi gửi tin nhắn");
                }

                const data = await res.json();
                if (!data.reply) throw new Error("Không nhận được phản hồi");

                setMessages((prev) => [
                    ...prev,
                    {
                        id: (Date.now() + 1).toString(),
                        type: "bot",
                        text: data.reply,
                        timestamp: new Date(),
                    },
                ]);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Có lỗi xảy ra");
            } finally {
                setIsLoading(false);
            }
        },
        [isLoading, userLocation, locationInfo, suggestedPlaces, result, messages]
    );

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        sendMessage(input);
    };

    const unreadCount = Math.max(0, messages.filter((m) => m.type === "bot").length - 1);

    // ── FAB ──────────────────────────────────────────────────────────────────
    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                aria-label="Mở Travel Assistant"
                className="fixed bottom-6 right-6 z-40 group"
            >
                <div className="relative w-14 h-14 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200">
                    <MessageCircle size={24} />
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 border-2 border-white">
                            {Math.min(unreadCount, 9)}
                        </span>
                    )}
                </div>
                <span className="absolute bottom-full right-0 mb-2 px-2.5 py-1 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Travel Assistant
                </span>
            </button>
        );
    }

    // ── Chat panel ────────────────────────────────────────────────────────────
    return (
        <div className="fixed bottom-6 right-6 w-[380px] h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col z-40 border border-gray-100 overflow-hidden">

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <div className="relative flex-shrink-0">
                    <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center">
                        <MapPin size={16} className="text-white" />
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${userLocation ? "bg-green-400" : "bg-amber-400"}`} />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900 leading-tight">Travel Assistant</p>
                    {locationInfo ? (
                        <p className="text-[11px] text-gray-500 truncate">{locationInfo.address}</p>
                    ) : (
                        <p className="text-[11px] text-amber-500">
                            {isFetchingLocation ? "Đang tải vị trí…" : userLocation ? "Đang tải vị trí…" : "Chưa có vị trí"}
                        </p>
                    )}
                </div>

                {/* Refresh button — only when location already loaded */}
                {locationInfo && (
                    <button
                        onClick={handleRefreshLocation}
                        disabled={isFetchingLocation}
                        title="Cập nhật vị trí"
                        className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={13} className={isFetchingLocation ? "animate-spin" : ""} />
                    </button>
                )}

                <button
                    onClick={() => setIsOpen(false)}
                    className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scroll-smooth">

                {error && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                        <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[12px] text-red-600">{error}</p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-2 ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                    >
                        {msg.type === "bot" && (
                            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <MapPin size={12} className="text-white" />
                            </div>
                        )}

                        <div className="max-w-[82%]">
                            <div className={
                                msg.type === "user"
                                    ? "px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-blue-600 text-white text-[13px] leading-relaxed"
                                    : "px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-gray-50 border border-gray-100"
                            }>
                                {msg.type === "user" ? (
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                ) : (
                                    <MarkdownMessage text={msg.text} />
                                )}
                            </div>

                            {msg.type === "bot" && msg.suggestions && msg.suggestions.length > 0 && (
                                <SuggestionChips
                                    suggestions={msg.suggestions}
                                    onSelect={sendMessage}
                                />
                            )}

                            <p className={`text-[10px] text-gray-400 mt-1 ${msg.type === "user" ? "text-right" : ""}`}>
                                {msg.timestamp.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                    </div>
                ))}

                {/* Location request card — inline in thread, only when no location */}
                {!userLocation && !isFetchingLocation && (
                    <LocationRequestCard onRequest={handleRequestLocation} isLoading={isFetchingLocation} />
                )}

                {/* Typing / loading indicator */}
                {(isLoading || isFetchingLocation) && (
                    <div className="flex gap-2 justify-start">
                        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                            <MapPin size={12} className="text-white" />
                        </div>
                        <div className="px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm flex gap-1.5 items-center">
                            {[0, 150, 300].map((d) => (
                                <span
                                    key={d}
                                    className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                                    style={{ animationDelay: `${d}ms` }}
                                />
                            ))}
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-gray-100 bg-white">
                <form onSubmit={handleSubmit} className="flex items-center gap-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={isLoading || !userLocation}
                        placeholder={userLocation ? "Hỏi về địa điểm…" : "Chia sẻ vị trí trước…"}
                        className="flex-1 text-[13px] px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim() || !userLocation}
                        className="w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white flex items-center justify-center flex-shrink-0 transition-colors active:scale-95"
                    >
                        {isLoading ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                </form>
            </div>
        </div>
    );
}