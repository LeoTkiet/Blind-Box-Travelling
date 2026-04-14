// ============================================================
// lib/weather.ts — Dev 5: OpenWeatherMap Integration
// Gọi từ Server Action, KHÔNG dùng ở Client Component
// ============================================================

import type { WeatherData } from "@/types";

const OPENWEATHER_BASE = "https://api.openweathermap.org/data/2.5/weather";

// Map từ OpenWeather description sang tiếng Việt
const descriptionMap: Record<string, string> = {
  "clear sky": "trời nắng đẹp",
  "few clouds": "ít mây",
  "scattered clouds": "mây rải rác",
  "broken clouds": "nhiều mây",
  "overcast clouds": "trời âm u",
  "light rain": "mưa nhẹ",
  "moderate rain": "mưa vừa",
  "heavy intensity rain": "mưa to",
  "thunderstorm": "giông bão",
  "light snow": "tuyết nhẹ",
  "mist": "sương mù",
  "fog": "sương dày",
  "haze": "khói mù",
  "drizzle": "mưa phùn",
};

function toVietnamese(desc: string): string {
  const lower = desc.toLowerCase();
  return descriptionMap[lower] ?? desc;
}

export async function getWeather(
  lat: number,
  lng: number
): Promise<WeatherData> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENWEATHER_API_KEY chưa được cấu hình trong .env.local");
  }

  const url = new URL(OPENWEATHER_BASE);
  url.searchParams.set("lat", lat.toString());
  url.searchParams.set("lon", lng.toString());
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "metric");   // Celsius
  url.searchParams.set("lang", "vi");

  const res = await fetch(url.toString(), {
    next: { revalidate: 600 }, // cache 10 phút — thời tiết không thay đổi quá nhanh
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenWeather API lỗi ${res.status}: ${body}`);
  }

  const data = await res.json();

  return {
    temperature: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    description: toVietnamese(data.weather[0]?.description ?? ""),
    icon: data.weather[0]?.icon ?? "01d",
    humidity: data.main.humidity,
    wind_speed: data.wind.speed,
  };
}

// ---- MOCK dùng khi Dev 3 chưa xong (tuần 1) ----
export function getMockWeather(): WeatherData {
  return {
    temperature: 32,
    feels_like: 36,
    description: "trời nắng đẹp",
    icon: "01d",
    humidity: 75,
    wind_speed: 2.5,
  };
}
