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

// --------------- CACHE SYSTEM ---------------
// Simple in-memory LRU-like cache mechanisms
const intentCache = new Map<string, ParsedIntent>();
const embeddingCache = new Map<string, number[]>();

function setCache<T>(cache: Map<string, T>, key: string, value: T, maxItems = 200) {
  if (cache.size >= maxItems) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, value);
}

// --------------- TIER 1: LLM QUERY PARSER ---------------

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

export async function parseQueryWithLLM(
  query: string,
  selectedTags: string[]
): Promise<ParsedIntent> {
  const cacheKey = `${query.trim().toLowerCase()}_${selectedTags.join('|')}`;
  if (intentCache.has(cacheKey)) {
    console.log("[SmartSearch] Tier 1 — Cache Hit for query:", query);
    return intentCache.get(cacheKey)!;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY chưa được cấu hình");

  const systemPrompt = `Phân tích query tìm kiếm địa điểm VN & xuất JSON. Không giải thích.

ENUMS HỢP LỆ:
- price: ["miễn phí", "bình dân", "tầm trung", "cao cấp"] (rẻ/sinh viên->bình dân, đắt/sang->cao cấp)
- time: ["buổi sáng", "buổi trưa", "buổi chiều", "buổi tối", "về đêm", "cả ngày", "cuối tuần"] (khuya->về đêm, khuya muộn->về đêm)
- audience: ["cặp đôi", "gia đình", "bạn bè", "một mình", "trẻ em", "công việc", "du khách"] (hẹn hò->cặp đôi, họp/bàn việc->công việc)
- highlight: Mảng tự do (2-4 từ/tag). Bắt cả ý ngầm (vd: "chụp hình" -> "sống ảo").
- categories: ["restaurant","cafe","bar/pub","bakery","hotel","hostel","homestay","attraction","museum","pagoda/temple","park","market","shopping_mall","souvenir_shop","entertainment","spa/wellness","sports","theme_park","beach","viewpoint","nature","transport_hub","event_venue"]
Map ngầm Category:
- "Ăn/Nhậu": phở, cơm, ăn sáng, nướng, lẩu, hải sản -> "restaurant"
- "Lưu trú": ngủ, qua đêm, nghỉ ngơi -> "hotel" hoặc "homestay"
- "Làm đẹp": gội đầu, massage, xông hơi -> "spa/wellness"
- "Giải trí": bida, banh bàn, karaoke, xem phim -> "entertainment"
- "Cảnh quan": ngắm hoàng hôn, ngắm cảnh, đỉnh, đồi -> "viewpoint"
- "Tâm linh": cầu duyên, khấn phật, đền chùa -> "pagoda/temple"
- Tự nhiên: thác, suối, cắm trại -> "nature"
LƯU Ý: Nếu câu hỏi quá chung chung (VD: "chỗ thư giãn", "đi chơi") -> BỎ TRỐNG categories [].

QUY TẮC:
1. Chỉ lấy ý trong query, không bịa. Trống -> [].
2. Phân biệt ý chính/phụ: "cafe đồ ăn ngon" -> cat:["cafe"], highlight:["đồ ăn ngon"].
3. Đảo ngược phủ định: "không đắt" -> price:["tầm trung"], "không ồn" -> highlight:["yên tĩnh"].
4. Category user chọn: [${selectedTags.join() || 'trống'}]. Ưu tiên & gộp kết quả suy luận vào mảng này.
5. "search_document": Câu TV tự nhiên 15-25 từ mô tả ĐẦY ĐỦ yêu cầu (loại hình, không gian, giá, đối tượng) để search Vercel/Faiss. KHÔNG liệt kê tag.

YÊU CẦU ĐẦU RA DUY NHẤT:
{"price":[],"time":[],"audience":[],"highlight":[],"categories":[],"search_document":"..."}`;

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
      temperature: 0.2,
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

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Groq trả về JSON không hợp lệ: ${rawText}`);
  }

  // Ensure type safety (force convert string/object to array if LLM hallucinates schema)
  const ensureArray = (val: any) => Array.isArray(val) ? val : (typeof val === 'string' && val.trim() !== '' ? [val] : []);

  // Merge selectedTags vào categories (đảm bảo không trùng)
  const safeCategories = ensureArray(parsed.categories);
  const mergedCategories = Array.from(
    new Set([...safeCategories, ...selectedTags.filter((t) => t !== "all")])
  );

  const intentResult: ParsedIntent = {
    price: ensureArray(parsed.price),
    time: ensureArray(parsed.time),
    audience: ensureArray(parsed.audience),
    highlight: ensureArray(parsed.highlight),
    categories: mergedCategories,
    search_document: typeof parsed.search_document === 'string' ? parsed.search_document : query,
  };

  setCache(intentCache, cacheKey, intentResult);
  return intentResult;
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
  if (!filterTags || filterTags.length === 0) return true; // user no filter = pass
  if (!locationTags || locationTags.length === 0) return false; // filter required but location has no info -> fail
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

  // Build base query
  let supabaseQuery = supabase
    .from("locations")
    .select(
      "name, category, lat, lng, rating, reviews_count, tags_price, tags_location, tags_audience, tags_time, tags_highlight, search_document, embedding"
    )
    .not("lat", "is", null)
    .not("lng", "is", null);

  // Bounding Box Optimization
  // 1 vĩ độ (latitude) = ~111 km. 1 kinh độ (longitude) = ~111*cos(lat) km.
  const latRadian = (lat * Math.PI) / 180;
  const dLat = radius / 111.0;
  const dLng = radius / (111.0 * Math.cos(latRadian));

  supabaseQuery = supabaseQuery
    .gte("lat", lat - dLat)
    .lte("lat", lat + dLat)
    .gte("lng", lng - dLng)
    .lte("lng", lng + dLng);

  // Lọc category ở cấp Database
  if (intent.categories.length > 0) {
    supabaseQuery = supabaseQuery.in("category", intent.categories);
  }

  // Thêm giới hạn row chống xì RAM nếu bbox ở TP dày đặc
  const { data: rawLocations, error } = await supabaseQuery.limit(3000);

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
      _penalty: 0.32,  // Thu hẹp nhẹ penalty level 4 (thay vì 0.4) để tránh rớt thẳng xuống dưới score threshold
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
  const cacheKey = searchDocument.trim();
  if (embeddingCache.has(cacheKey)) {
    console.log("[SmartSearch] Tier 3 — Cache Hit for embedding");
    return embeddingCache.get(cacheKey)!;
  }

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
  const values = data.embedding?.values || [];
  if (values.length > 0) {
    setCache(embeddingCache, cacheKey, values, 500); // Lưu 500 embeddings
  }
  return values;
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
  score: number;      // Final score of the selected location
  debug?: {
    totalCandidates: number;
    qualifiedCount: number;
    threshold: number;
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

  const hasAnyEmbedding = ranked.some((l) => l.embedding && l.embedding.length > 0);
  const MIN_SCORE_THRESHOLD = hasAnyEmbedding ? 0.15 : 0.10;

  const qualifiedResults = ranked.filter((l) => l._score >= MIN_SCORE_THRESHOLD);

  console.log(`[SmartSearch] Tier 3 — All scores: [${ranked.slice(0, 10).map((l) => l._score.toFixed(3)).join(", ")}${ranked.length > 10 ? '...' : ''}]`);
  console.log(`[SmartSearch] Threshold=${MIN_SCORE_THRESHOLD}, Qualified=${qualifiedResults.length}/${ranked.length}`);

  if (qualifiedResults.length === 0) {
    // Tất cả kết quả đều có điểm quá thấp — không trả về kết quả kém chất lượng
    const bestScore = ranked.length > 0 ? ranked[0]._score.toFixed(3) : 'N/A';
    throw new Error(
      `Không tìm thấy địa điểm phù hợp với yêu cầu của bạn (điểm cao nhất: ${bestScore}, ngưỡng: ${MIN_SCORE_THRESHOLD}). Hãy thử mô tả khác hoặc tăng khoảng cách tìm kiếm.`
    );
  }

  // Top 5 qualified → Random 1 (Blind Box packaging)
  const top5 = qualifiedResults.slice(0, Math.min(5, qualifiedResults.length));
  const winner = top5[Math.floor(Math.random() * top5.length)];

  console.log(`[SmartSearch] Top 5 qualified: [${top5.map((l) => `"${l.name}"(${l._score.toFixed(3)})`).join(", ")}]`);
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
    score: parseFloat(winner._score.toFixed(3)),
    debug: {
      totalCandidates: candidates.length,
      qualifiedCount: qualifiedResults.length,
      threshold: MIN_SCORE_THRESHOLD,
      top5Scores: top5.map((l) => parseFloat(l._score.toFixed(3))),
    },
  };
}
