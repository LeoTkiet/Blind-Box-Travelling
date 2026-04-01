import { NextRequest, NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ChatRequest {
    message: string;
    context?: {
        userLocation?: { lat: number; lng: number; address?: string };
        currentLocation?: { address: string; lat: number; lng: number; nearby: any[] };
        suggestedPlaces?: any[];
        currentResult?: {
            name: string;
            rating: number;
            category: string;
            address?: string;
        };
        appName?: string;
    };
    conversationHistory?: Array<{
        type: "user" | "bot";
        text: string;
    }>;
}

export async function POST(request: NextRequest) {
    try {
        if (!GROQ_API_KEY) {
            return NextResponse.json(
                { error: "GROQ_API_KEY không được cấu hình. Hãy thêm nó vào .env.local" },
                { status: 500 }
            );
        }

        const body: ChatRequest = await request.json();
        const { message, context = {}, conversationHistory = [] } = body;

        if (!message || typeof message !== "string") {
            return NextResponse.json(
                { error: "Tin nhắn không hợp lệ" },
                { status: 400 }
            );
        }

        // Build location info string
        const locationInfo = context.currentLocation
            ? `Vị trí hiện tại: ${context.currentLocation.address}\nĐịa điểm gần đây:\n${context.suggestedPlaces
                ?.slice(0, 5)
                .map((p, i) => `${i + 1}. ${p.name} - ${p.category} (⭐ ${p.rating || "N/A"})`)
                .join("\n") || "Không tìm thấy địa điểm"}`
            : "Người dùng chưa chia sẻ vị trí";

        // Build system prompt with real location data
        const systemPrompt = `Bạn là "Travel Assistant" - một trợ lý AI chuyên về du lịch cho ứng dụng "Blind Box Travelling".

**Vị trí & Gợi ý hiện tại:**
${locationInfo}

**Địa điểm đang xem:** ${context.currentResult
                ? `${context.currentResult.name} (${context.currentResult.category}, ⭐ ${context.currentResult.rating}%)`
                : "Chưa có"
            }

**Hướng dẫn:**
1. Là thân thiện, nhiệt tình và chuyên nghiệp
2. Trả lời LUÔN bằng tiếng Việt
3. Nếu được hỏi về những địa điểm gần đây, gợi ý từ danh sách trên
4. Cung cấp thông tin du lịch: giờ mở cửa, giá vé, đánh giá
5. Gợi ý lịch trình dựa trên sở thích của người dùng
6. Giữ câu trả lời ngắn gọn & hữu ích (dưới 300 ký tự)
7. Nếu không chắc, hãy ngoài hiệu hợp lý dựa trên kiến thức du lịch
8. Luôn khuyến khích người dùng khám phá thêm`;

        // Build conversation history for messages
        const messageHistory = conversationHistory
            .slice(-5) // Only last 5 messages for context
            .map((msg) => ({
                role: msg.type === "user" ? "user" : "assistant",
                content: msg.text,
            }));

        // Add current message
        messageHistory.push({
            role: "user",
            content: message,
        });

        console.log("Calling Groq API with location context...");

        const response = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant", // Free tier optimized - fast & efficient
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    ...messageHistory,
                ],
                temperature: 0.7,
                max_tokens: 500,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Groq API Error:", {
                status: response.status,
                error: errorData,
            });
            return NextResponse.json(
                {
                    error: `Groq API Error: ${errorData.error?.message || "Lỗi xử lý chat"}`,
                },
                { status: response.status }
            );
        }

        const data = await response.json();

        // Extract text from response
        const reply =
            data.choices?.[0]?.message?.content?.trim() ||
            "Xin lỗi, tôi không thể trả lời câu hỏi này.";

        return NextResponse.json({ reply });
    } catch (error) {
        console.error("Chat API Error:", error);
        const errorMessage =
            error instanceof Error ? error.message : "Có lỗi xảy ra khi xử lý yêu cầu";
        return NextResponse.json(
            {
                error: errorMessage,
                hint: "Kiểm tra API key hoặc kết nối internet",
            },
            { status: 500 }
        );
    }
}
