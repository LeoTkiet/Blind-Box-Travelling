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

function buildSystemPrompt(context: ChatRequest["context"] = {}): string {
    const { currentLocation, suggestedPlaces = [], currentResult } = context;

    // Khối thông tin Vị trí
    const locationBlock = currentLocation
        ? `## Vị trí người dùng
Địa chỉ: ${currentLocation.address}
Tọa độ: ${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}`
        : `## Vị trí người dùng
Người dùng chưa chia sẻ vị trí.`;

    // Khối thông tin Địa điểm lân cận
    const nearbyBlock =
        suggestedPlaces.length > 0
            ? `## Địa điểm gần đây (đã được xác minh qua API)
${suggestedPlaces
                .slice(0, 8)
                .map(
                    (p, i) =>
                        `${i + 1}. **${p.name}**` +
                        (p.category ? ` — ${p.category}` : "") +
                        (p.rating ? ` | ⭐ ${p.rating}` : "") +
                        (p.distance ? ` | ${p.distance}` : "") +
                        (p.address ? `\n   📍 ${p.address}` : "")
                )
                .join("\n")}

Khi người dùng hỏi về địa điểm gần đây, ưu tiên giới thiệu từ danh sách trên. Đừng bịa thêm địa điểm không có trong danh sách.`
            : `## Địa điểm gần đây
Chưa có dữ liệu địa điểm gần đây.`;

    // Khối kết quả Hộp mù hiện tại
    const resultBlock = currentResult
        ? `## Địa điểm hộp mù vừa được tạo
Tên: ${currentResult.name}
Loại: ${currentResult.category}
Đánh giá: ⭐ ${currentResult.rating}/5
Địa chỉ: ${currentResult.address ?? "Không có"}

Nếu người dùng hỏi về địa điểm này, hãy cung cấp thông tin chi tiết và gợi ý trải nghiệm phù hợp.`
        : "";

    // Lắp ráp Prompt hoàn chỉnh
    return `Bạn là **Travel Assistant** của ứng dụng **Blind Box Travelling** — một trợ lý du lịch thông minh giúp người dùng khám phá những địa điểm thú vị bất ngờ gần họ.

${locationBlock}

${nearbyBlock}

${resultBlock}

## Phong cách trả lời
- Ngôn ngữ: **Tiếng Việt** hoàn toàn, tự nhiên và thân thiện
- Độ dài: Ngắn gọn, súc tích — tối đa 2–3 đoạn ngắn hoặc 1 danh sách 3–5 mục
- Định dạng: Dùng **markdown nhẹ** (bold, danh sách gạch đầu dòng) để dễ đọc
- Giọng điệu: Như một người bạn am hiểu địa phương, nhiệt tình nhưng không sến

## Quy tắc xử lý
1. **Địa điểm gần đây**: Chỉ giới thiệu từ danh sách đã xác minh ở trên. Nếu danh sách trống, thành thật nói chưa có dữ liệu và gợi ý người dùng bật định vị.
2. **Thông tin ngoài danh sách** (giờ mở cửa, giá vé, menu...): Có thể cung cấp dựa trên kiến thức chung nhưng phải nói rõ "thông thường" hoặc "bạn nên kiểm tra lại trước khi đến".
3. **Gợi ý lịch trình**: Kết hợp địa điểm trong danh sách với thời gian, khoảng cách hợp lý.
4. **Câu hỏi ngoài phạm vi du lịch**: Lịch sự từ chối và hướng về chủ đề khám phá địa điểm.
5. **Không có vị trí**: Khuyến khích người dùng bật định vị để nhận gợi ý chính xác hơn.
6. **Kết thúc hội thoại**: Có thể đặt 1 câu hỏi ngắn để tiếp tục gợi ý (ví dụ: "Bạn thích ăn sáng hay cà phê trước?").`;
}

export async function POST(request: NextRequest) {
    try {
        if (!GROQ_API_KEY) {
            return NextResponse.json(
                { error: "GROQ_API_KEY chưa được cấu hình trong .env.local" },
                { status: 500 }
            );
        }

        const body: ChatRequest = await request.json();
        const { message, context = {}, conversationHistory = [] } = body;

        if (!message || typeof message !== "string" || !message.trim()) {
            return NextResponse.json({ error: "Tin nhắn không hợp lệ" }, { status: 400 });
        }

        const systemPrompt = buildSystemPrompt(context);

        // Lấy 8 tin nhắn gần nhất (4 lượt trao đổi) — đủ ngữ cảnh mà không làm tốn token
        const messageHistory = conversationHistory
            .slice(-8)
            .map((msg) => ({
                role: msg.type === "user" ? "user" : "assistant",
                content: msg.text,
            }));

        messageHistory.push({ role: "user", content: message.trim() });

        const response = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile", // Khả năng suy luận tốt hơn, vẫn nằm trong gói miễn phí của Groq
                messages: [
                    { role: "system", content: systemPrompt },
                    ...messageHistory,
                ],
                temperature: 0.6,   // Giảm nhẹ nhiệt độ → câu trả lời ổn định hơn, ít bị ảo giác
                max_tokens: 600,    // Đủ độ dài cho 2–3 đoạn văn có định dạng markdown
                top_p: 0.9,
                stream: false,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Groq API Error:", response.status, errorData);
            return NextResponse.json(
                { error: errorData.error?.message ?? "Lỗi từ Groq API" },
                { status: response.status }
            );
        }

        const data = await response.json();
        const reply =
            data.choices?.[0]?.message?.content?.trim() ||
            "Xin lỗi, tôi chưa thể trả lời câu hỏi này. Bạn thử hỏi lại theo cách khác nhé!";

        return NextResponse.json({ reply });
    } catch (error) {
        console.error("Chat API Error:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Lỗi không xác định",
                hint: "Kiểm tra GROQ_API_KEY và kết nối mạng",
            },
            { status: 500 }
        );
    }
}