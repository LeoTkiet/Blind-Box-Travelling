import { NextRequest, NextResponse } from "next/server";
import { getWeather } from "@/lib/weather";
import { generateAIContent } from "@/lib/groq";
import type {
  Destination,
  BlindBoxExperiencePayload,
  APIError,
} from "@/types";

export async function POST(req: NextRequest) {
  try {
    // 1. Nhận destination từ Dev 3 (hoặc Dev 6 với group mode)
    const body = await req.json();
    let destination = body.destination as Destination | undefined;

    // Nếu không truyền destination thì tự lấy từ Supabase
    if (!destination) {
      const { getRandomDestination } = await import("@/lib/destination");
      destination = await getRandomDestination(body.category);
    }

    if (!destination || !destination.lat || !destination.lng) {
      const err: APIError = {
        code: "NO_DESTINATION",
        message: "Thiếu thông tin địa điểm (destination.lat / destination.lng)",
      };
      return NextResponse.json(err, { status: 400 });
    }

    // 2. Lấy thời tiết thật
    let weather;
    try {
      weather = await getWeather(destination.lat, destination.lng);
    } catch (e) {
      console.error("[Dev5] OpenWeather lỗi:", e);
      const err: APIError = {
        code: "WEATHER_FAILED",
        message: "Không thể lấy dữ liệu thời tiết.",
      };
      return NextResponse.json(err, { status: 502 });
    }
    let aiContent;
    try {
      aiContent = await generateAIContent(destination, weather);
    } catch (e) {
      console.error("[Dev5] Gemini lỗi:", e);
      const err: APIError = {
        code: "GEMINI_FAILED",
        message: "Không thể tạo nội dung AI.",
      };
      return NextResponse.json(err, { status: 502 });
    }

    // 4. Đóng gói payload — ẨN tên quán, chỉ trả tọa độ đích
    const payload: BlindBoxExperiencePayload = {
      destination: {
        lat: destination.lat,
        lng: destination.lng,
      },
      weather,
      ai_content: aiContent,
      reveal_data: {
        name: destination.name,
        category: destination.category,
        tags: destination.tags,
      },
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    console.error("[Dev5] Lỗi không xác định:", err);
    const apiErr: APIError = {
      code: "UNKNOWN",
      message: "Lỗi server không xác định.",
    };
    return NextResponse.json(apiErr, { status: 500 });
  }
}