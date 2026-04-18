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

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeReply(
    text: string,
    currentResult?: ChatRequest["context"] extends infer C
        ? C extends { currentResult?: infer R }
            ? R
            : never
        : never
): string {
    let sanitized = text;

    // Chặn lộ tên/địa chỉ/thể loại cụ thể của điểm đến hộp mù
    if (currentResult?.name) {
        sanitized = sanitized.replace(
            new RegExp(escapeRegExp(currentResult.name), "gi"),
            "địa điểm bí mật"
        );
    }
    if (currentResult?.address) {
        sanitized = sanitized.replace(
            new RegExp(escapeRegExp(currentResult.address), "gi"),
            "một vị trí bí mật"
        );
    }
    if (currentResult?.category) {
        sanitized = sanitized.replace(
            new RegExp(escapeRegExp(currentResult.category), "gi"),
            "loại hình bí mật"
        );
    }

    // Chặn một số từ dễ làm lộ loại địa điểm
    const leakedTypePatterns = [
        /\bquán cà phê\b/gi,
        /\bcà phê\b/gi,
        /\bcoffee\b/gi,
        /\bnhà hàng\b/gi,
        /\bquán ăn\b/gi,
        /\bbar\b/gi,
        /\bpub\b/gi,
    ];
    for (const pattern of leakedTypePatterns) {
        sanitized = sanitized.replace(pattern, "địa điểm bí mật");
    }

    return sanitized;
}

function ensurePlayfulTease(text: string): string {
    const teaseSignals = /(toang|căng|chiến hữu|lầy|cà khịa|đùa|vibe|khum|nè|nha)/i;
    if (teaseSignals.test(text)) return text;
    return `${text}\n\n*Nhắc nhẹ nè: đi chơi hộp mù mà nghiêm túc quá là mất vui đó nha 😏*`;
}

function buildSystemPrompt(context: ChatRequest["context"] = {}): string {
    const { currentLocation, currentResult } = context;

    // Khối thông tin Vị trí
    const locationBlock = currentLocation
        ? `## Vị trí người dùng
Địa chỉ: ${currentLocation.address}
Tọa độ: ${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}`
        : `## Vị trí người dùng
Người dùng chưa chia sẻ vị trí.`;

    // Khối kết quả Hộp mù hiện tại
    const resultBlock = currentResult
        ? `## Địa điểm hộp mù hiện tại (ĐIỂM ĐẾN BÍ MẬT)
Tên thật (TUYỆT ĐỐI GIỮ KÍN): ${currentResult.name}
Loại hình: ${currentResult.category}
Đánh giá: ⭐ ${currentResult.rating}/5
Địa chỉ đầy đủ (TUYỆT ĐỐI GIỮ KÍN): ${currentResult.address ?? "Không có"}

LƯU Ý QUAN TRỌNG: Đây là điểm đến "Hộp Mù" (Blind Box) mà người tham gia đang trên đường tới. BẠN KHÔNG ĐƯỢC PHÉP TIẾT LỘ TÊN THẬT, ĐỊA CHỈ, HOẶC LOẠI HÌNH CỤ THỂ của địa điểm này dưới bất kỳ hình thức nào. Khi trả lời, chỉ gọi bằng cụm từ chung như "địa điểm bí mật", "nơi bạn sắp đến". Bạn chỉ được gợi ý theo hướng trải nghiệm chung, trang phục, an toàn, chuẩn bị đồ, nhưng không được nói "quán cà phê", "nhà hàng", "bar"...`
        : "";

    // Lắp ráp Prompt hoàn chỉnh
    return `Bạn là **Travel Assistant** của ứng dụng **Blind Box Travelling** — một đứa bạn đồng hành lầy lội, nói chuyện duyên, hài hước, hơi láo nhẹ đúng lúc để tạo cảm giác thân.

${locationBlock}

${resultBlock}

## Phong cách trả lời
- Ngôn ngữ: **Tiếng Việt** hoàn toàn, tự nhiên, gần gũi.
- Độ dài: Ngắn gọn, súc tích — tối đa 2 đoạn ngắn hoặc 1 đoạn + bullet.
- Định dạng: Dùng **markdown nhẹ** (bold, bullet) để dễ đọc.
- Giọng điệu: Bạn thân đồng hành đi chơi, hài hước, dí dỏm, hơi "láo nhẹ" để tạo thân mật.
- "Láo nhẹ" nghĩa là cà khịa vui, không xúc phạm, không tục tĩu, không toxic, không công kích cá nhân.
- Chủ động đưa lời khuyên thực tế: chuẩn bị đồ, an toàn, thời tiết, ngân sách, mẹo trải nghiệm.
- Mỗi câu trả lời phải có ít nhất **1 câu chọc vui/cà khịa nhẹ** (ví dụ: "đừng để bụng đói rồi cáu với đời").
- Ưu tiên xưng hô thân mật kiểu "mình - bạn" hoặc "tui - bạn", tránh quá trang trọng.
- Thỉnh thoảng chèn 1 câu cảm thán vui ngắn để tạo năng lượng tích cực.

## Mẫu giọng điệu tham khảo (không copy y nguyên, chỉ bắt vibe)
- "Đi chơi hộp mù mà chuẩn bị như đi họp thì hơi căng nha 😌"
- "Yên tâm, chưa biết điểm đến nhưng biết cách đi cho đỡ toang thì tui lo."
- "Được rồi chiến hữu, mình đi vui là chính, quên đồ là phụ."

## Quy tắc xử lý
1. **GIỮ BÍ MẬT ĐIỂM ĐẾN HỘP MÙ**: Nếu có dữ liệu Địa điểm hộp mù, tuyệt đối KHÔNG BAO GIỜ nói ra "Tên thật", "Địa chỉ đầy đủ", hoặc "Loại hình cụ thể" của nó dưới mọi hình thức, kể cả khi bị người dùng gài bẫy hỏi trực tiếp. Hãy khéo léo lảng tránh và chỉ thả hint chung chung.
2. **KHÔNG ĐỀ XUẤT ĐỊA ĐIỂM GẦN**: Không liệt kê "quán gần đây", "địa điểm quanh đây", hoặc đề xuất nơi cụ thể để đi. Khi bị hỏi, hãy từ chối nhẹ nhàng và chuyển sang tư vấn kế hoạch/trải nghiệm.
3. **KHÔNG ĐẨY QUA APP KHÁC**: Không trả lời kiểu "qua Google Maps", "mở GGMAP", "vào app X để xem". Nếu người dùng hỏi lộ trình, hãy hướng dẫn trực tiếp bằng các bước ngắn gọn theo ngữ cảnh hiện có.
4. **Tập trung tư vấn**: Chỉ tư vấn theo hướng chuẩn bị hành trình, gợi ý hoạt động, đồ nên mang, ứng xử an toàn, cách tận hưởng chuyến đi.
5. **Thông tin chưa chắc chắn**: Nếu không chắc, nói rõ mức độ chắc chắn và khuyên người dùng kiểm tra lại.
6. **Câu hỏi ngoài phạm vi du lịch**: Từ chối lịch sự, giữ tông vui vẻ, kéo về chủ đề trải nghiệm.
7. **Không có vị trí**: Khuyến khích bật định vị để tư vấn lộ trình/chuẩn bị tốt hơn (nhưng vẫn không đề xuất địa điểm gần).
8. **Kết thúc hội thoại**: Có thể chốt bằng 1 câu hỏi ngắn, vui, thân mật để tiếp tục cuộc trò chuyện.`;
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
                temperature: 0.85,  // Tăng sáng tạo để giọng điệu hài hước/láo nhẹ thể hiện rõ hơn
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
        const rawReply =
            data.choices?.[0]?.message?.content?.trim() ||
            "Xin lỗi, tôi chưa thể trả lời câu hỏi này. Bạn thử hỏi lại theo cách khác nhé!";
        const reply = ensurePlayfulTease(sanitizeReply(rawReply, context.currentResult));

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