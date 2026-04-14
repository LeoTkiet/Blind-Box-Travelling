import { supabase } from "@/lib/supabase";
import type { Destination } from "@/types";

export async function getRandomDestination(
  category?: string
): Promise<Destination> {
  // Query Supabase
  let query = supabase
    .from("locations")
    .select("id, name, lat, lng, category");

  // Lọc theo category nếu có
  if (category) {
    console.log("Đang tìm category:", category);
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error || !data || data.length === 0) {
    throw new Error("Không tìm thấy địa điểm nào!");
  }

  // Chọn ngẫu nhiên 1 địa điểm
  const random = data[Math.floor(Math.random() * data.length)];

  return {
    id: String(random.id),
    name: random.name,
    category: random.category,
    lat: random.lat,
    lng: random.lng,
    rating: 0,
    reviews_count: 0,
    tags: [random.category],
  };
}