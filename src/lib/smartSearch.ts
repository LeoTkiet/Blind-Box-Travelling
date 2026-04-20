// ============================================================
// lib/smartSearch.ts — Module 8: Smart Location Search Engine
// Pipeline 3 tầng: LLM Parser → Smart Filter → Geo-Semantic Rerank
// ============================================================

// --------------- TYPES ---------------

export interface SmartSearchInput {
  query: string;            // Câu hỏi tự do của user
  selectedTags: string[];   // Các category badge đã chọn (VD: ["cafe", "restaurant"])
  lat: number;
  lng: number;
  radius: number;           // km
}

export interface ParsedIntent {
  price: string[];          // VD: ["bình dân", "tầm trung"]
  time: string[];           // VD: ["buổi tối", "về đêm"]
  audience: string[];       // VD: ["cặp đôi"]
  highlight: string[];      // VD: ["view đẹp", "sống ảo"]
  categories: string[];     // VD: ["cafe", "restaurant"] — from badge + AI inference
  search_document: string;  // Cô đọng ý nghĩa câu query thành 1 đoạn ngắn
}

export interface ScoredLocation {
  name: string;
  category: string;
  lat: number;
  lng: number;
  rating: number;
  reviews_count: number;
  tags_price: string[] | null;
  tags_location: string[] | null;
  tags_audience: string[] | null;
  tags_time: string[] | null;
  tags_highlight: string[] | null;
  search_document: string | null;
  embedding: number[] | null;
  address?: string;
  photo_url?: string;
  _score: number;
  _penalty: number;
  _relaxLevel: number;
}

// --------------- TIER 1: LLM QUERY PARSER ---------------

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

export async function parseQueryWithLLM(
  query: string,
  selectedTags: string[]
): Promise<ParsedIntent> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY chưa được cấu hình");

  const systemPrompt = `Bạn là bộ phân tích câu hỏi tìm kiếm địa điểm du lịch/ẩm thực tại Việt Nam.
Nhiệm vụ: Phân tích câu hỏi của người dùng và trích xuất các thuộc tính sau.

Quy tắc giá trị cho từng trường:
- price: chỉ dùng trong ["miễn phí", "bình dân", "tầm trung", "cao cấp"]
- time: chỉ dùng trong ["buổi sáng", "buổi trưa", "buổi chiều", "buổi tối", "về đêm", "cả ngày", "cuối tuần"]
- audience: chỉ dùng trong ["cặp đôi", "gia đình", "bạn bè", "một mình", "trẻ em", "công việc", "du khách"]
- highlight: tự do — các điểm nổi bật như "view đẹp", "sống ảo", "yên tĩnh", "không gian rộng", "đồ ăn ngon", "truyền thống"...
- categories: loại hình địa điểm. Chỉ dùng trong ["restaurant", "cafe", "bar/pub", "bakery", "hotel", "hostel", "homestay", "attraction", "museum", "pagoda/temple", "park", "market", "shopping_mall", "souvenir_shop", "entertainment", "spa/wellness", "sports", "theme_park", "beach", "viewpoint", "nature", "transport_hub", "event_venue"]
- search_document: viết 1 câu ngắn gon 15-25 từ tiếng Việt cô đọng ý nghĩa tìm kiếm.

Nếu người dùng đã chọn category badge: ${selectedTags.length > 0 ? selectedTags.join(', ') : 'chưa chọn'}, hãy ưu tiên giữ nguyên.

Trả về DUY NHẤT JSON, không giải thích:
{
  "price": [],
  "time": [],
  "audience": [],
  "highlight": [],
  "categories": [],
  "search_document": ""
}`;

  const res = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      temperature: 0.3,
      max_tokens: 512,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq LLM Parser lỗi ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const rawText: string = data?.choices?.[0]?.message?.content ?? "";

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Groq trả về JSON không hợp lệ: ${rawText}`);
  }

  // Merge selectedTags vào categories (đảm bảo không trùng)
  const mergedCategories = Array.from(
    new Set([...(parsed.categories || []), ...selectedTags.filter((t) => t !== "all")])
  );

  return {
    price: parsed.price || [],
    time: parsed.time || [],
    audience: parsed.audience || [],
    highlight: parsed.highlight || [],
    categories: mergedCategories,
    search_document: parsed.search_document || query,
  };
}

// --------------- TIER 2: SMART FILTER & 4-LEVEL RELAXATION ---------------

import { createClient } from "@/utils/supabase/server";

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Kiểm tra overlap giữa 2 mảng tag (case-insensitive)
function tagsOverlap(locationTags: string[] | null, filterTags: string[]): boolean {
  if (!locationTags || locationTags.length === 0 || filterTags.length === 0) return true; // no filter = pass
  const normalizedLoc = locationTags.map((t) => t.toLowerCase().trim());
  return filterTags.some((f) => normalizedLoc.includes(f.toLowerCase().trim()));
}

interface FilterResult {
  locations: ScoredLocation[];
  relaxLevel: number;
}

export async function smartFilter(
  intent: ParsedIntent,
  lat: number,
  lng: number,
  radius: number
): Promise<FilterResult> {
  const supabase = await createClient();

  // Build base query — lấy tất cả cột cần thiết
  let query = supabase
    .from("locations")
    .select(
      "name, category, lat, lng, rating, reviews_count, tags_price, tags_location, tags_audience, tags_time, tags_highlight, search_document, embedding"
    )
    .not("lat", "is", null)
    .not("lng", "is", null);

  // Lọc category ở cấp Database (nhanh nhất)
  if (intent.categories.length > 0) {
    query = query.in("category", intent.categories);
  }

  const { data: rawLocations, error } = await query;

  if (error) throw new Error(`DB error: ${error.message}`);
  if (!rawLocations || rawLocations.length === 0) {
    return { locations: [], relaxLevel: -1 };
  }

  // Lọc Distance trên RAM (Haversine)
  const nearby = rawLocations.filter(
    (loc) => haversine(lat, lng, loc.lat, loc.lng) <= radius
  );

  if (nearby.length === 0) {
    return { locations: [], relaxLevel: -1 };
  }

  // === 4-Level Relaxation ===
  const MIN_RESULTS = 5;

  // Level 0: Full filter (price + time + audience + highlight)
  // Level 1: Bỏ highlight
  // Level 2: Bỏ highlight + audience
  // Level 3: Bỏ highlight + audience + time (chỉ giữ price)
  // Level 4: Bỏ hết tag filter, chỉ giữ category + distance

  for (let level = 0; level <= 4; level++) {
    const filtered = nearby.filter((loc) => {
      if (level < 4 && intent.price.length > 0 && !tagsOverlap(loc.tags_price, intent.price)) return false;
      if (level < 3 && intent.time.length > 0 && !tagsOverlap(loc.tags_time, intent.time)) return false;
      if (level < 2 && intent.audience.length > 0 && !tagsOverlap(loc.tags_audience, intent.audience)) return false;
      if (level < 1 && intent.highlight.length > 0 && !tagsOverlap(loc.tags_highlight, intent.highlight)) return false;
      return true;
    });

    if (filtered.length >= MIN_RESULTS || level === 4) {
      // Gắn penalty tương ứng relaxation level
      const scored: ScoredLocation[] = filtered.map((loc) => ({
        ...loc,
        embedding: parseEmbedding(loc.embedding),
        _score: 0,
        _penalty: level * 0.08, // Mỗi cấp nới lỏng bị phạt 0.08 điểm
        _relaxLevel: level,
      }));
      return { locations: scored, relaxLevel: level };
    }
  }

  // Fallback cuối: trả về tất cả nearby
  return {
    locations: nearby.map((loc) => ({
      ...loc,
      embedding: parseEmbedding(loc.embedding),
      _score: 0,
      _penalty: 0.4,
      _relaxLevel: 4,
    })),
    relaxLevel: 4,
  };
}

// Parse embedding from DB (có thể là string "[0.1,0.2,...]" hoặc array)
function parseEmbedding(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

// --------------- TIER 3: GEO-SEMANTIC RERANK ---------------

// Gọi Gemini Embedding API
async function getQueryEmbedding(searchDocument: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY chưa được cấu hình");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey.trim()}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: searchDocument }] },
      taskType: "SEMANTIC_SIMILARITY",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini Embedding lỗi ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.embedding?.values || [];
}

// Cosine Similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export async function geoSemanticRerank(
  locations: ScoredLocation[],
  intent: ParsedIntent,
  lat: number,
  lng: number,
  radius: number
): Promise<ScoredLocation[]> {
  // Lấy query embedding
  let queryEmbedding: number[] = [];
  try {
    queryEmbedding = await getQueryEmbedding(intent.search_document);
  } catch (err) {
    console.warn("⚠️ Gemini embedding failed, falling back to tag-only scoring:", err);
  }

  return locations.map((loc) => {
    // --- Semantic Score (0-1) ---
    let semanticScore = 0;
    if (queryEmbedding.length > 0 && loc.embedding) {
      semanticScore = Math.max(0, cosineSimilarity(queryEmbedding, loc.embedding));
    }

    // --- Rigid Score (tag + quality + distance) ---
    // Quality sub-score (Bayesian-like, 0-1)
    const rating = loc.rating ?? 0;
    const reviewsCount = loc.reviews_count ?? 0;
    const C = 15;
    const m = 3.5; // baseline
    const bayesian = (reviewsCount * rating + C * m) / (reviewsCount + C);
    const qualityScore = bayesian / 5.0;

    // Distance sub-score (closer = better, 0-1)
    const dist = haversine(lat, lng, loc.lat, loc.lng);
    const distScore = Math.max(0, 1 - dist / radius);

    // Tag match bonus (how many tag dimensions match, 0-1)
    let tagMatches = 0;
    let tagTotal = 0;
    if (intent.price.length > 0) { tagTotal++; if (tagsOverlap(loc.tags_price, intent.price)) tagMatches++; }
    if (intent.time.length > 0) { tagTotal++; if (tagsOverlap(loc.tags_time, intent.time)) tagMatches++; }
    if (intent.audience.length > 0) { tagTotal++; if (tagsOverlap(loc.tags_audience, intent.audience)) tagMatches++; }
    if (intent.highlight.length > 0) { tagTotal++; if (tagsOverlap(loc.tags_highlight, intent.highlight)) tagMatches++; }
    const tagScore = tagTotal > 0 ? tagMatches / tagTotal : 0.5;

    // Rigid = Quality(40%) + Distance(30%) + TagMatch(30%)
    const rigidScore = qualityScore * 0.4 + distScore * 0.3 + tagScore * 0.3;

    // --- Final Score ---
    // Semantic(70%) + Rigid(30%) - Penalty
    const hasEmbedding = queryEmbedding.length > 0 && loc.embedding;
    const finalScore = hasEmbedding
      ? semanticScore * 0.7 + rigidScore * 0.3 - loc._penalty
      : rigidScore - loc._penalty; // Fallback nếu không có embedding

    return { ...loc, _score: finalScore };
  });
}

// --------------- ORCHESTRATOR ---------------

export interface SmartSearchResult {
  location: {
    name: string;
    category: string;
    lat: number;
    lng: number;
    rating: number;
    reviews_count: number;
    address?: string;
    photo_url?: string;
  };
  relaxLevel: number; // 0 = exact match, >0 = relaxed
  debug?: {
    totalCandidates: number;
    top5Scores: number[];
  };
}

export async function runSmartSearch(input: SmartSearchInput): Promise<SmartSearchResult> {
  // Tier 1: LLM Parse
  const intent = await parseQueryWithLLM(input.query, input.selectedTags);
  console.log("[SmartSearch] Tier 1 — Parsed Intent:", JSON.stringify(intent));

  // Tier 2: Smart Filter
  const { locations: candidates, relaxLevel } = await smartFilter(
    intent,
    input.lat,
    input.lng,
    input.radius
  );

  if (candidates.length === 0) {
    throw new Error("Không tìm thấy địa điểm nào phù hợp. Hãy thử tăng khoảng cách hoặc thay đổi tiêu chí.");
  }

  console.log(`[SmartSearch] Tier 2 — ${candidates.length} candidates, relaxLevel=${relaxLevel}`);

  // Tier 3: Geo-Semantic Rerank
  const ranked = await geoSemanticRerank(candidates, intent, input.lat, input.lng, input.radius);

  // Sort descending
  ranked.sort((a, b) => b._score - a._score);

  // Top 5 → Random 1 (Blind Box packaging)
  const top5 = ranked.slice(0, Math.min(5, ranked.length));
  const winner = top5[Math.floor(Math.random() * top5.length)];

  console.log(`[SmartSearch] Tier 3 — Top 5 scores: [${top5.map((l) => l._score.toFixed(3)).join(", ")}]`);
  console.log(`[SmartSearch] 🎲 Winner: "${winner.name}" (score=${winner._score.toFixed(3)})`);

  return {
    location: {
      name: winner.name,
      category: winner.category,
      lat: winner.lat,
      lng: winner.lng,
      rating: winner.rating ?? 0,
      reviews_count: winner.reviews_count ?? 0,
    },
    relaxLevel: winner._relaxLevel,
    debug: {
      totalCandidates: candidates.length,
      top5Scores: top5.map((l) => parseFloat(l._score.toFixed(3))),
    },
  };
}
