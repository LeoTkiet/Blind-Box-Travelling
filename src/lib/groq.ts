"use server";

import type { Destination, WeatherData, AIGeneratedContent } from "@/types";
import { getWeather } from "./weather";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function buildPrompt(destination: Destination, weather: WeatherData): string {
  return `Bạn là trợ lý cho ứng dụng du lịch bí ẩn "Blind Box Travelling".

Thông tin địa điểm đích (BÍ MẬT - không được tiết lộ):
- Tên: ${destination.name}
- Thể loại: ${destination.category}
- Tags mô tả: ${(destination.tags || []).join(", ") || "Không xác định"}

Thông tin thời tiết hiện tại:
- Nhiệt độ: ${weather.temperature}°C (cảm giác như ${weather.feels_like}°C)
- Trạng thái: ${weather.description}
- Độ ẩm: ${weather.humidity}%

Nhiệm vụ:
1. Viết 1 câu đố vui gồm ĐÚNG 30 từ tiếng Việt, gợi ý về địa điểm mà KHÔNG tiết lộ tên.
2. Ước tính chi phí trung bình cho 1 người (VND), phù hợp với thể loại địa điểm.
3. Gợi ý 4-6 vật dụng nên mang theo, bắt buộc bám sát THỜI TIẾT + THỂ LOẠI địa điểm.

Yêu cầu chất lượng và ràng buộc:
- Không được tiết lộ hoặc nhắc trực tiếp tên địa điểm.
- Không được bịa thông tin không có trong dữ liệu đầu vào.
- Câu đố phải tự nhiên, dễ hiểu, không lặp từ vô nghĩa, không emoji.
- estimated_cost phải theo đúng định dạng: "XX.000 - YY.000 VND".
- items_to_bring phải là các vật dụng cụ thể, ngắn gọn, thực tế (mỗi item tối đa 6 từ), không trùng lặp.
- Không dùng item chung chung như "đồ cá nhân", "vật dụng cần thiết".

Quy tắc gợi ý vật dụng theo thời tiết (ưu tiên áp dụng):
- Nếu có mưa/ẩm cao (trạng thái có "mưa" hoặc độ ẩm >= 80): ưu tiên áo mưa, ô gấp, túi chống nước.
- Nếu nắng gắt/nhiệt độ >= 33 hoặc cảm giác >= 35: ưu tiên mũ, kem chống nắng, nước.
- Nếu lạnh (nhiệt độ <= 20): thêm áo khoác mỏng.
- Nếu di chuyển ngoài trời (attraction, park, beach, nature, viewpoint): ưu tiên giày thoải mái, nước, chống nắng/chống mưa.
- Nếu địa điểm ăn uống (restaurant, cafe, bar/pub, bakery): ưu tiên vật dụng nhẹ gọn, không liệt kê đồ cồng kềnh.

Trả về DUY NHẤT JSON hợp lệ, không có text hay markdown xung quanh:
{
  "riddle": "câu đố 30 từ",
  "estimated_cost": "XX.000 - YY.000 VND",
  "items_to_bring": ["vật dụng 1", "vật dụng 2", "vật dụng 3"]
}`;
}

export async function generateAIContent(
  destination: Destination,
  weather: WeatherData
): Promise<AIGeneratedContent> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY chưa được cấu hình trong .env.local");
  }

  const res = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Bạn là AI assistant chuyên tạo JSON chính xác cho ứng dụng du lịch. Luôn tuân thủ schema, không thêm giải thích ngoài JSON.",
        },
        {
          role: "user",
          content: buildPrompt(destination, weather),
        },
      ],
      temperature: 0.4,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq API lỗi ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const rawText: string = data?.choices?.[0]?.message?.content ?? "";

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Groq trả về không đúng định dạng JSON: ${rawText}`);
  }

  if (!parsed.riddle || !parsed.estimated_cost || !Array.isArray(parsed.items_to_bring)) {
    throw new Error("Groq thiếu trường dữ liệu bắt buộc");
  }

  return {
    riddle: parsed.riddle,
    estimated_cost: parsed.estimated_cost,
    items_to_bring: parsed.items_to_bring,
  };
}

export async function getBlindBoxAI(destination: Destination): Promise<AIGeneratedContent> {
  const weather = await getWeather(destination.lat, destination.lng);
  return generateAIContent(destination, weather);
}