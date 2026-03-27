import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Haversine distance in km
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(request: Request) {
  try {
    const { lat, lng, radius, category } = await request.json();

    if (!lat || !lng || !radius) {
      return NextResponse.json({ error: "Thiếu thông tin vị trí." }, { status: 400 });
    }

    const supabase = await createClient();

    // Query locations from Supabase
    // NOTE: Update table name and column names to match your Supabase schema
    let query = supabase
      .from("locations")
      .select("name, lat, lng, rating, reviews_count, category")
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    const { data: locations, error: dbError } = await query;

    if (dbError) {
      console.error("Supabase error:", dbError);
      return NextResponse.json({ error: "Lỗi truy vấn cơ sở dữ liệu." }, { status: 500 });
    }

    if (!locations || locations.length === 0) {
      return NextResponse.json({ error: "Không có dữ liệu địa điểm." }, { status: 404 });
    }

    // Filter by radius using Haversine
    const nearby = locations.filter((loc) => {
      const dist = haversine(lat, lng, loc.lat, loc.lng);
      return dist <= radius;
    });

    if (nearby.length === 0) {
      return NextResponse.json({ error: `Không tìm thấy địa điểm trong bán kính ${radius} km. Hãy thử tăng khoảng cách.` }, { status: 404 });
    }

    // ── Hidden Gem Scoring Algorithm ──
    const maxReviews = Math.max(...nearby.map((l) => l.reviews_count ?? 0), 1);

    const scored = nearby.map((loc) => {
      const rating = loc.rating ?? 0;
      const reviewsCount = loc.reviews_count ?? 0;

      // Quality score: higher rating = higher score (0–1)
      const qualityScore = rating / 5.0;

      // Anonymity score: fewer reviews = higher score (0–1)
      // Uses log scale so a place with 10 reviews vs 1000 reviews is meaningfully different
      const anonymityScore = 1 - Math.log10(reviewsCount + 1) / Math.log10(maxReviews + 1);

      // Random factor for surprise element (0–1)
      const randomScore = Math.random();

      // Weighted total: 40% quality + 40% anonymity + 20% random
      const totalScore = qualityScore * 0.4 + anonymityScore * 0.4 + randomScore * 0.2;

      return { ...loc, _score: totalScore };
    });

    // Sort descending and return the top result
    scored.sort((a, b) => b._score - a._score);
    const winner = scored[0];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _score, ...location } = winner;

    return NextResponse.json({ location });
  } catch (err) {
    console.error("blind-box API error:", err);
    return NextResponse.json({ error: "Có lỗi xảy ra. Vui lòng thử lại." }, { status: 500 });
  }
}
