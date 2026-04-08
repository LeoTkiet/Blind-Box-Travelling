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
2. Ước tính chi phí trung bình cho 1 người (VND).
3. Gợi ý 3-5 vật dụng nên mang theo phù hợp với địa điểm VÀ thời tiết.

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
          role: "user",
          content: buildPrompt(destination, weather),
        },
      ],
      temperature: 0.8,
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