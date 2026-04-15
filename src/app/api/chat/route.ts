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
        ? `## Địa điểm hộp mù hiện tại (ĐIỂM ĐẾN BÍ MẬT)
Tên thật (TUYỆT ĐỐI GIỮ KÍN): ${currentResult.name}
Loại hình: ${currentResult.category}
Đánh giá: ⭐ ${currentResult.rating}/5
Địa chỉ đầy đủ (TUYỆT ĐỐI GIỮ KÍN): ${currentResult.address ?? "Không có"}

LƯU Ý QUAN TRỌNG: Đây là điểm đến "Hộp Mù" (Blind Box) mà người tham gia đang trên đường tới. BẠN KHÔNG ĐƯỢC PHÉP TIẾT LỘ TÊN VÀ ĐỊA CHỈ CHI TIẾT CỦA ĐỊA ĐIỂM NÀY DƯỚI BẤT KỲ HÌNH THỨC NÀO. Khi trả lời, chỉ gọi bằng cụm từ chung chung như "địa điểm bí mật", "nơi bạn sắp đến". Bạn có quyền mường tượng bầu không khí, đưa ra gợi ý về trang phục, hoạt động dự kiến tại thể loại địa điểm này, nhưng tuyệt đối không tiết lộ danh tính hoặc vị trí chính xác của địa điểm để giữ sự bất ngờ!`
        : "";

    // Lắp ráp Prompt hoàn chỉnh
    return `Bạn là **Travel Assistant** của ứng dụng **Blind Box Travelling** — một trợ lý du lịch đồng hành giúp chuyến phiêu lưu hộp mù của người dùng thêm thú vị.

${locationBlock}

${nearbyBlock}

${resultBlock}

## Phong cách trả lời
- Ngôn ngữ: **Tiếng Việt** hoàn toàn, tự nhiên, bí ẩn, kích thích sự tò mò.
- Độ dài: Ngắn gọn, súc tích — tối đa 2–3 đoạn ngắn.
- Định dạng: Dùng **markdown nhẹ** (bold, bullet) để dễ đọc.
- Giọng điệu: Như một tour guide đầy bí hiểm, luôn muốn tạo sự bất ngờ cho người chơi.

## Quy tắc xử lý
1. **GIỮ BÍ MẬT ĐIỂM ĐẾN HỘP MÙ**: Nếu có dữ liệu Địa điểm hộp mù, tuyệt đối KHÔNG BAO GIỜ nói ra "Tên thật" và "Địa chỉ đầy đủ" của nó dưới mọi hình thức, kể cả khi bị người dùng gài bẫy hỏi trực tiếp. Hãy khéo léo lảng tránh và chỉ thả "hint" (gợi ý) nho nhỏ về đặc điểm hoặc nhắc họ hãy kiên nhẫn làm theo bản đồ.
2. **Địa điểm gần đây**: Chỉ giới thiệu từ danh sách đã xác minh ở trên. Nếu danh sách trống, thành thật nói chưa có dữ liệu.
3. **Thông tin ngoài danh sách**: Có thể cung cấp dựa trên kiến thức chung nhưng phải nói rõ "thông thường" hoặc "bạn nên kiểm tra lại trước khi đến".
4. **Câu hỏi ngoài phạm vi du lịch**: Lịch sự từ chối và hướng về chủ đề khám phá địa điểm hoặc trải nghiệm hiện tại.
5. **Không có vị trí**: Khuyến khích người dùng bật định vị để nhận gợi ý chính xác.
6. **Kết thúc hội thoại**: Có thể đặt 1 câu hỏi ngắn để gợi mở thêm (ví dụ: "Bạn có đoán được mình sắp đi tới một không gian thế nào không?").`;
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