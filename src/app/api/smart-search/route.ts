import { NextResponse } from "next/server";
import { runSmartSearch } from "@/lib/smartSearch";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, selectedTags, lat, lng, radius } = body;

    // Validate
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Vui lòng nhập yêu cầu tìm kiếm." },
        { status: 400 }
      );
    }
    if (!lat || !lng || !radius) {
      return NextResponse.json(
        { error: "Thiếu thông tin vị trí hoặc bán kính." },
        { status: 400 }
      );
    }

    const result = await runSmartSearch({
      query: query.trim(),
      selectedTags: Array.isArray(selectedTags) ? selectedTags : [],
      lat,
      lng,
      radius,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[smart-search] API error:", err);
    const message = err instanceof Error ? err.message : "Có lỗi xảy ra khi tìm kiếm.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
