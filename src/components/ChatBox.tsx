"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    Send,
    MessageCircle,
    MapPin,
    Loader,
    AlertCircle,
    RefreshCw,
    Navigation,
    Bot,
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
    /** Gọi khi ChatBox lấy được GPS thành công — đồng bộ ngược lên AppContent */
    onLocationUpdate: (loc: UserLocation) => void;
}

// Trình xử lý Markdown
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

// Các nút Gợi ý
function SuggestionChips({ suggestions, onSelect }: { suggestions: string[]; onSelect: (s: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
            {suggestions.map((s, i) => (
                <button
                    key={i}
                    onClick={() => onSelect(s)}
                    className="px-2.5 py-1 text-[11px] font-medium text-gray-800 bg-gray-100 border border-gray-200 rounded-full hover:bg-gray-200 transition-colors active:scale-95"
                >
                    {s}
                </button>
            ))}
        </div>
    );
}

// Thẻ Yêu cầu Cấp quyền Vị trí
function LocationRequestCard({ onRequest, isLoading }: { onRequest: () => void; isLoading: boolean }) {
    return (
        <div className="mx-0 my-1 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <Navigation size={16} className="text-gray-900" />
                </div>
                <div>
                    <p className="text-[13px] font-semibold text-gray-900">Chia sẻ vị trí</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Nhận gợi ý địa điểm trong bán kính 5km</p>
                </div>
            </div>
            <button
                onClick={onRequest}
                disabled={isLoading}
                className="w-full py-2 rounded-xl bg-gray-900 hover:bg-black disabled:bg-gray-300 text-white text-[12px] font-semibold transition-colors flex items-center justify-center gap-2"
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

export default function ChatBox({ userLocation, result, onLocationUpdate }: Props) {
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

    // Tự động lấy chi tiết địa điểm khi userLocation thay đổi từ bên ngoài 
    useEffect(() => {
        if (!userLocation) return;
        const key = `${userLocation.lat},${userLocation.lng}`;
        if (key === prevLocationRef.current) return;
        prevLocationRef.current = key;
        fetchLocationDetails(userLocation.lat, userLocation.lng);
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
     * Xử lý khi bấm nút "Bật định vị" trực tiếp trong chat.
     * Dùng API Geolocation của trình duyệt → cập nhật State cho ChatBox VÀ AppContent.
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
                // ← Đồng bộ lên Component Cha (để truyền cho Bản đồ & Bảng điều khiển)
                onLocationUpdate(loc);

                // Gọi API ngay lập tức để chat phản hồi nhanh mà không cần đợi React re-render
                const key = `${loc.lat},${loc.lng}`;
                prevLocationRef.current = key;
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
            prevLocationRef.current = ""; // Xóa bộ nhớ đệm để ép gọi lại API
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

    return (
        <aside className="w-[360px] sm:w-[400px] flex-shrink-0 h-full bg-white shadow-[-10px_0_40px_rgba(0,0,0,0.05)] flex flex-col z-20 border-l border-gray-100 overflow-hidden relative">
            {/* Thanh Tiêu đề (Header) */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-white">
                <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center">
                        <Bot size={19} className="text-white" />
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${userLocation ? "bg-green-500" : "bg-amber-500"}`} />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold text-gray-900 leading-tight tracking-tight">Travel Assistant</p>
                    {locationInfo ? (
                        <p className="text-[12px] text-gray-500 truncate mt-0.5">{locationInfo.address}</p>
                    ) : (
                        <p className="text-[12px] text-amber-600 font-medium mt-0.5">
                            {isFetchingLocation ? "Đang tải vị trí…" : userLocation ? "Đang tải vị trí…" : "Chưa có vị trí"}
                        </p>
                    )}
                </div>

                {locationInfo && (
                    <button
                        onClick={handleRefreshLocation}
                        disabled={isFetchingLocation}
                        title="Cập nhật vị trí"
                        className="w-9 h-9 rounded-xl hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={15} className={isFetchingLocation ? "animate-spin" : ""} />
                    </button>
                )}
            </div>

            {/* Khu vực Tin nhắn */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 scroll-smooth bg-gray-50/30">

                {error && (
                    <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-2xl px-4 py-3 shadow-sm">
                        <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[12px] text-red-600 font-medium leading-relaxed">{error}</p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-3 ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                    >
                        {msg.type === "bot" && (
                            <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                                <Bot size={14} className="text-white" />
                            </div>
                        )}

                        <div className="max-w-[85%]">
                            <div className={
                                msg.type === "user"
                                    ? "px-4.5 py-3 rounded-[20px] rounded-tr-[4px] bg-gray-900 text-white text-[14px] leading-relaxed shadow-sm"
                                    : "px-4.5 py-3 rounded-[20px] rounded-tl-[4px] bg-white border border-gray-200/60 shadow-sm"
                            }>
                                {msg.type === "user" ? (
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                ) : (
                                    <MarkdownMessage text={msg.text} />
                                )}
                            </div>

                            {msg.type === "bot" && msg.suggestions && msg.suggestions.length > 0 && (
                                <div className="mt-2 pl-1">
                                    <SuggestionChips
                                        suggestions={msg.suggestions}
                                        onSelect={sendMessage}
                                    />
                                </div>
                            )}

                            <p className={`text-[10px] text-gray-400 mt-1.5 font-medium ${msg.type === "user" ? "text-right mr-1" : "text-left ml-2"}`}>
                                {msg.timestamp.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                    </div>
                ))}

                {!userLocation && !isFetchingLocation && (
                    <LocationRequestCard onRequest={handleRequestLocation} isLoading={isFetchingLocation} />
                )}

                {(isLoading || isFetchingLocation) && (
                    <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0 shadow-sm mt-1">
                            <Bot size={14} className="text-white" />
                        </div>
                        <div className="px-5 py-4 bg-white border border-gray-200/60 rounded-[20px] rounded-tl-[4px] flex gap-1.5 items-center shadow-sm">
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

                <div ref={messagesEndRef} className="h-4" />
            </div>

            {/* Khu vực Nhập tin nhắn */}
            <div className="px-5 py-4 border-t border-gray-100 bg-white">
                <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={isLoading || !userLocation}
                        placeholder={userLocation ? "Bạn muốn đi đâu..." : "Chia sẻ vị trí để bắt đầu..."}
                        className="flex-1 text-[14px] px-4 py-3.5 rounded-2xl bg-gray-50 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 focus:bg-white placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim() || !userLocation}
                        className="w-[48px] h-[48px] rounded-2xl bg-gray-900 hover:bg-black disabled:bg-gray-200 text-white flex items-center justify-center flex-shrink-0 transition-colors active:scale-95 shadow-sm"
                    >
                        {isLoading ? <Loader size={18} className="animate-spin" /> : <Send size={18} />}
                    </button>
                </form>
            </div>
        </aside>
    );
}