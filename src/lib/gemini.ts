import type { Destination, WeatherData, AIGeneratedContent } from "@/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

interface GeminiRawOutput {
  riddle: string;
  estimated_cost: string;
  items_to_bring: string[];
}

function buildPrompt(destination: Destination, weather: WeatherData): string {
  return `
Bạn là trợ lý cho ứng dụng du lịch bí ẩn "Blind Box Travelling".

Thông tin địa điểm đích (BÍ MẬT - không được tiết lộ):
- Tên: ${destination.name}
- Thể loại: ${destination.category}
- Tags mô tả: ${destination.tags.join(", ")}

Thông tin thời tiết hiện tại tại địa điểm:
- Nhiệt độ: ${weather.temperature}°C (cảm giác như ${weather.feels_like}°C)
- Trạng thái: ${weather.description}
- Độ ẩm: ${weather.humidity}%

Nhiệm vụ của bạn:
1. Viết 1 câu đố vui, thú vị gồm ĐÚNG 30 từ bằng tiếng Việt, gợi ý về địa điểm mà KHÔNG được nhắc trực tiếp tên hoặc địa chỉ.
2. Ước tính chi phí trung bình cho 1 người khi đến địa điểm này (tính bằng VND).
3. Gợi ý 3-5 vật dụng nên mang theo, phù hợp với thể loại địa điểm VÀ thời tiết hiện tại.

QUAN TRỌNG: Trả về DUY NHẤT một JSON hợp lệ, không có text hay markdown xung quanh. Cấu trúc:
{
  "riddle": "câu đố 30 từ ở đây",
  "estimated_cost": "XX.000 - YY.000 VND",
  "items_to_bring": ["vật dụng 1", "vật dụng 2", "vật dụng 3"]
}
`.trim();
}

export async function generateAIContent(
  destination: Destination,
  weather: WeatherData
): Promise<AIGeneratedContent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY chưa được cấu hình trong .env.local");
  }

  const prompt = buildPrompt(destination, weather);

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 8192,
    },
  };

  const res = await fetch(`${GEMINI_BASE}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API lỗi ${res.status}: ${errBody}`);
  }

  const data = await res.json();

  const rawText: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  let parsed: GeminiRawOutput;
  try {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error(`Không tìm thấy JSON: ${rawText}`);
    }
    const cleaned = rawText.slice(start, end + 1);
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini trả về không đúng định dạng JSON: ${rawText}`);
  }

  if (!parsed.riddle || !parsed.estimated_cost || !Array.isArray(parsed.items_to_bring)) {
    throw new Error("Gemini thiếu trường dữ liệu bắt buộc trong JSON trả về");
  }

  return {
    riddle: parsed.riddle,
    estimated_cost: parsed.estimated_cost,
    items_to_bring: parsed.items_to_bring,
  };
}