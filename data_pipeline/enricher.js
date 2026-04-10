"use strict";

const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const Groq = require("groq-sdk");

// CẤU HÌNH

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
  // Groq free tier: 30 req/phút mỗi key — tính theo tổng số key
  GROQ_RPM_PER_KEY: 10,         // bảo thủ để tránh burst
  // Pollinations: có token → 1 req/5s mỗi token = 12 RPM/token
  POLLINATIONS_RPM_PER_TOKEN: 10,
  // G4F.dev: free, không cần key, dùng mức nhẹ
  G4F_RPM: 15,

  // API call
  AI_CALL_TIMEOUT: 30000,
  KEY_COOLDOWN_MS: 5 * 60 * 1000,  // 5 phút cooldown khi key bị 429
  MAX_RETRIES_PER_KEY: 2,

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
};

const SCRAPE_STATUS = {
  SUCCESS: "success",
  NO_REVIEWS: "no_reviews",
  PLACE_NOT_FOUND: "place_not_found",
  ERROR: "error",
};

// KHỞI TẠO API KEYS

let externalKeys = { GROQ_API_KEYS: [], POLLINATIONS_TOKENS: [] };
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

// Pollinations hỗ trợ nhiều token luân phiên — mỗi token có rate limit riêng
const pollinationsTokens = loadKeys(externalKeys.POLLINATIONS_TOKENS, "POLLINATIONS_TOKENS", "POLLINATIONS_TOKEN");
// Nếu không có token nào → dùng anonymous (rate limit thấp hơn)
if (pollinationsTokens.length === 0) pollinationsTokens.push("");

// BỘ KIỂM SOÁT TỐC ĐỘ (RATE LIMITER)

class RateLimiter {
  constructor(requestsPerMinute) {
    this.minIntervalMs = (60 * 1000) / requestsPerMinute;
    this.lastDoneTime = 0;
  }

  async throttle() {
    const elapsed = Date.now() - this.lastDoneTime;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
  }

  markDone() {
    this.lastDoneTime = Date.now();
  }
}

const groqLimiter = new RateLimiter(Math.max(1, groqClients.length) * CONFIG.GROQ_RPM_PER_KEY);
// Pollinations: tổng RPM = số token × RPM/token
const pollinationsLimiter = new RateLimiter(Math.max(1, pollinationsTokens.filter(t => t).length) * CONFIG.POLLINATIONS_RPM_PER_TOKEN);
const g4fLimiter = new RateLimiter(CONFIG.G4F_RPM);

// THỜI GIAN CHỜ PHỤC HỒI KEY (COOLDOWN)

const keyState = {
  groq: groqClients.map(() => ({ cooldownUntil: 0 })),
  pollinations: pollinationsTokens.map(() => ({ cooldownUntil: 0 })),
};

const rrCounters = { groq: 0, pollinations: 0 };

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

  // Tất cả đang cooldown → tìm key phục hồi sớm nhất
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

// TĂNG DẦN THỜI GIAN CHỜ KHI LỖI (BACKOFF)

function calcBackoffMs(attempt, baseMs = 2000, maxMs = 120000) {
  return Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 1000, maxMs);
}

// TIỆN ÍCH

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

// LỖI API

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

// BỘ ĐẾM LỖI LIÊN TIẾP

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

// ĐỌC DỮ LIỆU JSON TỪ KẾT QUẢ AI TRẢ VỀ

function parseModelJSON(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) throw new Error("Empty model response");

  // Strip thinking blocks
  const deThought = raw
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .trim();

  const sanitized = deThought.replace(/```json/gi, "").replace(/```/g, "").trim();

  try { return JSON.parse(sanitized); } catch { /* tiếp tục */ }

  // Fallback: tìm JSON object/array cân bằng đầu tiên
  for (let start = 0; start < sanitized.length; start++) {
    const open = sanitized[start];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;

    for (let i = start; i < sanitized.length; i++) {
      const ch = sanitized[i];
      if (inStr) {
        esc = !esc && ch === "\\";
        if (!esc && ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === open) depth++;
      if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(sanitized.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }

  throw new Error(`INVALID_JSON: ${sanitized.slice(0, 80)}`);
}

// CÂU LỆNH HỆ THỐNG (SYSTEM INSTRUCTIONS CHO AI)

const ANALYST_SYSTEM = `Bạn là chuyên gia phân tích địa điểm.
Nhiệm vụ: Phân loại chính xác và trích xuất điểm nổi bật thành tags ngắn gọn (Tiếng Việt có dấu).
Ưu tiên bằng chứng: placeType Google Maps > bình luận > tên địa điểm.
CHỈ TRẢ VỀ JSON THUẦN, không giải thích.`;

const SUPERVISOR_SYSTEM = `Bạn là giám thị kiểm định. Kiểm tra category và tối ưu hóa tags thành những điểm nổi bật đặc sắc nhất (Tiếng Việt có dấu, cực kỳ ngắn gọn).
CHỈ TRẢ VỀ JSON THUẦN, không giải thích dài dòng.`;

// TẠO PROMPT DỮ LIỆU ĐỂ GỬI CHO AI

function buildAnalystPrompt(place, contextBlock) {
  const catList = CONFIG.VALID_CATEGORIES.map(c => `"${c}"`).join(", ");
  return `
Nhiệm vụ: phân loại địa điểm cho smart search từ dữ liệu thực tế.
Thông tin địa điểm:
- Tên: ${place.name}
- Toạ độ: ${place.lat}, ${place.lng}
- Category gốc (có thể sai): "${place.category}"

Dữ liệu thực tế từ Google Maps:
${contextBlock}

Trả về JSON chứa 2 trường:
- "category": CHỌN 1 từ: ${catList}
- "tags": 5-10 tag ngắn gọn (Tiếng Việt có dấu, chữ thường). Lấy đúng ĐIỂM NỔI BẬT NHẤT (vidụ: "kiến trúc pháp", "ven sông", "view hoàng hôn", "chụp hình đẹp", "mua sắm", "đồ cổ"). Tránh tag sáo rỗng vô nghĩa.

Quy tắc phân loại bắt buộc:
- "Bưu điện TP.HCM", "Nhà hát Lớn", công trình lịch sử nổi tiếng → "attraction"
- Nhà thờ, chùa, thánh đường bất kể hệ phái → "pagoda/temple"
- Chợ Bến Thành, Chợ Đêm → "market" (không phải shopping_mall)
- Vincom, AEON, Takashimaya → "shopping_mall" (không phải market)
- Đầm Sen, Suối Tiên → "theme_park" (không phải entertainment)
- Nếu địa điểm đa chức năng, chọn category theo chức năng chính.

Quy tắc tag:
- Chỉ trích xuất ĐẶC ĐIỂM NỔI BẬT, trải nghiệm thực tế sát với địa điểm.
- Tag từ 1 đến 4 từ, KHÔNG dài dòng để tiết kiệm token.
- Không dùng tag quá chung chung: "tuyệt vời", "ok", "tốt", "hay", "đáng đi".
- Không dùng tag dịch vụ phi du lịch: "gửi hàng", "giao hàng", "thu phí".

Chỉ trả về JSON, không thêm văn bản khác.
`.trim();
}

function buildSupervisorPrompt(place, contextBlock, analystResult) {
  const catList = CONFIG.VALID_CATEGORIES.map(c => `"${c}"`).join(", ");
  return `
Bạn là giám thị kiểm định dữ liệu địa điểm du lịch. Xem xét kết quả Analyst và xác nhận hoặc sửa nếu sai.

## Thông tin địa điểm
- Tên: ${place.name}
- Toạ độ: ${place.lat}, ${place.lng}
- Category GỐC (có thể sai): "${place.category}"

## Dữ liệu thực tế từ Google Maps
${contextBlock}

## Kết quả từ Analyst cần kiểm tra
\`\`\`json
${JSON.stringify(analystResult, null, 2)}
\`\`\`

## Nhiệm vụ
Đọc kỹ dữ liệu thực tế (đặc biệt placeType và bình luận) rồi đánh giá:
1. Category có đúng không? Phải là một trong: ${catList}
2. Tags có đủ và phù hợp không?

## Trả về JSON với 3 trường:
- "category": giữ nguyên hoặc sửa lại
- "tags": 5-10 tags ĐIỂM NỔI BẬT (Tiếng Việt có dấu, chữ thường, ngắn gọn).
- "supervisorNote": Rất ngắn gọn (dưới 10 chữ).

Chỉ trả về JSON hợp lệ, không markdown, không text khác.
`.trim();
}

// CHUẨN HÓA TAG (NORMALIZE) - LỌC VÀ CHỈNH SỬA TAG

const TAG_STOPWORDS = new Set([
  "hay", "tot", "ok", "tuyet voi", "dang di",
  "dia diem", "dia diem du lich", "khu vuc cong cong",
]);

const TAG_SYNONYMS = {
  "check-in": "chụp ảnh",
  "check in": "chụp ảnh",
  "chup anh check in": "chụp ảnh",
  "chup anh check-in": "chụp ảnh",
  "khach du lich": "du khách",
  "du khach nuoc ngoai": "du khách",
  "quan ao": "mua sắm",
  "qua luu niem": "quà lưu niệm",
  "co phi": "có vé vào cổng",
  "nghi duong": "đi nghỉ dưỡng",
  "an ngon": "ẩm thực ngon",
  "gia re": "giá bình dân",
  "view dep": "view đẹp",
  "sang trong": "sang trọng",
  "thu gian": "thư giãn",
  "gia dinh": "gia đình",
};

const FALLBACK_TAGS_MAP = {
  restaurant: ["ẩm thực", "quán ăn"],
  cafe: ["cà phê", "thư giãn"],
  bar_pub: ["giải trí về đêm", "đồ uống"],
  bakery: ["bánh ngọt", "đồ ăn nhẹ"],
  hotel: ["lưu trú", "nghỉ dưỡng"],
  hostel: ["lưu trú", "giá bình dân"],
  homestay: ["lưu trú", "trải nghiệm địa phương"],
  attraction: ["tham quan", "check-in"],
  museum: ["bảo tàng", "tìm hiểu lịch sử"],
  pagoda_temple: ["tâm linh", "tham quan"],
  park: ["không gian xanh", "đi dạo"],
  market: ["mua sắm", "ẩm thực địa phương"],
  shopping_mall: ["mua sắm", "giải trí"],
  souvenir_shop: ["quà lưu niệm", "mua sắm"],
  entertainment: ["giải trí", "về đêm"],
  spa_wellness: ["thư giãn", "chăm sóc sức khỏe"],
  sports: ["thể thao", "vận động"],
  theme_park: ["vui chơi", "gia đình"],
  beach: ["biển", "nghỉ dưỡng"],
  viewpoint: ["ngắm cảnh", "check-in"],
  nature: ["thiên nhiên", "tham quan"],
  transport_hub: ["di chuyển", "trung chuyển"],
  event_venue: ["sự kiện", "hội họp"],
};

function fallbackTagsFromCategory(category) {
  const key = String(category || "").replace(/[\/-]/g, "_");
  return FALLBACK_TAGS_MAP[key] || ["tham quan", "du lịch"];
}

function normalizeTag(tag) {
  if (typeof tag !== "string") return "";
  // Giữ lại dấu Tiếng Việt, gạch ngang, khoảng trắng.
  let raw = tag.toLowerCase().replace(/[^\p{L}\p{N}\-\s]/gu, "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length < 2) return "";

  // Tạo bản không dấu để map tới Synonym và khước từ Stopwords hiệu quả
  let unaccented = normalizeText(raw).replace(/[^\w\-\s]/g, "");

  if (TAG_STOPWORDS.has(unaccented)) return "";
  if (TAG_SYNONYMS[unaccented]) return TAG_SYNONYMS[unaccented];

  return raw;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const t = normalizeTag(tag);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

function validateAIResult(raw, fallbackCategory) {
  if (!raw || typeof raw !== "object") return null;
  const result = { ...raw };
  if (!CONFIG.VALID_CATEGORIES.includes(result.category)) {
    const safe = CONFIG.VALID_CATEGORIES.includes(fallbackCategory) ? fallbackCategory : "attraction";
    console.warn(`    ⚠️  Category "${result.category}" không hợp lệ → fallback "${safe}"`);
    result.category = safe;
  }
  result.tags = normalizeTags(result.tags);

  if (result.tags.length === 0) {
    const fallbackTags = fallbackTagsFromCategory(result.category);
    result.tags = normalizeTags(fallbackTags);
    console.warn(`    ⚠️  Tags rỗng sau normalize cho "${result.category}" → áp fallback tags`);
  }
  return result;
}

// GỌI API GROQ (Analyst) — Xử lý chính, luân phiên các API Key

async function callGroq(prompt, systemInstruction, label) {
  if (groqClients.length === 0) return null;
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, groqClients.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await groqLimiter.throttle();

    const keyInfo = getAvailableClient(groqClients, keyState.groq, "groq");
    if (!keyInfo) return null;
    if (keyInfo.waitMs > 0) {
      console.warn(`    ⚠️ Groq: tất cả key đều bị 429, nhường cho Fallback xử lý...`);
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
          max_tokens: 500,
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
          console.warn(`    🔄 Groq key[${keyIdx}] 429 → cooldown | backoff ${(ms / 1000).toFixed(1)}s (${attempt + 1}/${maxAttempts})`);
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

// GỌI API POLLINATIONS (Supervisor) — Kiểm định chính, luân phiên Token
// Mỗi token chạy 1 req/5s. Bỏ nhiều token vào POLLINATIONS_TOKENS để chạy nhanh hơn.

const POLLINATIONS_MODELS = [
  "openai",          // GPT-4o — ổn định
  "openai-fast",     // GPT-4.1-mini — nhanh hơn
];

let pollinationsModelCursor = 0;

async function callPollinations(prompt, systemInstruction, label) {
  if (pollinationsTokens.length === 0) return null;
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, pollinationsTokens.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await pollinationsLimiter.throttle();

    // Lấy token khả dụng theo round-robin + cooldown
    const tokenInfo = getAvailableClient(pollinationsTokens, keyState.pollinations, "pollinations");
    if (!tokenInfo) return null;
    if (tokenInfo.waitMs > 0) {
      console.warn(`    ⚠️ Pollinations: tất cả token đều bị 429, nhường cho Fallback xử lý...`);
      return null;
    }

    const { client: token, index: tokenIdx } = tokenInfo;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const modelsToTry = [
      ...POLLINATIONS_MODELS.slice(pollinationsModelCursor),
      ...POLLINATIONS_MODELS.slice(0, pollinationsModelCursor),
    ];

    let parsedResult = null;

    for (const modelName of modelsToTry) {
      try {
        const res = await withTimeout(
          fetch("https://text.pollinations.ai/v1/chat/completions", {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: prompt },
              ],
              temperature: 0,
              max_tokens: 500,
              response_format: { type: "json_object" },
              seed: 42,
            }),
          }),
          CONFIG.AI_CALL_TIMEOUT, `Pollinations ${modelName}`
        );

        pollinationsLimiter.markDone();

        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429) {
            setCooldown("pollinations", tokenIdx);
            console.warn(`    ↪ Pollinations token[${tokenIdx}] 429 → cooldown`);
            break; // thử token khác ở vòng attempt tiếp
          }
          console.warn(`    ↪ Pollinations "${modelName}" HTTP ${res.status}: ${body.slice(0, 60)}, thử model tiếp...`);
          continue;
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || "{}";
        parsedResult = parseModelJSON(content);

        const idx = POLLINATIONS_MODELS.indexOf(modelName);
        if (idx >= 0) pollinationsModelCursor = (idx + 1) % POLLINATIONS_MODELS.length;
        break;

      } catch (modelErr) {
        pollinationsLimiter.markDone();
        const c = classifyAPIError(modelErr);
        if (c.type === "NETWORK" || c.type === "SERVER" || c.type === "PARSE") {
          console.warn(`    ↪ Pollinations "${modelName}" [${c.type}], thử model tiếp...`);
          continue;
        }
        break;
      }
    }

    if (parsedResult) {
      recordSuccess("pollinations");
      console.log(`    🌸 Pollinations token[${tokenIdx}] OK`);
      return parsedResult;
    }

    if (attempt < maxAttempts) {
      const ms = calcBackoffMs(attempt, 1500, 30000);
      console.warn(`    🔄 Pollinations retry backoff ${(ms / 1000).toFixed(1)}s... (${attempt + 1}/${maxAttempts})`);
      await sleep(ms);
    }
  }

  recordFailure("pollinations", { type: "UNKNOWN", detail: "Tất cả token/model thất bại" });
  console.warn(`    ⚠️  Pollinations ${label}: tất cả token đều lỗi`);
  if (isAIPersistentlyFailing("pollinations"))
    console.error(`    🔴 Pollinations lỗi liên tiếp ${aiErrorTracker.pollinations.consecutiveFailures}x`);
  return null;
}

// GỌI API G4F.DEV — Fallback dự phòng khi Groq/Pollinations sập

// G4F hỗ trợ nhiều key luân phiên (mỗi key là userId tự đặt)
const g4fKeys = loadKeys(externalKeys.G4F_API_KEYS || [], "G4F_API_KEYS", "G4F_API_KEY");
// Nếu không có key → dùng anonymous
if (g4fKeys.length === 0) g4fKeys.push("");

const keyStateG4f = g4fKeys.map(() => ({ cooldownUntil: 0 }));
let g4fKeyCounter = 0;

const G4F_MODELS = [
  "gpt-4o",              // GPT-4o — JSON tốt nhất
  "llama-3.3-70b",       // Llama 3.3 70B — mạnh, ổn định
  "deepseek-v3",         // DeepSeek V3 — JSON ổn định
  "mistral-large",       // Mistral Large — cân bằng
  "gpt-4o-mini",         // GPT-4o-mini — nhanh hơn
];

let g4fModelCursor = 0;

function getAvailableG4fKey() {
  const now = Date.now();
  const available = g4fKeys
    .map((k, i) => ({ k, i }))
    .filter(({ i }) => keyStateG4f[i].cooldownUntil <= now);

  if (available.length > 0) {
    const pick = available[g4fKeyCounter % available.length];
    g4fKeyCounter++;
    return { key: pick.k, index: pick.i, waitMs: 0 };
  }
  const soonestIdx = keyStateG4f.reduce(
    (best, s, i) => (s.cooldownUntil < keyStateG4f[best].cooldownUntil ? i : best), 0
  );
  return { key: g4fKeys[soonestIdx], index: soonestIdx, waitMs: keyStateG4f[soonestIdx].cooldownUntil - now };
}

async function callG4F(prompt, systemInstruction, label) {
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, g4fKeys.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await g4fLimiter.throttle();

    const keyInfo = getAvailableG4fKey();
    if (keyInfo.waitMs > 0) {
      console.warn(`    ⚠️ G4F: tất cả key đều bị 429, hệ thống không thể Fallback thêm!`);
      return null;
    }

    const { key, index: keyIdx } = keyInfo;
    const headers = { "Content-Type": "application/json" };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const modelsToTry = [
      ...G4F_MODELS.slice(g4fModelCursor),
      ...G4F_MODELS.slice(0, g4fModelCursor),
    ];

    let parsedResult = null;

    for (const modelName of modelsToTry) {
      try {
        const res = await withTimeout(
          fetch("https://api.g4f.dev/v1/chat/completions", {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: prompt },
              ],
              temperature: 0,
              max_tokens: 500,
              response_format: { type: "json_object" },
            }),
          }),
          CONFIG.AI_CALL_TIMEOUT, `G4F ${modelName}`
        );

        g4fLimiter.markDone();

        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429) {
            keyStateG4f[keyIdx].cooldownUntil = Date.now() + CONFIG.KEY_COOLDOWN_MS;
            console.warn(`    ↪ G4F key[${keyIdx}] 429 → cooldown`);
            break;
          }
          if (res.status === 404 || /not found|no endpoint/i.test(body)) {
            console.warn(`    ↪ G4F "${modelName}" không có endpoint, thử tiếp...`);
            continue;
          }
          console.warn(`    ↪ G4F "${modelName}" HTTP ${res.status}: ${body.slice(0, 60)}, thử model tiếp...`);
          continue;
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || "{}";
        parsedResult = parseModelJSON(content);

        const idx = G4F_MODELS.indexOf(modelName);
        if (idx >= 0) g4fModelCursor = (idx + 1) % G4F_MODELS.length;
        break;

      } catch (modelErr) {
        g4fLimiter.markDone();
        const c = classifyAPIError(modelErr);
        if (c.type === "NETWORK" || c.type === "SERVER" || c.type === "PARSE") {
          console.warn(`    ↪ G4F "${modelName}" [${c.type}], thử model tiếp...`);
          continue;
        }
        break;
      }
    }

    if (parsedResult) {
      recordSuccess("g4f");
      console.log(`    🟢 G4F key[${keyIdx}] "${G4F_MODELS[(g4fModelCursor - 1 + G4F_MODELS.length) % G4F_MODELS.length]}" OK`);
      return parsedResult;
    }

    if (attempt < maxAttempts) {
      const ms = calcBackoffMs(attempt, 1500, 30000);
      console.warn(`    🔄 G4F retry backoff ${(ms / 1000).toFixed(1)}s... (${attempt + 1}/${maxAttempts})`);
      await sleep(ms);
    }
  }

  recordFailure("g4f", { type: "UNKNOWN", detail: "Tất cả key/model thất bại" });
  console.warn(`    ⚠️  G4F ${label}: tất cả đều lỗi`);
  if (isAIPersistentlyFailing("g4f"))
    console.error(`    🔴 G4F lỗi liên tiếp ${aiErrorTracker.g4f.consecutiveFailures}x`);
  return null;
}


// CÀO DỮ LIỆU (SCRAPING) BẰNG SELENIUM — Nguồn: Google Maps

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
        if (text.includes("đánh giá") || text.includes("review")) {
          return true;
        }
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
      if (t && t.length > 1 && t.length < 50 && !/\\d{3,}/.test(t) && !/giờ|open|close/i.test(t))
        return t;
    }
    return "";
  `) || "";

  if (!await hasAnyReviews(driver))
    return { status: SCRAPE_STATUS.NO_REVIEWS, reviews: [], placeType };

  // Mở tab Đánh giá
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

  // Cuộn tải thêm review
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

  // Mở "Xem thêm"
  await driver.executeScript(`
    document.querySelectorAll("button.w8nwRe, span.w8nwRe, button[aria-label*='See more'], button[aria-label*='Xem thêm']")
      .forEach(btn => { try { if (/[Mm]ore|[Tt]hêm/.test(btn.innerText || "")) btn.click(); } catch {} });
  `);
  await sleep(1000);

  // Trích xuất text review
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

// TẠO DỮ LIỆU (CONTEXT) BÌNH LUẬN ĐỂ GỬI CHO AI

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

// QUY TRÌNH KẾT NỐI AI: Phân tích (Analyst) → Kiểm duyệt (Supervisor)
// Analyst:    Groq (luân phiên Key)   → Dự phòng: G4F.dev
// Supervisor: Pollinations (luân phiên Token) → Dự phòng: G4F.dev

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
  const analystPrompt = buildAnalystPrompt(place, contextBlock);

  // ── BƯỚC 1: Analyst — Groq (chính) → G4F (fallback)
  let analystSource = "groq";
  let analystRaw = await callGroq(analystPrompt, ANALYST_SYSTEM, "Analyst");

  if (!analystRaw) {
    console.warn("  🔁 Groq lỗi → G4F Analyst...");
    analystRaw = await callG4F(analystPrompt, ANALYST_SYSTEM, "Analyst");
    if (analystRaw) analystSource = "g4f";
  }

  const analystResult = analystRaw ? validateAIResult(analystRaw, place.category) : null;

  // ── BƯỚC 2: Supervisor — Pollinations (chính) → G4F (fallback)
  let finalResult, aiSource, supervisorNote = "";

  if (analystResult) {
    const supervisorPrompt = buildSupervisorPrompt(place, contextBlock, analystResult);

    let supervisorRaw = await callPollinations(supervisorPrompt, SUPERVISOR_SYSTEM, "Supervisor");
    let supervisorSource = "pollinations";

    if (!supervisorRaw) {
      console.warn("  🔁 Pollinations lỗi → G4F Supervisor...");
      supervisorRaw = await callG4F(supervisorPrompt, SUPERVISOR_SYSTEM, "Supervisor");
      if (supervisorRaw) supervisorSource = "g4f";
    }

    const supervisorResult = supervisorRaw ? validateAIResult(supervisorRaw, analystResult.category) : null;

    if (supervisorResult) {
      supervisorNote = supervisorRaw.supervisorNote || "";
      const changed =
        supervisorResult.category !== analystResult.category ||
        JSON.stringify([...supervisorResult.tags].sort()) !== JSON.stringify([...analystResult.tags].sort());

      aiSource = changed
        ? `${analystSource}+${supervisorSource}-corrected`
        : `${analystSource}+${supervisorSource}-confirmed`;
      finalResult = { category: supervisorResult.category, tags: supervisorResult.tags };

    } else {
      // Supervisor lỗi hoàn toàn → dùng kết quả Analyst
      console.warn("  ⚠️  Supervisor lỗi, dùng kết quả Analyst");
      finalResult = analystResult;
      aiSource = `${analystSource}-only`;
    }

  } else {
    // Analyst lỗi hoàn toàn → dừng
    throw new Error(buildDualFailureMessage());
  }

  console.log(`  ✅ ${finalResult.category} [${aiSource}] tags=${finalResult.tags.length}`);
  return { ...finalResult, confidence, aiSource, supervisorNote };
}

// QUẢN LÝ DỮ LIỆU VÀ GHI FILE (FILE I/O)

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

function saveEnrichedPlace(filePath, enrichedPlace) {
  const key = makePlaceKey(enrichedPlace);
  const idx = currentEnrichedData.findIndex(p => makePlaceKey(p) === key);
  if (idx !== -1) currentEnrichedData[idx] = enrichedPlace; else currentEnrichedData.push(enrichedPlace);
  fs.writeFileSync(filePath, JSON.stringify(currentEnrichedData, null, 2), "utf-8");
}

// VÒNG LẶP CHẠY CHÍNH LÕI (MAIN LOOP)

async function main() {
  console.log("=".repeat(60));
  console.log("  🗺️  DATA ENRICHMENT PIPELINE");
  console.log("  🔄 Mode: Groq Analyst → Pollinations Supervisor");
  console.log("  📋 Fallback: G4F.dev (cho cả Analyst lẫn Supervisor)");
  console.log("=".repeat(60));

  if (!groqClients.length) {
    throw new Error(
      "Thiếu Groq API key!\n" +
      "Tạo api_keys.json với nội dung:\n" +
      '{ "GROQ_API_KEYS": ["gsk_..."], "POLLINATIONS_TOKENS": ["pk_..."], "G4F_API_KEYS": ["uid_..."] }\n' +
      "Lấy Groq key tại: https://console.groq.com\n" +
      "Lấy Pollinations token tại: https://auth.pollinations.ai\n" +
      "Lấy G4F API key tại: https://g4f.dev/api_key.html"
    );
  }

  const polTokenCount = pollinationsTokens.filter(t => t).length;
  console.log(`🤖 AI Pipeline:`);
  console.log(`   Analyst   : ✅ Groq (${groqClients.length} keys luân phiên) → 🟢 G4F.dev (fallback)`);
  console.log(`   Supervisor: 🌸 Pollinations (${polTokenCount} token${polTokenCount !== 1 ? "s" : ""} luân phiên) → 🟢 G4F.dev (fallback)`);
  console.log(`🚦 RPM: Groq ${groqClients.length * CONFIG.GROQ_RPM_PER_KEY} | Pollinations ${Math.max(1, polTokenCount) * CONFIG.POLLINATIONS_RPM_PER_TOKEN} | G4F ${CONFIG.G4F_RPM}`);
  console.log(`🔑 Groq Cooldown: ${CONFIG.KEY_COOLDOWN_MS / 60000} phút/key khi bị 429`);
  console.log(`🔑 Pollinations token: ${polTokenCount > 0 ? `✅ ${polTokenCount} token` : "⚠️  anonymous (rate limit thấp)"}`);
  console.log(`🔑 G4F keys: ${g4fKeys.filter(k => k).length > 0 ? `✅ ${g4fKeys.filter(k => k).length} key` : "ℹ️  anonymous (không cần key)"}`);
  console.log(`⚙️  Groq model: llama-3.3-70b-versatile`);
  console.log(`⚙️  Pollinations models: ${POLLINATIONS_MODELS.join(", ")}`);
  console.log(`⚙️  G4F models: ${G4F_MODELS.join(", ")}`);

  const places = readInputData(CONFIG.INPUT_FILE);

  let alreadyDone = new Set();
  if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
    try {
      currentEnrichedData = JSON.parse(fs.readFileSync(CONFIG.OUTPUT_FILE, "utf-8"));
      currentEnrichedData.forEach(p => alreadyDone.add(makePlaceKey(p)));
      console.log(`♻️  ${alreadyDone.size} địa điểm đã xử lý, bỏ qua.`);
    } catch { alreadyDone = new Set(); currentEnrichedData = []; }
  }

  let driver = null;
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

      // Bước 2: AI tự động phân tích & gắn thẻ
      try {
        const aiResult = await analyzeWithAI(place, scrapeResult);
        const enrichedPlace = {
          ...place,
          category: aiResult.category,
          tags: aiResult.tags,
          _enrichMeta: {
            scrapeStatus: scrapeResult.status,
            aiSource: aiResult.aiSource,
            enrichedAt: new Date().toISOString(),
          },
        };
        saveEnrichedPlace(CONFIG.OUTPUT_FILE, enrichedPlace);
        alreadyDone.add(placeKey);
      } catch (aiError) {
        console.error(`  ❌ AI lỗi nghiêm trọng: ${aiError.message}`);
        throw aiError;
      }

      if (i < places.length - 1) await sleep(CONFIG.SLEEP_BETWEEN_PLACES);
    }

    console.log(`\n🎉 HOÀN THÀNH! Kết quả: ${CONFIG.OUTPUT_FILE}`);
  } finally {
    if (driver) await driver.quit();
  }
}

main().catch(err => {
  console.error("\n💥 LỖI NGHIÊM TRỌNG:", err.message);
  process.exit(1);
});