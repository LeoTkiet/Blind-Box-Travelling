"use strict";

const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const Groq = require("groq-sdk");

// --- CẤU HÌNH ---

const CONFIG = {
  INPUT_FILE: "data/data.json",
  OUTPUT_FILE: "data/data_enriched.json",

  // Scraping
  MAX_REVIEWS: 15,
  MAX_REVIEW_LENGTH: 250,
  SLEEP_BETWEEN_ACTIONS: 1500,
  SLEEP_AFTER_NAVIGATE: 3500,
  SLEEP_BETWEEN_PLACES: 5000,
  ELEMENT_WAIT_TIMEOUT: 5000,

  // AI context
  AI_CONTEXT_REVIEW_LIMIT: 7,
  AI_CONTEXT_REVIEW_LIMIT_CLEAR_TYPE: 5,
  AI_CONTEXT_REVIEW_LIMIT_AMBIGUOUS: 8,

  // Rate limiting
  GROQ_RPM_PER_KEY: 8,
  POLLINATIONS_RPM_PER_TOKEN: 10,
  G4F_RPM: 15,

  // API call
  AI_CALL_TIMEOUT: 30000,
  KEY_COOLDOWN_MS: 5 * 60 * 1000,
  MAX_RETRIES_PER_KEY: 2,

  // Embed (Gemini)
  EMBED_MODEL: "gemini-embedding-001",
  VECTOR_FILE: "data/data_vectors.json",

  // Misc
  HEADLESS: false,
  VALID_CATEGORIES: [
    "restaurant", "cafe", "bar/pub", "bakery",
    "hotel", "hostel", "homestay",
    "attraction", "museum", "pagoda/temple", "park",
    "market", "shopping_mall", "souvenir_shop",
    "entertainment", "spa/wellness", "sports", "theme_park",
    "beach", "viewpoint", "nature",
    "transport_hub", "event_venue",
  ],

  // Mức giá hợp lệ cho tags_price
  VALID_PRICE_TAGS: ["miễn phí", "bình dân", "tầm trung", "cao cấp"],
};

const SCRAPE_STATUS = {
  SUCCESS: "success",
  NO_REVIEWS: "no_reviews",
  PLACE_NOT_FOUND: "place_not_found",
  ERROR: "error",
};

// --- KHỞI TẠO API KEYS ---

let externalKeys = { GROQ_API_KEYS: [], POLLINATIONS_TOKENS: [], GEMINI_API_KEY: "" };
try {
  if (fs.existsSync("api_keys.json")) {
    externalKeys = JSON.parse(fs.readFileSync("api_keys.json", "utf-8"));
  }
} catch {
  console.warn("⚠️  Không đọc được api_keys.json, dùng biến môi trường.");
}

function loadKeys(fromFile, envMulti, envSingle) {
  const raw = (fromFile || []).join(",") || process.env[envMulti] || process.env[envSingle] || "";
  return raw.split(",").map(k => k.trim()).filter(k => k && !k.includes("YOUR_"));
}

const groqKeys = loadKeys(externalKeys.GROQ_API_KEYS, "GROQ_API_KEYS", "GROQ_API_KEY");
const groqClients = groqKeys.map(key => new Groq({ apiKey: key }));

const geminiKey = externalKeys.GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
const groqAnalystClients = groqClients;
const keyStateAnalyst = groqAnalystClients.map(() => ({ cooldownUntil: 0 }));
const pollinationsTokens = loadKeys(externalKeys.POLLINATIONS_TOKENS, "POLLINATIONS_TOKENS", "POLLINATIONS_TOKEN");
if (pollinationsTokens.length === 0) pollinationsTokens.push("");
const g4fKeys = loadKeys(externalKeys.G4F_API_KEYS || [], "G4F_API_KEYS", "G4F_API_KEY");
if (g4fKeys.length === 0) g4fKeys.push("");

// --- BỘ KIỂM SOÁT TỐC ĐỘ (RATE LIMITER) ---

class RateLimiter {
  constructor(requestsPerMinute) {
    this.minIntervalMs = (60 * 1000) / requestsPerMinute;
    this.lastDoneTime = 0;
  }
  async throttle() {
    const elapsed = Date.now() - this.lastDoneTime;
    if (elapsed < this.minIntervalMs) await sleep(this.minIntervalMs - elapsed);
  }
  markDone() { this.lastDoneTime = Date.now(); }
}

const groqLimiter = new RateLimiter(Math.max(1, groqAnalystClients.length) * CONFIG.GROQ_RPM_PER_KEY);
const pollinationsLimiter = new RateLimiter(Math.max(1, pollinationsTokens.filter(t => t).length) * CONFIG.POLLINATIONS_RPM_PER_TOKEN);
const g4fLimiter = new RateLimiter(CONFIG.G4F_RPM);

// --- QUẢN LÝ KEY STATE & COOLDOWN ---

const keyState = {
  groq: groqAnalystClients.map(() => ({ cooldownUntil: 0 })),
  pollinations: pollinationsTokens.map(() => ({ cooldownUntil: 0 })),
  g4f: g4fKeys.map(() => ({ cooldownUntil: 0 })),
};
const rrCounters = { groq: 0, pollinations: 0, g4f: 0 };

function getAvailableClient(clients, states, aiName) {
  if (clients.length === 0) return null;
  const now = Date.now();
  const available = clients
    .map((client, i) => ({ client, i }))
    .filter(({ i }) => states[i].cooldownUntil <= now);
  if (available.length > 0) {
    const pick = available[rrCounters[aiName] % available.length];
    rrCounters[aiName]++;
    return { client: pick.client, index: pick.i, waitMs: 0 };
  }
  const soonestIdx = states.reduce(
    (best, s, i) => (s.cooldownUntil < states[best].cooldownUntil ? i : best), 0
  );
  return { client: clients[soonestIdx], index: soonestIdx, waitMs: states[soonestIdx].cooldownUntil - now };
}



function setCooldown(aiName, keyIndex) {
  if (keyState[aiName]?.[keyIndex]) {
    keyState[aiName][keyIndex].cooldownUntil = Date.now() + CONFIG.KEY_COOLDOWN_MS;
  }
}

function calcBackoffMs(attempt, baseMs = 2000, maxMs = 120000) {
  return Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 1000, maxMs);
}

// --- TIỆN ÍCH ---

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`Timeout: ${label} không phản hồi sau ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// --- XỬ LÝ LỖI API ---

function classifyAPIError(err) {
  const msg = err.message || "";
  const status = String(err.status || err.statusCode || err.code || "");
  const combined = `${msg} ${status}`;
  if (/401|403|invalid.*key|authentication/i.test(combined))
    return { type: "AUTH", detail: "API key không hợp lệ hoặc đã hết hạn" };
  if (/429|rate.?limit|quota|resource.?exhausted/i.test(combined))
    return { type: "RATE_LIMIT", detail: "Hết hạn ngạch (429)" };
  if (/500|502|503|504|unavailable|internal/i.test(combined))
    return { type: "SERVER", detail: "Lỗi phía server (5xx)" };
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|network/i.test(combined))
    return { type: "NETWORK", detail: "Lỗi mạng hoặc timeout" };
  if (/INVALID_JSON/i.test(msg))
    return { type: "PARSE", detail: `Không parse được JSON: ${msg.slice(0, 80)}` };
  return { type: "UNKNOWN", detail: msg || "Lỗi không xác định" };
}

const RETRYABLE_ERRORS = new Set(["RATE_LIMIT", "NETWORK", "SERVER", "PARSE"]);

const MAX_CONSECUTIVE_FAILURES = 3;
const aiErrorTracker = {
  groq: { consecutiveFailures: 0, lastError: null },
  pollinations: { consecutiveFailures: 0, lastError: null },
  g4f: { consecutiveFailures: 0, lastError: null },
};

function recordSuccess(aiName) {
  if (aiErrorTracker[aiName]) {
    aiErrorTracker[aiName].consecutiveFailures = 0;
    aiErrorTracker[aiName].lastError = null;
  }
}

function recordFailure(aiName, classified) {
  if (aiErrorTracker[aiName]) {
    aiErrorTracker[aiName].consecutiveFailures++;
    aiErrorTracker[aiName].lastError = classified;
  }
}

function isAIPersistentlyFailing(aiName) {
  return (aiErrorTracker[aiName]?.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_FAILURES;
}

// --- PARSE JSON TỪ KẾT QUẢ AI ---

function parseModelJSON(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) throw new Error("Empty model response");
  const deThought = raw
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .trim();
  const sanitized = deThought.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(sanitized); } catch { /* tiếp tục */ }
  for (let start = 0; start < sanitized.length; start++) {
    const open = sanitized[start];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < sanitized.length; i++) {
      const ch = sanitized[i];
      if (inStr) { esc = !esc && ch === "\\"; if (!esc && ch === "\"") inStr = false; continue; }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === open) depth++;
      if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(sanitized.slice(start, i + 1)); } catch { break; } } }
    }
  }
  throw new Error(`INVALID_JSON: ${sanitized.slice(0, 80)}`);
}

// --- CHUẨN HOÁ TAGS (NORMALIZE & SYNONYM) ---

const TAG_STOPWORDS = new Set([
  "hay", "tot", "ok", "tuyet voi", "dang di",
  "dia diem", "dia diem du lich", "khu vuc cong cong",
]);

const TAG_SYNONYMS = {
  "check-in": "chụp ảnh đẹp",
  "check in": "chụp ảnh đẹp",
  "chup anh check in": "chụp ảnh đẹp",
  "chup anh check-in": "chụp ảnh đẹp",
  "khach du lich": "du khách",
  "du khach nuoc ngoai": "du khách quốc tế",
  "quan ao": "mua sắm thời trang",
  "qua luu niem": "quà lưu niệm",
  "co phi": "có vé vào cổng",
  "nghi duong": "nghỉ dưỡng",
  "an ngon": "ẩm thực ngon",
  "gia re": "giá bình dân",
  "view dep": "view đẹp",
  "sang trong": "sang trọng",
  "thu gian": "thư giãn",
  "gia dinh": "gia đình",
  "cap doi": "cặp đôi",
  "ban be": "nhóm bạn",
};

function normalizeTag(tag) {
  if (typeof tag !== "string") return "";
  let raw = tag.toLowerCase().replace(/[^\p{L}\p{N}\-\s]/gu, "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length < 2) return "";
  let unaccented = normalizeText(raw).replace(/[^\w\-\s]/g, "");
  if (TAG_STOPWORDS.has(unaccented)) return "";
  if (TAG_SYNONYMS[unaccented]) return TAG_SYNONYMS[unaccented];
  return raw;
}

function normalizeTags(tags, maxCount = 10) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const t = normalizeTag(tag);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxCount) break;
  }
  return out;
}

// --- FALLBACK TAGS THEO CATEGORY ---

// Fallback price theo category khi AI không suy luận được
const CATEGORY_PRICE_FALLBACK = {
  "pagoda/temple": "miễn phí",
  "park": "miễn phí",
  "nature": "miễn phí",
  "viewpoint": "miễn phí",
  "beach": "miễn phí",
  "attraction": "tầm trung",
  "museum": "bình dân",
  "hostel": "bình dân",
  "market": "bình dân",
  "bakery": "bình dân",
  "souvenir_shop": "bình dân",
  "restaurant": "tầm trung",
  "cafe": "tầm trung",
  "bar/pub": "tầm trung",
  "entertainment": "tầm trung",
  "sports": "tầm trung",
  "shopping_mall": "tầm trung",
  "homestay": "tầm trung",
  "theme_park": "tầm trung",
  "event_venue": "tầm trung",
  "transport_hub": "bình dân",
  "hotel": "cao cấp",
  "spa/wellness": "cao cấp",
};

// Fallback structured tags theo category
const FALLBACK_STRUCTURED_TAGS = {
  restaurant: { highlight: ["ẩm thực địa phương"], audience: ["gia đình", "nhóm bạn"] },
  cafe: { highlight: ["không gian thư giãn"], audience: ["cặp đôi", "dân văn phòng"] },
  "bar/pub": { highlight: ["đồ uống đa dạng"], audience: ["nhóm bạn"], time: ["buổi tối", "về đêm"] },
  bakery: { highlight: ["bánh ngọt tươi"], audience: ["gia đình"] },
  hotel: { highlight: ["dịch vụ chuyên nghiệp"], audience: ["du khách", "công tác"] },
  hostel: { highlight: ["lưu trú giá rẻ"], audience: ["du khách ba lô", "sinh viên"] },
  homestay: { highlight: ["trải nghiệm địa phương"], audience: ["gia đình", "cặp đôi"] },
  attraction: { highlight: ["tham quan nổi tiếng"], audience: ["du khách", "gia đình"] },
  museum: { highlight: ["triển lãm lịch sử"], audience: ["học sinh", "du khách"] },
  "pagoda/temple": { highlight: ["kiến trúc cổ", "tâm linh"], audience: ["gia đình", "du khách"] },
  park: { highlight: ["không gian xanh"], audience: ["gia đình", "người cao tuổi"] },
  market: { highlight: ["ẩm thực đường phố"], audience: ["du khách", "dân địa phương"] },
  shopping_mall: { highlight: ["mua sắm đa dạng"], audience: ["gia đình", "bạn bè"] },
  souvenir_shop: { highlight: ["quà lưu niệm đặc trưng"], audience: ["du khách"] },
  entertainment: { highlight: ["giải trí đa dạng"], audience: ["nhóm bạn", "gia đình"] },
  "spa/wellness": { highlight: ["thư giãn trị liệu"], audience: ["cặp đôi", "người bận rộn"] },
  sports: { highlight: ["vận động sức khỏe"], audience: ["người trẻ", "gia đình"] },
  theme_park: { highlight: ["vui chơi giải trí"], audience: ["gia đình", "trẻ em"] },
  beach: { highlight: ["bãi biển nghỉ dưỡng"], audience: ["gia đình", "cặp đôi"] },
  viewpoint: { highlight: ["ngắm cảnh toàn cảnh"], audience: ["du khách", "cặp đôi"] },
  nature: { highlight: ["thiên nhiên hoang sơ"], audience: ["người thích khám phá"] },
  transport_hub: { highlight: ["điểm trung chuyển tiện lợi"], audience: ["du khách", "công tác"] },
  event_venue: { highlight: ["tổ chức sự kiện chuyên nghiệp"], audience: ["doanh nghiệp", "nhóm lớn"] },
};

function getFallbackStructuredTags(category) {
  const key = String(category || "").replace(/[\/-]/g, "_");
  return FALLBACK_STRUCTURED_TAGS[category] || { highlight: ["tham quan", "du lịch"], audience: ["du khách"] };
}

// PARSE TAGS_TIME TỪ OPENING_HOURS (RULE-BASED)
// Không để AI đoán — dùng dữ liệu có cấu trúc trực tiếp

function parseTagsTimeFromHours(openingHours) {
  if (!Array.isArray(openingHours) || openingHours.length === 0) return [];
  const tags = new Set();
  const allText = openingHours.join(" ");

  // Mở sáng sớm (trước 9AM)
  if (/\b[6-8]:\d{2}\s*AM/i.test(allText)) tags.add("buổi sáng");
  // Đóng muộn (sau 9PM)
  if (/\b(9|10|11):\d{2}\s*PM|\b12:\d{2}\s*AM/i.test(allText)) tags.add("về đêm");
  // Mở cả ngày
  if (/open 24|24\s*hour|24\/7/i.test(allText)) {
    tags.add("cả ngày");
    tags.add("về đêm");
  }
  // Đóng sau 8PM → buổi tối
  if (/\b[8-9]:\d{2}\s*PM/i.test(allText)) tags.add("buổi tối");

  return [...tags];
}

// XÂY DỰNG SEARCH DOCUMENT — để embed 1 vector duy nhất
// Kết hợp tất cả thông tin thành đoạn văn có ngữ cảnh

function buildSearchDocument(place) {
  const parts = [
    place.name,
    place.category,
    place.tags_highlight?.length ? place.tags_highlight.join(", ") : null,
    place.tags_location?.length ? place.tags_location.join(", ") : null,
    place.tags_audience?.length
      ? `phù hợp ${place.tags_audience.join(", ")}`
      : null,
    place.tags_time?.length
      ? `thích hợp ${place.tags_time.join(", ")}`
      : null,
    place.tags_price ?? null,
    // Giữ lại flat tags để backward compat với embedding cũ
    place.tags?.length ? place.tags.join(", ") : null,
  ].filter(Boolean);

  return parts.join(". ");
}

// --- VALIDATE KẾT QUẢ AI ---

function validateAIResult(raw, fallbackCategory) {
  if (!raw || typeof raw !== "object") return null;
  const result = { ...raw };

  // --- Validate category ---
  if (!CONFIG.VALID_CATEGORIES.includes(result.category)) {
    const safe = CONFIG.VALID_CATEGORIES.includes(fallbackCategory) ? fallbackCategory : "attraction";
    console.warn(`    ⚠️  Category "${result.category}" không hợp lệ → fallback "${safe}"`);
    result.category = safe;
  }

  // --- Validate tags_price (enum cứng) ---
  if (!CONFIG.VALID_PRICE_TAGS.includes(result.tags_price)) {
    const inferredPrice = CATEGORY_PRICE_FALLBACK[result.category] ?? "tầm trung";
    console.warn(`    ⚠️  tags_price "${result.tags_price}" không hợp lệ → infer từ category: "${inferredPrice}"`);
    result.tags_price = inferredPrice;
  }

  // --- Normalize các chiều tags ---
  result.tags_highlight = normalizeTags(result.tags_highlight || [], 3);
  result.tags_location = normalizeTags(result.tags_location || [], 3);
  result.tags_audience = normalizeTags(result.tags_audience || [], 3);
  // tags_time: ưu tiên dùng kết quả parse từ opening_hours (đã tính ở ngoài),
  // nếu chưa có thì dùng AI output
  if (!result._timeFromHours) {
    result.tags_time = normalizeTags(result.tags_time || [], 2);
  }

  // --- Fallback nếu thiếu highlight ---
  if (result.tags_highlight.length === 0) {
    const fb = getFallbackStructuredTags(result.category);
    result.tags_highlight = fb.highlight || [];
    console.warn(`    ⚠️  tags_highlight rỗng cho "${result.category}" → áp fallback`);
  }

  // --- Fallback nếu thiếu audience ---
  if (result.tags_audience.length === 0) {
    const fb = getFallbackStructuredTags(result.category);
    result.tags_audience = fb.audience || [];
  }

  // --- Tạo flat tags array (backward compat + dùng cho embedding) ---
  const flatSet = new Set([
    ...result.tags_highlight,
    ...result.tags_location,
    ...result.tags_audience,
    ...result.tags_time,
    result.tags_price,
  ].filter(Boolean));
  result.tags = [...flatSet];

  return result;
}

// --- SYSTEM INSTRUCTIONS CHO AI ---

const ANALYST_SYSTEM = `Bạn là chuyên gia phân tích địa điểm du lịch Việt Nam.
Đọc dữ liệu thực tế và sinh category + tags có cấu trúc (Tiếng Việt có dấu).
Ưu tiên: placeType Google Maps > bình luận > tên địa điểm.
CHỈ TRẢ VỀ JSON THUẦN, không giải thích.`;

const SUPERVISOR_SYSTEM = `Bạn là giám thị kiểm định dữ liệu địa điểm du lịch.
Nhận kết quả JSON từ Analyst. KHÔNG phân tích lại từ đầu, KHÔNG cần biết category là gì.
Chỉ kiểm tra từng trường: sửa nếu sai hoặc quá chung chung, giữ nguyên nếu ổn.
CHỈ TRẢ VỀ JSON THUẦN, không giải thích.`;

// --- XÂY DỰNG PROMPT ---

function buildAnalystPrompt(place, contextBlock) {
  const catList = CONFIG.VALID_CATEGORIES.map(c => `"${c}"`).join(", ");
  return `
Địa điểm: "${place.name}" (${place.lat}, ${place.lng})
Category gợi ý (có thể sai): "${place.category}"

${contextBlock}

Phân tích và trả về JSON với 6 trường:
1. "category": 1 trong: ${catList}
   Quy tắc: chùa/nhà thờ → "pagoda/temple" | chợ truyền thống → "market" | TTTM → "shopping_mall" | công trình lịch sử nổi tiếng → "attraction" | Đầm Sen/Suối Tiên → "theme_park"
2. "tags_price": 1 trong: "miễn phí" | "bình dân" | "tầm trung" | "cao cấp"
   (miễn phí=chùa/công viên, bình dân=<100k, tầm trung=100-500k, cao cấp=>500k)
3. "tags_location": mảng 1-3 tag — không gian, view, kiến trúc (vd: "ven sông", "tầng thượng", "trong hẻm")
4. "tags_audience": mảng 1-3 tag — đối tượng phù hợp (vd: "cặp đôi", "gia đình", "sinh viên")
5. "tags_time": mảng 1-2 tag — thời điểm phù hợp (vd: "buổi sáng", "về đêm", "cả ngày")
6. "tags_highlight": mảng 2-3 tag — điểm ĐẶC SẮC, KHÁC BIỆT nhất (vd: "buffet hải sản", "rooftop view Bitexco")
   TRÁNH: "tuyệt vời", "ok", "tốt", "đáng đi", "phục vụ tốt"

CHỈ JSON, không text khác.
`.trim();
}

function buildSupervisorPrompt(place, contextBlock, analystResult) {
  return `
Kiểm định kết quả sau cho địa điểm "${place.name}":
${JSON.stringify(analystResult, null, 2)}

Kiểm tra từng trường theo thứ tự:
- "tags_price": đúng 1 trong "miễn phí"|"bình dân"|"tầm trung"|"cao cấp" — sửa nếu sai thực tế
- "tags_location": có mô tả không gian/view đặc trưng không — sửa nếu quá chung chung
- "tags_audience": có đúng đối tượng không — sửa nếu không phù hợp
- "tags_time": có đúng thời điểm không — sửa nếu không phù hợp
- "tags_highlight": có ĐẶC SẮC, KHÁC BIỆT không — đây là trường quan trọng nhất, sửa nếu sáo rỗng
- "category": chỉ sửa nếu SAI RÕ RÀNG, không đoán lại

Trả về JSON 7 trường (giữ nguyên trường nào ổn):
"category", "tags_price", "tags_location", "tags_audience", "tags_time", "tags_highlight", "supervisorNote" (≤8 chữ)
CHỈ JSON, không text khác.
`.trim();
}

// --- --- ---

async function callGroq(prompt, systemInstruction, label) {
  if (groqClients.length === 0) return null;
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, groqAnalystClients.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await groqLimiter.throttle();
    const keyInfo = getAvailableClient(groqAnalystClients, keyState.groq, "groq");
    if (!keyInfo) return null;
    if (keyInfo.waitMs > 0) {
      console.warn(`    ⚠️ Groq: tất cả key đang cooldown, nhường cho Fallback...`);
      return null;
    }
    const { client: groq, index: keyIdx } = keyInfo;
    try {
      const res = await withTimeout(
        groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          max_tokens: 600,
          response_format: { type: "json_object" },
        }),
        CONFIG.AI_CALL_TIMEOUT, `Groq ${label}`
      );
      groqLimiter.markDone();
      const parsed = parseModelJSON(res.choices[0]?.message?.content || "{}");
      recordSuccess("groq");
      console.log(`    🔑 Groq key[${keyIdx}] OK`);
      return parsed;
    } catch (err) {
      groqLimiter.markDone();
      const classified = classifyAPIError(err);
      if (RETRYABLE_ERRORS.has(classified.type) && attempt < maxAttempts) {
        if (classified.type === "RATE_LIMIT") {
          setCooldown("groq", keyIdx);
          const ms = calcBackoffMs(attempt);
          console.warn(`    🔄 Groq key[${keyIdx}] 429 → cooldown | backoff ${(ms / 1000).toFixed(1)}s`);
          await sleep(ms);
        } else {
          const ms = calcBackoffMs(attempt, 1000, 30000);
          console.warn(`    🔄 Groq [${classified.type}] backoff ${(ms / 1000).toFixed(1)}s...`);
          await sleep(ms);
        }
        continue;
      }
      recordFailure("groq", classified);
      console.warn(`    ⚠️  Groq ${label} [${classified.type}]: ${classified.detail}`);
      if (isAIPersistentlyFailing("groq"))
        console.error(`    🔴 Groq lỗi liên tiếp ${aiErrorTracker.groq.consecutiveFailures}x`);
      return null;
    }
  }
  return null;
}

// --- CẤU HÌNH ---

const POLLINATIONS_MODELS = ["openai", "openai-fast"];
let pollinationsModelCursor = 0;

// --- CẤU HÌNH ---

const AI_FETCH_CONFIG = {
  pollinations: {
    models: ["openai", "openai-fast"], cursor: 0,
    keys: pollinationsTokens, limiter: pollinationsLimiter,
    url: "https://text.pollinations.ai/v1/chat/completions", seed: 42
  },
  g4f: {
    models: ["gpt-4o", "llama-3.3-70b", "deepseek-v3", "mistral-large", "gpt-4o-mini"], cursor: 0,
    keys: g4fKeys, limiter: g4fLimiter,
    url: "https://api.g4f.dev/v1/chat/completions"
  }
};

async function callFetchAI(aiName, prompt, systemInstruction, label) {
  const cfg = AI_FETCH_CONFIG[aiName];
  if (cfg.keys.length === 0) return null;
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, cfg.keys.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await cfg.limiter.throttle();
    const tokenInfo = getAvailableClient(cfg.keys, keyState[aiName], aiName);
    if (!tokenInfo) return null;
    if (tokenInfo.waitMs > 0) {
      console.warn(`    ⚠️ ${label}: tất cả token đang cooldown, nhường cho Fallback...`);
      return null;
    }
    const { client: token, index: tokenIdx } = tokenInfo;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const modelsToTry = [...cfg.models.slice(cfg.cursor), ...cfg.models.slice(0, cfg.cursor)];
    let parsedResult = null;
    for (const modelName of modelsToTry) {
      try {
        const bodyObj = {
          model: modelName,
          messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }],
          temperature: 0, max_tokens: 600, response_format: { type: "json_object" }
        };
        if (cfg.seed) bodyObj.seed = cfg.seed;

        const res = await withTimeout(
          fetch(cfg.url, { method: "POST", headers, body: JSON.stringify(bodyObj) }),
          CONFIG.AI_CALL_TIMEOUT, `${label} ${modelName}`
        );
        cfg.limiter.markDone();
        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429) { setCooldown(aiName, tokenIdx); break; }
          if (res.status === 404 || /not found|no endpoint/i.test(body)) continue;
          console.warn(`    ↪ ${label} "${modelName}" HTTP ${res.status}: ${body.slice(0, 60)}`);
          continue;
        }
        const data = await res.json();
        parsedResult = parseModelJSON(data?.choices?.[0]?.message?.content || "{}");
        const idx = cfg.models.indexOf(modelName);
        if (idx >= 0) cfg.cursor = (idx + 1) % cfg.models.length;
        break;
      } catch (modelErr) {
        cfg.limiter.markDone();
        const c = classifyAPIError(modelErr);
        if (c.type === "NETWORK" || c.type === "SERVER" || c.type === "PARSE") continue;
        break;
      }
    }
    if (parsedResult) { recordSuccess(aiName); console.log(`    ${aiName === "g4f" ? "🟢" : "🌸"} ${label} token[${tokenIdx}] OK`); return parsedResult; }
    if (attempt < maxAttempts) { const ms = calcBackoffMs(attempt, 1500, 30000); console.warn(`    🔄 ${label} retry backoff ${(ms / 1000).toFixed(1)}s...`); await sleep(ms); }
  }
  recordFailure(aiName, { type: "UNKNOWN", detail: "Tất cả token/model thất bại" });
  if (isAIPersistentlyFailing(aiName)) console.error(`    🔴 ${label} lỗi liên tiếp ${aiErrorTracker[aiName].consecutiveFailures}x`);
  return null;
}

// Giữ lại hàm bọc để gọi dễ hơn ở ngoài
async function callPollinations(prompt, systemInstruction, label) {
  return callFetchAI("pollinations", prompt, systemInstruction, label);
}

async function callG4F(prompt, systemInstruction, label) {
  return callFetchAI("g4f", prompt, systemInstruction, label);
}

const CLEAR_TYPE_HINTS = [
  "restaurant", "nha hang", "quan an", "food court",
  "cafe", "coffee", "tra sua",
  "hotel", "resort", "hostel", "homestay",
  "museum", "bao tang",
  "chua", "den", "nha tho", "thanh duong",
  "park", "cong vien",
  "market", "cho",
  "shopping mall", "trung tam thuong mai",
  "spa", "massage",
  "beach", "bai bien",
  "viewpoint", "diem ngam canh",
  "theme park", "cong vien nuoc",
  "transport", "ga", "ben xe", "ben tau",
];

function getDynamicReviewLimit(placeType) {
  const n = normalizeText(placeType);
  if (!n) return CONFIG.AI_CONTEXT_REVIEW_LIMIT_AMBIGUOUS;
  return CLEAR_TYPE_HINTS.some(h => n.includes(h))
    ? CONFIG.AI_CONTEXT_REVIEW_LIMIT_CLEAR_TYPE
    : CONFIG.AI_CONTEXT_REVIEW_LIMIT;
}

function buildReviewContext(place, scrapeResult) {
  const { status, reviews, placeType } = scrapeResult;
  const placeTypeInfo = placeType
    ? `\n- Loại hình trên Google Maps (RẤT ĐÁNG TIN CẬY): "${placeType}"`
    : "";

  switch (status) {
    case SCRAPE_STATUS.SUCCESS: {
      const limit = getDynamicReviewLimit(placeType);
      const selected = reviews.slice(0, limit);
      return {
        confidence: "high",
        contextBlock:
          `Thông tin bổ sung từ Google Maps:${placeTypeInfo}\n\n` +
          `Có ${reviews.length} bình luận; cung cấp ${selected.length} tiêu biểu:\n` +
          selected.map((r, i) => {
            const t = r.length > CONFIG.MAX_REVIEW_LENGTH ? r.slice(0, CONFIG.MAX_REVIEW_LENGTH) + "..." : r;
            return `${i + 1}. ${t}`;
          }).join("\n"),
      };
    }
    case SCRAPE_STATUS.NO_REVIEWS:
      return {
        confidence: placeType ? "medium" : "low",
        contextBlock:
          `Thông tin bổ sung từ Google Maps:${placeTypeInfo}\n\n` +
          `Địa điểm tồn tại trên Google Maps nhưng chưa có bình luận.\n` +
          `Hãy phân tích dựa trên tên địa điểm${placeType ? " và loại hình Google Maps" : ""}.`,
      };
    case SCRAPE_STATUS.PLACE_NOT_FOUND:
      return {
        confidence: "low",
        contextBlock:
          `Không tìm thấy địa điểm này trên Google Maps.\n` +
          `Hãy phân tích dựa trên tên địa điểm và category gợi ý.`,
      };
    default:
      return {
        confidence: "low",
        contextBlock:
          `Thông tin bổ sung từ Google Maps:${placeTypeInfo}\n\n` +
          `Cào dữ liệu gặp lỗi kỹ thuật, không thu thập được bình luận.\n` +
          `Hãy phân tích dựa trên tên địa điểm${placeType ? " và loại hình Google Maps" : ""}.`,
      };
  }
}

function buildDualFailureMessage() {
  const fmt = (name) => {
    const t = aiErrorTracker[name];
    return t?.lastError
      ? `${name}: [${t.lastError.type}] ${t.lastError.detail} (liên tiếp: ${t.consecutiveFailures}x)`
      : `${name}: không có key hoặc chưa cấu hình`;
  };
  return [
    "🛑 TẤT CẢ AI ĐỀU THẤT BẠI — DỪNG CHƯƠNG TRÌNH!",
    "─".repeat(50),
    `  • Analyst   : ${fmt("groq")} → ${fmt("g4f")}`,
    `  • Supervisor: ${fmt("pollinations")} → ${fmt("g4f")}`,
    "─".repeat(50),
    "Gợi ý: kiểm tra mạng, Groq key, Pollinations token rồi chạy lại.",
  ].join("\n");
}

async function analyzeWithAI(place, scrapeResult) {
  const { confidence, contextBlock } = buildReviewContext(place, scrapeResult);
  const timeTagsFromHours = parseTagsTimeFromHours(place.opening_hours || []);
  const analystPrompt = buildAnalystPrompt(place, contextBlock);

  // --- Bước 1: Phân tích ban đầu (Analyst) ---
  let analystSource = "groq";
  let analystRaw = await callGroq(analystPrompt, ANALYST_SYSTEM, "Analyst");
  if (!analystRaw) {
    console.warn("  🔁 Groq lỗi → G4F Analyst...");
    analystRaw = await callG4F(analystPrompt, ANALYST_SYSTEM, "Analyst");
    if (analystRaw) analystSource = "g4f";
  }

  if (analystRaw && timeTagsFromHours.length > 0) {
    analystRaw._timeFromHours = true;
    analystRaw.tags_time = timeTagsFromHours;
  }

  const analystResult = analystRaw ? validateAIResult(analystRaw, place.category) : null;
  if (!analystResult) throw new Error(buildDualFailureMessage());

  // --- Bước 2: Kiểm duyệt chéo (Supervisor) ---
  const supervisorPrompt = buildSupervisorPrompt(place, contextBlock, analystResult);
  let supervisorSource = "pollinations";
  let supervisorRaw = await callPollinations(supervisorPrompt, SUPERVISOR_SYSTEM, "Supervisor");

  if (!supervisorRaw) {
    console.warn("  🔁 Pollinations lỗi → G4F Supervisor...");
    supervisorRaw = await callG4F(supervisorPrompt, SUPERVISOR_SYSTEM, "Supervisor");
    if (supervisorRaw) supervisorSource = "g4f";
  }

  if (supervisorRaw && timeTagsFromHours.length > 0) {
    supervisorRaw._timeFromHours = true;
    supervisorRaw.tags_time = timeTagsFromHours;
  }

  const supervisorResult = supervisorRaw ? validateAIResult(supervisorRaw, analystResult.category) : null;

  let finalResult, aiSource, supervisorNote = "";

  if (supervisorResult) {
    supervisorNote = supervisorRaw.supervisorNote || "";
    const changed =
      supervisorResult.category !== analystResult.category ||
      supervisorResult.tags_price !== analystResult.tags_price ||
      JSON.stringify([...supervisorResult.tags_highlight].sort()) !==
      JSON.stringify([...analystResult.tags_highlight].sort());

    aiSource = changed ? `${analystSource}+${supervisorSource}-corrected` : `${analystSource}+${supervisorSource}-confirmed`;
    finalResult = {
      category: supervisorResult.category,
      tags_price: supervisorResult.tags_price,
      tags_location: supervisorResult.tags_location,
      tags_audience: supervisorResult.tags_audience,
      tags_time: supervisorResult.tags_time,
      tags_highlight: supervisorResult.tags_highlight,
      tags: supervisorResult.tags,
    };
  } else {
    console.warn("  ⚠️  Supervisor lỗi, dùng kết quả Analyst");
    aiSource = `${analystSource}-only`;
    finalResult = {
      category: analystResult.category,
      tags_price: analystResult.tags_price,
      tags_location: analystResult.tags_location,
      tags_audience: analystResult.tags_audience,
      tags_time: analystResult.tags_time,
      tags_highlight: analystResult.tags_highlight,
      tags: analystResult.tags,
    };
  }

  console.log(`  ✅ ${finalResult.category} [${aiSource}] price:${finalResult.tags_price} highlight:${finalResult.tags_highlight.join("|")}`);
  return { ...finalResult, confidence, aiSource, supervisorNote };
}

// --- SCRAPING - SELENIUM WebDriver ---

async function buildDriver() {
  const options = new chrome.Options();
  if (CONFIG.HEADLESS) options.addArguments("--headless=new");
  options.addArguments(
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1366,768",
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  options.excludeSwitches(["enable-automation"]);
  const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  console.log("\n🚀 WebDriver sẵn sàng.");
  return driver;
}

async function dismissGoogleConsent(driver) {
  try {
    const btns = await driver.findElements(By.css(
      "button[aria-label*='Accept all'], button[aria-label*='Reject all'], " +
      "form[action*='consent'] button, button[jsname='higCR']"
    ));
    if (btns.length > 0) {
      await btns[0].click();
      console.log("  🍪 Đã bỏ qua Google Consent.");
      await sleep(2000);
    }
  } catch { /* không có consent page */ }
}

async function isValidPlacePage(driver) {
  try {
    const url = await driver.getCurrentUrl();
    if (url.includes("/maps/place/") || url.includes("/place/")) return true;
    if (url.includes("/maps/search/") || url.includes("/search/")) {
      const results = await driver.findElements(
        By.css("a[href*='/maps/place/'], div[data-result-index='0'] a")
      );
      if (results.length > 0) {
        await results[0].click();
        await sleep(CONFIG.SLEEP_AFTER_NAVIGATE);
        const newUrl = await driver.getCurrentUrl();
        return newUrl.includes("/maps/place/") || newUrl.includes("/place/");
      }
    }
    return false;
  } catch { return false; }
}

async function hasAnyReviews(driver) {
  try {
    return await driver.executeScript(`
      const tabs = Array.from(document.querySelectorAll("button, div[role='tab']"));
      for (const t of tabs) {
        const text = (t.innerText || t.getAttribute('aria-label') || "").toLowerCase();
        if (text.includes("đánh giá") || text.includes("review")) return true;
      }
      return Array.from(document.querySelectorAll("[data-review-id]")).length > 0;
    `);
  } catch { return true; }
}

async function scrapeReviews(driver, place) {
  const { name, lat, lng } = place;
  await driver.get(`https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`);
  await sleep(CONFIG.SLEEP_AFTER_NAVIGATE);
  await dismissGoogleConsent(driver);

  if (!await isValidPlacePage(driver))
    return { status: SCRAPE_STATUS.PLACE_NOT_FOUND, reviews: [], placeType: "" };

  const placeType = await driver.executeScript(`
    const categoryBtn = document.querySelector("button[jsaction*='category']");
    if (categoryBtn?.innerText) return categoryBtn.innerText.trim();
    const header = document.querySelector("h1");
    if (header) {
      let sib = header.parentElement?.nextElementSibling;
      for (let i = 0; i < 5 && sib; i++, sib = sib.nextElementSibling) {
        const t = sib.innerText?.trim();
        if (t && t.length > 1 && t.length < 50 && !/\\d{3,}/.test(t)
          && !/giờ|open|close|star|sao|đánh giá|review/i.test(t)) return t;
      }
    }
    for (const el of document.querySelectorAll(".DkEaL, .skqShb, .mgr77e, .LrzXr")) {
      const t = el.innerText?.trim();
      if (t && t.length > 1 && t.length < 50 && !/\\d{3,}/.test(t) && !/giờ|open|close/i.test(t)) return t;
    }
    return "";
  `) || "";

  if (!await hasAnyReviews(driver))
    return { status: SCRAPE_STATUS.NO_REVIEWS, reviews: [], placeType };

  let tabFound = await driver.executeScript(`
    const tab = Array.from(document.querySelectorAll("button, div[role='tab']")).find(t => {
      const text = (t.innerText || t.getAttribute('aria-label') || "").toLowerCase();
      return text.includes("đánh giá") || text.includes("reviews") || text === "review";
    });
    if (tab) { tab.click(); return true; }
    return false;
  `);

  if (!tabFound) {
    for (const sel of [
      "//button[contains(@aria-label, 'Reviews')]",
      "//button[contains(@aria-label, 'Đánh giá')]",
      "//div[@role='tab'][contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'review')]",
    ]) {
      try {
        const tab = await driver.wait(until.elementLocated(By.xpath(sel)), CONFIG.ELEMENT_WAIT_TIMEOUT);
        await tab.click();
        tabFound = true;
        break;
      } catch { /* thử selector tiếp */ }
    }
  }

  if (tabFound) await sleep(CONFIG.SLEEP_BETWEEN_ACTIONS);
  await sleep(2000);

  const maxScrolls = Math.ceil(CONFIG.MAX_REVIEWS / 5);
  let prevCount = 0;
  for (let i = 0; i < maxScrolls; i++) {
    await driver.executeScript(`
      const box = document.querySelector(".rLxhL") || document.querySelector(".DxyBCb")
                || document.querySelector("div[role='main']");
      if (box) box.scrollTop = box.scrollHeight;
      else window.scrollBy(0, 1000);
    `);
    await sleep(CONFIG.SLEEP_BETWEEN_ACTIONS);
    const count = await driver.executeScript(`return document.querySelectorAll("[data-review-id]").length;`);
    if (count >= CONFIG.MAX_REVIEWS) break;
    if (i >= 2 && count === prevCount) break;
    prevCount = count;
  }

  await driver.executeScript(`
    document.querySelectorAll("button.w8nwRe, span.w8nwRe, button[aria-label*='See more'], button[aria-label*='Xem thêm']")
      .forEach(btn => { try { if (/[Mm]ore|[Tt]hêm/.test(btn.innerText || "")) btn.click(); } catch {} });
  `);
  await sleep(1000);

  let reviews = await driver.executeScript(`
    return Array.from(document.querySelectorAll("[data-review-id]")).map(el => {
      const span = el.querySelector(".wiI7pd") || el.querySelector(".MyEned span");
      if (span?.innerText) return span.innerText.trim();
      let longest = "";
      for (const s of el.querySelectorAll("span")) {
        if (s.innerText?.length > longest.length) longest = s.innerText.trim();
      }
      return longest;
    }).filter(t => t.length > 5);
  `);

  if (reviews.length > CONFIG.MAX_REVIEWS) reviews = reviews.slice(0, CONFIG.MAX_REVIEWS);
  if (reviews.length === 0) return { status: SCRAPE_STATUS.ERROR, reviews: [], placeType };

  console.log(`  💬 ${reviews.length} bình luận`);
  return { status: SCRAPE_STATUS.SUCCESS, reviews, placeType };
}

// --- QUẢN LÝ DỮ LIỆU & GHI FILE ---

let currentEnrichedData = [];

function readInputData(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Không tìm thấy file: ${filePath}`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!Array.isArray(data)) throw new Error(`Dữ liệu phải là mảng JSON: ${filePath}`);
  data.forEach((p, i) => {
    if (!p?.name?.trim() || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng)))
      throw new Error(`Bản ghi không hợp lệ tại index ${i}: cần name, lat, lng.`);
  });
  console.log(`📂 Đọc ${data.length} địa điểm từ ${filePath}`);
  return data;
}

function makePlaceKey(place) {
  return JSON.stringify([String(place?.name || "").trim().toLowerCase(), Number(place?.lat), Number(place?.lng)]);
}

function formatMyJson(data) {
  let json = JSON.stringify(data, null, 2);
  // Ép các array một chiều nằm trên 1 dòng
  json = json.replace(/\[\s+([^\[\]\{\}]*?)\s+\]/g, (match, content) => {
    return '[' + content.replace(/\s*\n\s*(?!$)/g, ' ').trim() + ']';
  });
  // Ép riêng biệt mảng số vector liền lạc không khoảng trắng
  json = json.replace(/"embedding": \[\s+([\s\S]*?)\s+\]/g, (match, content) => {
    return '"embedding": [' + content.replace(/\s+/g, '') + ']';
  });
  return json;
}

function saveEnrichedPlace(filePath, enrichedPlace) {
  const key = makePlaceKey(enrichedPlace);
  const idx = currentEnrichedData.findIndex(p => makePlaceKey(p) === key);
  if (idx !== -1) currentEnrichedData[idx] = enrichedPlace;
  else currentEnrichedData.push(enrichedPlace);
  fs.writeFileSync(filePath, formatMyJson(currentEnrichedData), "utf-8");
}

// --- EMBED & LƯU VECTOR LOCAL (Gemini Batch) ---

let currentVectorData = [];

function loadVectorData(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function saveVectorBatch(filePath, batch) {
  currentVectorData = loadVectorData(filePath);
  
  for (const item of batch) {
    const key = JSON.stringify([String(item.name).trim().toLowerCase(), Number(item.lat), Number(item.lng)]);
    const idx = currentVectorData.findIndex(v =>
      JSON.stringify([String(v.name).trim().toLowerCase(), Number(v.lat), Number(v.lng)]) === key
    );
    if (idx !== -1) currentVectorData[idx] = item;
    else currentVectorData.push(item);
  }
  fs.writeFileSync(filePath, formatMyJson(currentVectorData), "utf-8");
}

async function processGeminiBatch(queue) {
  if (!geminiKey) {
    console.warn("  ⚠️  Bỏ qua Embed vì chưa có GEMINI_API_KEY");
    return;
  }
  if (queue.length === 0) return;
  
  const requests = queue.map(q => ({
    model: "models/" + CONFIG.EMBED_MODEL,
    content: { parts: [{ text: q.search_document }] }
  }));
  
  try {
    const res = await withTimeout(
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.EMBED_MODEL}:batchEmbedContents?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests })
      }),
      60000, "Gemini Batch Embed"
    );
    
    if (!res.ok) {
        throw new Error(`Loi Gemini HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const embeddings = data.embeddings;
    
    if (!embeddings || embeddings.length !== queue.length) {
        throw new Error("Gemini tra ve so luong vector khong khop voi queue");
    }
    
    const batchResult = queue.map((q, i) => ({
        name: q.name,
        lat: q.lat,
        lng: q.lng,
        search_document: q.search_document,
        embedding: embeddings[i].values
    }));
    
    saveVectorBatch(CONFIG.VECTOR_FILE, batchResult);
    console.log(`  [embed] 🌟 Gemini lưu thành công file BATCH gồm ${batchResult.length} vectors!`);
    
  } catch (err) {
    console.warn(`  ⚠️  Gemini Embed Loi Batch: ${err.message}`);
  }
}

// --- AUTO HEALING VECTORS (Tự Lành Vết Thương) ---

async function healMissingVectors() {
  if (!geminiKey || !currentEnrichedData || !currentVectorData) return;
  
  const existingKeys = new Set(currentVectorData.map(v => JSON.stringify([String(v.name).trim().toLowerCase(), Number(v.lat), Number(v.lng)])));
  const missing = currentEnrichedData.filter(p => !existingKeys.has(JSON.stringify([String(p.name).trim().toLowerCase(), Number(p.lat), Number(p.lng)])));
  
  if (missing.length === 0) return;
  
  console.log(`\n🚑 AUTO-HEALING: Tự động gom ${missing.length} địa điểm "mồ côi" Vector do rớt mạng đợt trước...`);
  
  const BATCH_SIZE = 20;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    console.log(`  ⏳ Đang xin xỏ bù Batch ${batch.length} văn bản lên Gemini...`);
    await processGeminiBatch(batch);
  }
}

// --- MAIN LOOP ---

async function main() {

  if (!groqClients.length) {
    throw new Error(
      "Thiếu Groq API key!\n" +
      "Tạo api_keys.json với nội dung:\n" +
      '{ "GROQ_API_KEYS": ["gsk_..."], "POLLINATIONS_TOKENS": ["pk_..."], "G4F_API_KEYS": ["uid_..."] }\n'
    );
  }

  const polTokenCount = pollinationsTokens.filter(t => t).length;
  console.log(`🤖 AI Pipeline:`);
  console.log(`   Analyst   : ✅ Groq (${groqAnalystClients.length} keys luân phiên) → 🟢 G4F.dev (fallback)`);
  console.log(`   Supervisor: 🌸 Pollinations (${polTokenCount} tokens) → 🟢 G4F.dev (fallback)`);
  console.log(`⚙️  Groq model: llama-3.3-70b-versatile`);
  console.log(`🧠 Embed     : 🌟 Gemini Batch API (${CONFIG.EMBED_MODEL}) → ${CONFIG.VECTOR_FILE}`);
  
  if (!geminiKey) {
    console.warn(`⚠️  Chưa cấu hình GEMINI_API_KEY, quá trình Embed lưu vector sẽ bị bỏ qua!`);
  }

  const places = readInputData(CONFIG.INPUT_FILE);

  let alreadyDone = new Set();
  if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
    try {
      currentEnrichedData = JSON.parse(fs.readFileSync(CONFIG.OUTPUT_FILE, "utf-8"));
      currentEnrichedData.forEach(p => alreadyDone.add(makePlaceKey(p)));
      console.log(`♻️  ${alreadyDone.size} địa điểm đã xử lý, bỏ qua.`);
    } catch { alreadyDone = new Set(); currentEnrichedData = []; }
  }

  currentVectorData = loadVectorData(CONFIG.VECTOR_FILE);
  console.log(`🗂️  Vector da co: ${currentVectorData.length} dia diem`);

  // Kích hoạt tính năng chữa lành trước khi cào MỚI
  await healMissingVectors();

  let driver = null;
  let embedQueue = [];
  try {
    driver = await buildDriver();

    for (let i = 0; i < places.length; i++) {
      const place = places[i];
      const placeKey = makePlaceKey(place);
      if (alreadyDone.has(placeKey)) continue;

      console.log(`\n📍 [${i + 1}/${places.length}] "${place.name}"`);

      // Bước 1: Cào dữ liệu
      let scrapeResult = { status: SCRAPE_STATUS.ERROR, reviews: [], placeType: "" };
      try {
        scrapeResult = await scrapeReviews(driver, place);
      } catch (e) {
        console.warn(`  ⚠️  Scraping lỗi: ${e.message}`);
      }

      const statusLabels = {
        [SCRAPE_STATUS.SUCCESS]: `${scrapeResult.reviews.length} reviews`,
        [SCRAPE_STATUS.NO_REVIEWS]: "no reviews",
        [SCRAPE_STATUS.PLACE_NOT_FOUND]: "not found",
        [SCRAPE_STATUS.ERROR]: "scrape error",
      };
      console.log(`  🌐 ${statusLabels[scrapeResult.status]}${scrapeResult.placeType ? ` | ${scrapeResult.placeType}` : ""}`);

      await sleep(1000);

      // Bước 2: AI phân tích & gắn thẻ
      try {
        const aiResult = await analyzeWithAI(place, scrapeResult);

        // Xây dựng search_document sau khi có đầy đủ tags
        const partialPlace = {
          ...place,
          category: aiResult.category,
          tags_price: aiResult.tags_price,
          tags_location: aiResult.tags_location,
          tags_audience: aiResult.tags_audience,
          tags_time: aiResult.tags_time,
          tags_highlight: aiResult.tags_highlight,
          tags: aiResult.tags,
          reviews: scrapeResult.reviews.slice(0, 3), // giữ 3 review để build doc
        };
        const searchDocument = buildSearchDocument(partialPlace);

        const enrichedPlace = {
          // Các trường gốc
          name: place.name,
          category: aiResult.category,
          lat: place.lat,
          lng: place.lng,
          rating: place.rating,
          reviews_count: place.reviews_count,

          // Tags có cấu trúc 5 chiều
          tags_price: aiResult.tags_price,
          tags_location: aiResult.tags_location,
          tags_audience: aiResult.tags_audience,
          tags_time: aiResult.tags_time,
          tags_highlight: aiResult.tags_highlight,

          // Backward compat flat array (dùng cho embedding)
          tags: aiResult.tags,

          // Search document để tính embedding
          search_document: searchDocument,

          // Metadata
          _enrichMeta: {
            scrapeStatus: scrapeResult.status,
            aiSource: aiResult.aiSource,
            supervisorNote: aiResult.supervisorNote,
            confidence: aiResult.confidence,
            enrichedAt: new Date().toISOString(),
          },
        };

        saveEnrichedPlace(CONFIG.OUTPUT_FILE, enrichedPlace);
        alreadyDone.add(placeKey);

        // Log mẫu search_document để kiểm tra chất lượng
        console.log(`  📄 search_doc: "${searchDocument.slice(0, 100)}..."`);

        // Bước 3: Xếp hàng vào Queue để Embed theo Batch
        embedQueue.push(enrichedPlace);
        if (embedQueue.length >= 20 || i === places.length - 1) {
          console.log(`  ⏳ Đang gửi Batch ${embedQueue.length} văn bản lên Gemini API...`);
          await processGeminiBatch(embedQueue);
          embedQueue = [];
        }

      } catch (aiError) {
        console.error(`  ❌ AI lỗi nghiêm trọng: ${aiError.message}`);
        throw aiError;
      }

      if (i < places.length - 1) await sleep(CONFIG.SLEEP_BETWEEN_PLACES);
    }

    console.log(`\n🎉 HOÀN THÀNH! Kết quả: ${CONFIG.OUTPUT_FILE}`);
    console.log(`📋 Mỗi địa điểm giờ có: tags_price, tags_location, tags_audience, tags_time, tags_highlight, search_document`);
  } finally {
    if (driver) await driver.quit();
  }
}

main().catch(err => {
  console.error("\n💥 LỖI NGHIÊM TRỌNG:", err.message);
  process.exit(1);
});