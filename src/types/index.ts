// ============================================================
// SHARED TYPES — Dev 5 Module (AI & API Integration)
// Dùng chung với Dev 3 (input) và Dev 4 / Dev 7 (output)
// ============================================================

// ---- INPUT: nhận từ Dev 3 ----
export interface Destination {
  id: string;
  name: string;        // tên thật quán (giấu với user cho đến khi đến nơi)
  category: string;    // e.g. "cafe", "restaurant", "park"
  lat: number;
  lng: number;
  rating: number;
  reviews_count: number;
  tags: string[];
}

// ---- WEATHER ----
export interface WeatherData {
  temperature: number;      // Celsius
  feels_like: number;
  description: string;      // e.g. "mưa nhẹ", "trời nắng"
  icon: string;             // OpenWeather icon code
  humidity: number;
  wind_speed: number;
}

// ---- AI OUTPUT từ Gemini ----
export interface AIGeneratedContent {
  riddle: string;           // câu đố 30 từ, không tiết lộ tên quán
  estimated_cost: string;   // e.g. "50.000 - 100.000 VND"
  items_to_bring: string[]; // e.g. ["ô dù", "kem chống nắng", "tiền mặt"]
}

// ---- OUTPUT: trả về cho Dev 4 & Dev 7 ----
export interface BlindBoxExperiencePayload {
  destination: {
    lat: number;
    lng: number;
    // name bị ẩn — chỉ reveal khi user đến trong vòng 200m
  };
  weather: WeatherData;
  ai_content: AIGeneratedContent;
  // reveal_token: dùng để Dev 7 unlock khi đến nơi
  reveal_data: {
    name: string;
    category: string;
    tags: string[];
  };
}

// ---- ERROR ----
export interface APIError {
  code: "WEATHER_FAILED" | "GEMINI_FAILED" | "NO_DESTINATION" | "UNKNOWN";
  message: string;
}
