"use strict";

const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

// ─────────────────────────────────────────────────────────────────────────────
// CẤU HÌNH
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  INPUT_FILE:  "data/data.json",
  OUTPUT_FILE: "data/data_enriched.json",

  // Scraping
  MAX_REVIEWS:            10,
  MAX_REVIEW_LENGTH:      200,
  SLEEP_BETWEEN_ACTIONS:  3000,
  SLEEP_AFTER_NAVIGATE:   5000,
  SLEEP_BETWEEN_PLACES:   15000,
  ELEMENT_WAIT_TIMEOUT:   5000,

  // AI context
  AI_CONTEXT_REVIEW_LIMIT:            8,
  AI_CONTEXT_REVIEW_LIMIT_CLEAR_TYPE: 5,
  AI_CONTEXT_REVIEW_LIMIT_AMBIGUOUS:  10,

  // Rate limiting
  // Gemini free tier thường thấp và dễ nghẽn theo phút → giữ nhịp bảo thủ
  GEMINI_RPM_PER_KEY:     5,
  // Groq thường chịu tải tốt hơn, nhưng vẫn giảm để đồng bộ pipeline free-safe
  GROQ_RPM_PER_KEY:       10,
  // OpenRouter free không SLA ổn định, dùng mức thấp giống Gemini
  OPENROUTER_RPM_PER_KEY: 5,
  // Thời gian mỗi request OpenRouter được phép thử (ms); 3 model × 8s = 24s < timeout tổng
  OPENROUTER_PER_MODEL_TIMEOUT: 8000,

  // API call
  AI_CALL_TIMEOUT:        30000,  // timeout tổng cho 1 lần gọi AI
  KEY_COOLDOWN_MS:        5 * 60 * 1000,  // 5 phút cooldown khi key bị 429
  MAX_RETRIES_PER_KEY:    2,

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
  SUCCESS:         "success",
  NO_REVIEWS:      "no_reviews",
  PLACE_NOT_FOUND: "place_not_found",
  ERROR:           "error",
};

// ─────────────────────────────────────────────────────────────────────────────
// KHỞI TẠO API KEYS
// ─────────────────────────────────────────────────────────────────────────────

let externalKeys = { GEMINI_API_KEYS: [], GROQ_API_KEYS: [], OPENROUTER_API_KEYS: [] };
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

const geminiKeys     = loadKeys(externalKeys.GEMINI_API_KEYS,     "GEMINI_API_KEYS",     "GEMINI_API_KEY");
const groqKeys       = loadKeys(externalKeys.GROQ_API_KEYS,       "GROQ_API_KEYS",       "GROQ_API_KEY");
const openRouterKeys = loadKeys(externalKeys.OPENROUTER_API_KEYS, "OPENROUTER_API_KEYS", "OPENROUTER_API_KEY");

const geminiClients = geminiKeys.map(key => new GoogleGenerativeAI(key));
const groqClients   = groqKeys.map(key => new Groq({ apiKey: key }));

function patchGoogleApiEndpointTypoFromEnv() {
  const keys = [
    "GOOGLE_API_BASE_URL",
    "GOOGLE_GENERATIVE_AI_API_ENDPOINT",
    "GOOGLE_GENERATIVE_AI_BASE_URL",
  ];
  for (const k of keys) {
    const v = process.env[k];
    if (!v) continue;
    if (v.includes("googlleapis.com")) {
      process.env[k] = v.replace(/googlleapis\.com/g, "googleapis.com");
      console.warn(`⚠️  Đã tự sửa typo endpoint trong ${k}: googlleapis.com -> googleapis.com`);
    }
  }
}

patchGoogleApiEndpointTypoFromEnv();

// OpenRouter models (có thể override qua env OPENROUTER_MODELS)
const OPENROUTER_MODELS = (
  process.env.OPENROUTER_MODELS ||
  "meta-llama/llama-3.1-8b-instruct:free,mistralai/mistral-7b-instruct:free,google/gemma-2-9b-it:free,qwen/qwen-2.5-7b-instruct:free,deepseek/deepseek-r1-distill-llama-70b:free"
).split(",").map(m => m.trim()).filter(Boolean);

let openRouterModelCursor = 0;

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITER — Token Bucket đơn giản
// Đo khoảng cách giữa khi response VỀ (không phải khi gửi đi),
// tránh burst ẩn khi request mất nhiều giây.
// ─────────────────────────────────────────────────────────────────────────────

class RateLimiter {
  constructor(requestsPerMinute) {
    this.minIntervalMs = (60 * 1000) / requestsPerMinute;
    this.lastDoneTime  = 0;  // thời điểm request trước HOÀN THÀNH (không phải bắt đầu)
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

const geminiLimiter     = new RateLimiter(Math.max(1, geminiClients.length)  * CONFIG.GEMINI_RPM_PER_KEY);
const groqLimiter       = new RateLimiter(Math.max(1, groqClients.length)    * CONFIG.GROQ_RPM_PER_KEY);
const openRouterLimiter = new RateLimiter(Math.max(1, openRouterKeys.length) * CONFIG.OPENROUTER_RPM_PER_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// KEY COOLDOWN — bỏ qua key đang bị rate-limit
// ─────────────────────────────────────────────────────────────────────────────

const keyState = {
  gemini:     geminiClients.map(()  => ({ cooldownUntil: 0 })),
  groq:       groqClients.map(()   => ({ cooldownUntil: 0 })),
  openrouter: openRouterKeys.map(() => ({ cooldownUntil: 0 })),
};

const rrCounters = { gemini: 0, groq: 0, openrouter: 0 };

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

// ─────────────────────────────────────────────────────────────────────────────
// EXPONENTIAL BACKOFF + JITTER
// ─────────────────────────────────────────────────────────────────────────────

function calcBackoffMs(attempt, baseMs = 2000, maxMs = 120000) {
  return Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 1000, maxMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIỆN ÍCH
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// LỖI API — phân loại và quyết định retry
// ─────────────────────────────────────────────────────────────────────────────

function classifyAPIError(err) {
  const msg    = err.message || "";
  const status = String(err.status || err.statusCode || err.code || "");
  const combined = `${msg} ${status}`;

  if (/401|403|invalid.*key|authentication/i.test(combined))
    return { type: "AUTH",       detail: "API key không hợp lệ hoặc đã hết hạn" };
  if (/429|rate.?limit|quota|resource.?exhausted/i.test(combined))
    return { type: "RATE_LIMIT", detail: "Hết hạn ngạch (429)" };
  if (/500|502|503|504|unavailable|internal/i.test(combined))
    return { type: "SERVER",     detail: "Lỗi phía server (5xx)" };
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|network/i.test(combined))
    return { type: "NETWORK",    detail: "Lỗi mạng hoặc timeout" };
  if (/INVALID_JSON/i.test(msg))
    return { type: "PARSE",      detail: `Không parse được JSON: ${msg.slice(0, 80)}` };
  return { type: "UNKNOWN",      detail: msg || "Lỗi không xác định" };
}

const RETRYABLE_ERRORS = new Set(["RATE_LIMIT", "NETWORK", "SERVER", "PARSE"]);

// ─────────────────────────────────────────────────────────────────────────────
// BỘ ĐẾM LỖI LIÊN TIẾP
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CONSECUTIVE_FAILURES = 3;
const aiErrorTracker = {
  gemini:     { consecutiveFailures: 0, lastError: null },
  groq:       { consecutiveFailures: 0, lastError: null },
  openrouter: { consecutiveFailures: 0, lastError: null },
};

function recordSuccess(aiName) {
  aiErrorTracker[aiName].consecutiveFailures = 0;
  aiErrorTracker[aiName].lastError = null;
}

function recordFailure(aiName, classified) {
  aiErrorTracker[aiName].consecutiveFailures++;
  aiErrorTracker[aiName].lastError = classified;
}

function isAIPersistentlyFailing(aiName) {
  return aiErrorTracker[aiName].consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE JSON TỪ MODEL OUTPUT
// ─────────────────────────────────────────────────────────────────────────────

function parseModelJSON(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) throw new Error("Empty model response");

  const sanitized = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Thử parse thẳng
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
      if (ch === open)  depth++;
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

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM INSTRUCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const ANALYST_SYSTEM = `Bạn phân loại địa điểm du lịch Việt Nam.
Ưu tiên bằng chứng: placeType Google Maps > bình luận > tên địa điểm.
Không sao chép category gốc nếu mâu thuẫn dữ liệu thực tế.
CHỈ TRẢ VỀ 1 JSON OBJECT THUẦN: không markdown, không code fence, không lời mở đầu.`;

const SUPERVISOR_SYSTEM = `Bạn kiểm định kết quả phân loại địa điểm du lịch.
Nếu đúng thì giữ nguyên; nếu sai/thiếu thì sửa category hoặc tags.
Ưu tiên bằng chứng: placeType > bình luận > tên.
CHỈ TRẢ VỀ 1 JSON OBJECT THUẦN; ghi chú ngắn trong "supervisorNote".`;

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

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

Trả về JSON đúng 2 trường:
- "category": chọn duy nhất 1 giá trị trong danh sách: ${catList}
- "tags": tối đa 10 tag, viết thường, tiếng Việt không dấu, không dấu gạch ngang.

Quy tắc phân loại bắt buộc:
- "Bưu điện TP.HCM", "Nhà hát Lớn", công trình lịch sử nổi tiếng → "attraction"
- Nhà thờ, chùa, thánh đường bất kể hệ phái → "pagoda/temple"
- Chợ Bến Thành, Chợ Đêm → "market" (không phải shopping_mall)
- Vincom, AEON, Takashimaya → "shopping_mall" (không phải market)
- Đầm Sen, Suối Tiên → "theme_park" (không phải entertainment)
- Nếu địa điểm đa chức năng, chọn category theo chức năng chính.

Quy tắc tag:
- Ưu tiên tag mô tả loại hình, đối tượng, trải nghiệm, thời điểm, điểm nổi bật.
- Không dùng tag quá chung chung: "dep", "hay", "tot", "sach se", "dang di".
- Không dùng tag dịch vụ phi du lịch: "gui hang", "giao hang", "thu phi".

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
- "tags": tối đa 10 tags, viết thường tiếng Việt không dấu
- "supervisorNote": 1-2 câu giải thích quyết định

Chỉ trả về JSON hợp lệ, không markdown, không text khác.
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// TAG NORMALIZER
// ─────────────────────────────────────────────────────────────────────────────

const TAG_STOPWORDS = new Set([
  "dep", "hay", "tot", "sach se", "dang di", "noi tieng",
  "dia diem du lich", "trung tam", "khu vuc cong cong",
]);

const TAG_SYNONYMS = {
  "check-in":            "chup anh check-in",
  "khach du lich":       "du khach",
  "du khach nuoc ngoai": "du khach",
  "quan ao":             "mua sam",
  "qua luu niem":        "mua qua luu niem",
  "co phi":              "co ve vao cong",
  "nghi duong":    "di nghi duong",
  "an ngon":       "am thuc ngon",
  "gia re":        "gia binh dan",
  "view dep":      "co view dep",
  "sang trong":    "sang trong",
  "thu gian":      "thu gian",
  "gia dinh":      "gia dinh",
};

function fallbackTagsFromCategory(category) {
  const map = {
    restaurant: ["am thuc", "quan an"],
    cafe: ["ca phe", "thu gian"],
    bar_pub: ["giai tri ve dem", "do uong"],
    bakery: ["banh ngot", "do an nhe"],
    hotel: ["luu tru", "nghi duong"],
    hostel: ["luu tru", "gia binh dan"],
    homestay: ["luu tru", "trai nghiem dia phuong"],
    attraction: ["tham quan", "check-in"],
    museum: ["bao tang", "tim hieu lich su"],
    pagoda_temple: ["tam linh", "tham quan"],
    park: ["khong gian xanh", "di dao"],
    market: ["mua sam", "am thuc dia phuong"],
    shopping_mall: ["mua sam", "giai tri"],
    souvenir_shop: ["qua luu niem", "mua sam"],
    entertainment: ["giai tri", "ve dem"],
    spa_wellness: ["thu gian", "cham soc suc khoe"],
    sports: ["the thao", "van dong"],
    theme_park: ["vui choi", "gia dinh"],
    beach: ["bien", "nghi duong"],
    viewpoint: ["ngam canh", "check-in"],
    nature: ["thien nhien", "tham quan"],
    transport_hub: ["di chuyen", "trung chuyen"],
    event_venue: ["su kien", "hoi hop"],
  };

  const key = String(category || "").replace(/[\/-]/g, "_");
  return map[key] || ["tham quan", "du lich"];
}

function normalizeTag(tag) {
  if (typeof tag !== "string") return "";
  let t = normalizeText(tag).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length < 3) return "";
  t = TAG_SYNONYMS[t] || t;
  return TAG_STOPWORDS.has(t) ? "" : t;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out  = [];
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

// ─────────────────────────────────────────────────────────────────────────────
// GỌI GEMINI — với repair tự động nếu JSON lỗi
// FIX: dùng gemini-2.5-flash
// FIX: limiter.markDone() sau khi request HOÀN THÀNH (không phải khi bắt đầu)
// FIX: repair call cũng đi qua limiter để không tạo burst ẩn
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(prompt, systemInstruction, label) {
  if (geminiClients.length === 0) return null;
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, geminiClients.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await geminiLimiter.throttle();

    const keyInfo = getAvailableClient(geminiClients, keyState.gemini, "gemini");
    if (!keyInfo) return null;
    if (keyInfo.waitMs > 0) {
      console.warn(`    ⏳ Gemini: tất cả key đang cooldown, chờ ${(keyInfo.waitMs / 1000).toFixed(1)}s...`);
      await sleep(keyInfo.waitMs);
    }

    const { client: genAI, index: keyIdx } = keyInfo;

    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction,
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 400 },
      });

      const res = await withTimeout(model.generateContent(prompt), CONFIG.AI_CALL_TIMEOUT, `Gemini ${label}`);
      geminiLimiter.markDone();  // FIX: đánh dấu HOÀN THÀNH sau khi response về
      const raw = res.response.text() || "";

      let parsed;
      try {
        parsed = parseModelJSON(raw);
      } catch (parseErr) {
        // JSON repair — cũng đi qua limiter để tránh burst
        console.warn(`    🔧 Gemini trả JSON lỗi, gọi repair...`);
        await geminiLimiter.throttle();  // FIX: repair request cũng được throttle
        const repairModel = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig: { temperature: 0, maxOutputTokens: 512 },
        });
        const repairRes = await withTimeout(
          repairModel.generateContent(
            `Chuyển nội dung sau thành JSON object hợp lệ duy nhất.\nChỉ output JSON thuần.\nNội dung:\n${raw}`
          ),
          CONFIG.AI_CALL_TIMEOUT, "Gemini JSON repair"
        );
        geminiLimiter.markDone();
        parsed = parseModelJSON(repairRes.response.text() || "");
      }

      recordSuccess("gemini");
      return parsed;

    } catch (err) {
      geminiLimiter.markDone();  // đảm bảo markDone ngay cả khi lỗi
      const classified = classifyAPIError(err);

      if (RETRYABLE_ERRORS.has(classified.type) && attempt < maxAttempts) {
        if (classified.type === "RATE_LIMIT") {
          setCooldown("gemini", keyIdx);
          const ms = calcBackoffMs(attempt);
          console.warn(`    🔄 Gemini key[${keyIdx}] 429 → cooldown | backoff ${(ms/1000).toFixed(1)}s (${attempt+1}/${maxAttempts})`);
          await sleep(ms);
        } else {
          const ms = calcBackoffMs(attempt, 1000, 30000);
          console.warn(`    🔄 Gemini [${classified.type}] backoff ${(ms/1000).toFixed(1)}s...`);
          await sleep(ms);
        }
        continue;
      }

      recordFailure("gemini", classified);
      console.warn(`    ⚠️  Gemini ${label} [${classified.type}]: ${classified.detail}`);
      if (isAIPersistentlyFailing("gemini"))
        console.error(`    🔴 Gemini lỗi liên tiếp ${aiErrorTracker.gemini.consecutiveFailures}x`);
      return null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GỌI GROQ — dùng chung cho cả Supervisor và Analyst fallback
// ─────────────────────────────────────────────────────────────────────────────

async function callGroq(prompt, systemInstruction, label) {
  if (groqClients.length === 0) return null;
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, groqClients.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await groqLimiter.throttle();

    const keyInfo = getAvailableClient(groqClients, keyState.groq, "groq");
    if (!keyInfo) return null;
    if (keyInfo.waitMs > 0) {
      console.warn(`    ⏳ Groq: tất cả key đang cooldown, chờ ${(keyInfo.waitMs / 1000).toFixed(1)}s...`);
      await sleep(keyInfo.waitMs);
    }

    const { client: groq, index: keyIdx } = keyInfo;

    try {
      const res = await withTimeout(
        groq.chat.completions.create({
          model:           "llama-3.3-70b-versatile",
          messages:        [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }],
          temperature:     0,
          max_tokens:      500,
          response_format: { type: "json_object" },
        }),
        CONFIG.AI_CALL_TIMEOUT, `Groq ${label}`
      );
      groqLimiter.markDone();

      const parsed = parseModelJSON(res.choices[0]?.message?.content || "{}");
      recordSuccess("groq");
      return parsed;

    } catch (err) {
      groqLimiter.markDone();
      const classified = classifyAPIError(err);

      if (RETRYABLE_ERRORS.has(classified.type) && attempt < maxAttempts) {
        if (classified.type === "RATE_LIMIT") {
          setCooldown("groq", keyIdx);
          const ms = calcBackoffMs(attempt);
          console.warn(`    🔄 Groq key[${keyIdx}] 429 → cooldown | backoff ${(ms/1000).toFixed(1)}s (${attempt+1}/${maxAttempts})`);
          await sleep(ms);
        } else {
          const ms = calcBackoffMs(attempt, 1000, 30000);
          console.warn(`    🔄 Groq [${classified.type}] backoff ${(ms/1000).toFixed(1)}s...`);
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

// ─────────────────────────────────────────────────────────────────────────────
// GỌI OPENROUTER
// FIX: mỗi model có timeout riêng (OPENROUTER_PER_MODEL_TIMEOUT = 8s)
//      thay vì bọc toàn bộ vòng lặp — tránh model đầu treo hết timeout tổng
// FIX: lỗi 404 "no endpoints" chỉ được skip model, không throw ra ngoài
// ─────────────────────────────────────────────────────────────────────────────

function isModelNotFound(statusCode, body) {
  if (statusCode !== 404) return false;
  const b = String(body || "").toLowerCase();
  return b.includes("no endpoints found") || b.includes("model not found") || b.includes("no provider available");
}

async function callOpenRouterWithRetry(prompt, systemInstruction, label) {
  if (openRouterKeys.length === 0 || OPENROUTER_MODELS.length === 0) return null;
  const maxAttempts = Math.max(CONFIG.MAX_RETRIES_PER_KEY, openRouterKeys.length * 2);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    await openRouterLimiter.throttle();

    const keyInfo = getAvailableClient(openRouterKeys, keyState.openrouter, "openrouter");
    if (!keyInfo) return null;
    if (keyInfo.waitMs > 0) {
      console.warn(`    ⏳ OpenRouter: tất cả key đang cooldown, chờ ${(keyInfo.waitMs / 1000).toFixed(1)}s...`);
      await sleep(keyInfo.waitMs);
    }

    const apiKey = keyInfo.client;
    const keyIdx = keyInfo.index;

    const modelsToTry = [
      ...OPENROUTER_MODELS.slice(openRouterModelCursor),
      ...OPENROUTER_MODELS.slice(0, openRouterModelCursor),
    ];

    let parsedResult = null;
    let outerError   = null;

    for (const modelName of modelsToTry) {
      try {
        const res = await withTimeout(
          fetch("https://openrouter.ai/api/v1/chat/completions", {
            method:  "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model:           modelName,
              messages:        [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }],
              temperature:     0,
              max_tokens:      500,
              response_format: { type: "json_object" },
            }),
          }),
          CONFIG.OPENROUTER_PER_MODEL_TIMEOUT,
          `OpenRouter ${modelName}`
        );

        if (!res.ok) {
          const body = await res.text();
          if (isModelNotFound(res.status, body)) {
            console.warn(`    ↪ OpenRouter "${modelName}" không có endpoint, thử tiếp...`);
            continue;
          }
          outerError = new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 200)}`);
          break;
        }

        const data = await res.json();
        parsedResult = parseModelJSON(data?.choices?.[0]?.message?.content || "{}");
        const idx = OPENROUTER_MODELS.indexOf(modelName);
        if (idx >= 0) openRouterModelCursor = (idx + 1) % OPENROUTER_MODELS.length;
        break;

      } catch (modelErr) {
        const c = classifyAPIError(modelErr);
        if (c.type === "NETWORK" || c.type === "SERVER" || c.type === "PARSE") {
          console.warn(`    ↪ OpenRouter "${modelName}" [${c.type}], thử model tiếp...`);
          continue;
        }
        outerError = modelErr;
        break;
      }
    }

    openRouterLimiter.markDone();

    if (parsedResult) {
      recordSuccess("openrouter");
      return parsedResult;
    }

    const err = outerError || new Error("OpenRouter: tất cả model đều không khả dụng.");
    const classified = classifyAPIError(err);

    if (RETRYABLE_ERRORS.has(classified.type) && attempt < maxAttempts) {
      if (classified.type === "RATE_LIMIT") {
        setCooldown("openrouter", keyIdx);
        const ms = calcBackoffMs(attempt);
        console.warn(`    🔄 OpenRouter key[${keyIdx}] 429 → cooldown | backoff ${(ms/1000).toFixed(1)}s (${attempt+1}/${maxAttempts})`);
        await sleep(ms);
      } else {
        const ms = calcBackoffMs(attempt, 1000, 30000);
        console.warn(`    🔄 OpenRouter [${classified.type}] backoff ${(ms/1000).toFixed(1)}s...`);
        await sleep(ms);
      }
      continue;
    }

    recordFailure("openrouter", classified);
    console.warn(`    ⚠️  OpenRouter ${label} [${classified.type}]: ${classified.detail}`);
    if (isAIPersistentlyFailing("openrouter"))
      console.error(`    🔴 OpenRouter lỗi liên tiếp ${aiErrorTracker.openrouter.consecutiveFailures}x`);
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPING — Google Maps
// ─────────────────────────────────────────────────────────────────────────────

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
          if (text.includes("(0)") || /^0 đánh giá/.test(text)) return false;
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

// ─────────────────────────────────────────────────────────────────────────────
// XÂY DỰNG CONTEXT CHO AI
// ─────────────────────────────────────────────────────────────────────────────

function getDynamicReviewLimit(placeType) {
  const n = normalizeText(placeType);
  if (!n) return CONFIG.AI_CONTEXT_REVIEW_LIMIT_AMBIGUOUS;
  const clearHints = [
    "restaurant","nha hang","quan an","food court",
    "cafe","coffee","tra sua",
    "hotel","resort","hostel","homestay",
    "museum","bao tang",
    "chua","den","nha tho","thanh duong",
    "park","cong vien",
    "market","cho",
    "shopping mall","trung tam thuong mai",
    "spa","massage",
    "beach","bai bien",
    "viewpoint","diem ngam canh",
    "theme park","cong vien nuoc",
    "transport","ga","ben xe","ben tau",
  ];
  return clearHints.some(h => n.includes(h))
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
      const limit    = getDynamicReviewLimit(placeType);
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

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE AI: Analyst → Supervisor
// ─────────────────────────────────────────────────────────────────────────────

function buildDualFailureMessage() {
  const fmt = (name) => {
    const t = aiErrorTracker[name];
    return t.lastError
      ? `${name}: [${t.lastError.type}] ${t.lastError.detail} (liên tiếp: ${t.consecutiveFailures}x)`
      : `${name}: không có API key`;
  };
  return [
    "🛑 TẤT CẢ AI ĐỀU THẤT BẠI — DỪNG CHƯƠNG TRÌNH!",
    "─".repeat(50),
    `  • ${fmt("gemini")}`,
    `  • ${fmt("groq")}`,
    `  • ${fmt("openrouter")}`,
    "─".repeat(50),
    "Gợi ý: kiểm tra mạng, API key, chờ rate limit phục hồi rồi chạy lại.",
  ].join("\n");
}

async function analyzeWithAI(place, scrapeResult) {
  const { confidence, contextBlock } = buildReviewContext(place, scrapeResult);
  const analystPrompt    = buildAnalystPrompt(place, contextBlock);
  const hasGroq          = groqClients.length > 0;
  const hasOpenRouter    = openRouterKeys.length > 0;

  // ── BƯỚC 1: Analyst (Gemini ưu tiên, fallback OpenRouter)
  let analystSource = "gemini";
  let analystRaw = await callGemini(analystPrompt, ANALYST_SYSTEM, "Analyst");

  if (!analystRaw && hasOpenRouter) {
    console.warn("  🔁 Gemini lỗi → OpenRouter Analyst...");
    analystRaw = await callOpenRouterWithRetry(analystPrompt, ANALYST_SYSTEM, "Analyst");
    if (analystRaw) analystSource = "openrouter";
  }

  const analystResult = analystRaw ? validateAIResult(analystRaw, place.category) : null;

  // ── BƯỚC 2: Supervisor (Groq ưu tiên, fallback OpenRouter)
  let finalResult, aiSource, supervisorNote = "";

  if (analystResult) {
    const supervisorPrompt = buildSupervisorPrompt(place, contextBlock, analystResult);
    let supervisorRaw      = hasGroq ? await callGroq(supervisorPrompt, SUPERVISOR_SYSTEM, "Supervisor") : null;
    let supervisorSource   = "groq";

    if (!supervisorRaw && hasOpenRouter) {
      console.warn("  🔁 Groq lỗi → OpenRouter Supervisor...");
      supervisorRaw = await callOpenRouterWithRetry(supervisorPrompt, SUPERVISOR_SYSTEM, "Supervisor");
      if (supervisorRaw) supervisorSource = "openrouter";
    }

    const supervisorResult = supervisorRaw ? validateAIResult(supervisorRaw, analystResult.category) : null;

    if (supervisorResult) {
      supervisorNote = supervisorRaw.supervisorNote || "";
      const changed =
        supervisorResult.category !== analystResult.category ||
        JSON.stringify([...supervisorResult.tags].sort()) !== JSON.stringify([...analystResult.tags].sort());

      aiSource    = changed
        ? (supervisorSource === "groq" ? "groq-corrected"    : "openrouter-corrected")
        : (supervisorSource === "groq" ? "dual-confirmed"    : "openrouter-confirmed");
      finalResult = { category: supervisorResult.category, tags: supervisorResult.tags };
    } else {
      // Supervisor lỗi → dùng kết quả Analyst
      console.warn("  ⚠️  Supervisor lỗi, dùng kết quả Analyst");
      finalResult = analystResult;
      aiSource    = analystSource === "gemini" ? "gemini-only" : "openrouter-analyst-only";
    }

  } else {
    // Analyst lỗi → thử Groq tự phân tích
    if (hasGroq) {
      console.log("  🔎 Gemini + OpenRouter lỗi, thử Groq Analyst...");
      const groqOnlyRaw = await callGroq(analystPrompt, ANALYST_SYSTEM, "Analyst-fallback");
      const groqOnly    = groqOnlyRaw ? validateAIResult(groqOnlyRaw, place.category) : null;
      if (groqOnly) {
        finalResult = groqOnly;
        aiSource    = "groq-only";
      } else {
        throw new Error(buildDualFailureMessage());
      }
    } else {
      throw new Error(buildDualFailureMessage());
    }
  }

  console.log(`  ✅ ${finalResult.category} [${aiSource}] tags=${finalResult.tags.length}`);
  return { ...finalResult, confidence, aiSource, supervisorNote };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE I/O
// ─────────────────────────────────────────────────────────────────────────────

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
  let data = [];
  if (fs.existsSync(filePath)) {
    try { data = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { data = []; }
  }
  const key = makePlaceKey(enrichedPlace);
  const idx = data.findIndex(p => makePlaceKey(p) === key);
  if (idx !== -1) data[idx] = enrichedPlace; else data.push(enrichedPlace);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  🗺️  DATA ENRICHMENT PIPELINE");
  console.log("  🔄 Mode: Gemini Analyst → Groq Supervisor");
  console.log("=".repeat(60));

  if (!geminiClients.length && !groqClients.length && !openRouterKeys.length)
    throw new Error("Thiếu API key! Cấu hình api_keys.json hoặc biến môi trường.");

  const aiStatus = [
    geminiClients.length  ? `✅ Gemini (${geminiClients.length} keys)`       : "❌ Gemini",
    groqClients.length    ? `✅ Groq (${groqClients.length} keys)`           : "❌ Groq",
    openRouterKeys.length ? `✅ OpenRouter (${openRouterKeys.length} keys)` : "❌ OpenRouter",
  ];
  console.log(`🤖 AI: ${aiStatus.join(" | ")}`);
  console.log(
    `🚦 RPM: Gemini ${geminiClients.length * CONFIG.GEMINI_RPM_PER_KEY} | ` +
    `Groq ${groqClients.length * CONFIG.GROQ_RPM_PER_KEY} | ` +
    `OpenRouter ${openRouterKeys.length * CONFIG.OPENROUTER_RPM_PER_KEY}`
  );
  console.log(`🔑 Cooldown: ${CONFIG.KEY_COOLDOWN_MS / 60000} phút/key khi bị 429`);
  console.log(`⚙️  Gemini model: gemini-2.5-flash | OpenRouter per-model timeout: ${CONFIG.OPENROUTER_PER_MODEL_TIMEOUT / 1000}s`);

  const places = readInputData(CONFIG.INPUT_FILE);

  let alreadyDone = new Set();
  if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(CONFIG.OUTPUT_FILE, "utf-8"));
      existing.forEach(p => alreadyDone.add(makePlaceKey(p)));
      console.log(`♻️  ${alreadyDone.size} địa điểm đã xử lý, bỏ qua.`);
    } catch { alreadyDone = new Set(); }
  }

  let driver = null;
  try {
    driver = await buildDriver();

    for (let i = 0; i < places.length; i++) {
      const place    = places[i];
      const placeKey = makePlaceKey(place);

      if (alreadyDone.has(placeKey)) continue;
      console.log(`\n📍 [${i + 1}/${places.length}] "${place.name}"`);

      // Scraping
      let scrapeResult = { status: SCRAPE_STATUS.ERROR, reviews: [], placeType: "" };
      try {
        scrapeResult = await scrapeReviews(driver, place);
      } catch (e) {
        console.warn(`  ⚠️  Scraping lỗi: ${e.message}`);
      }

      const statusLabels = {
        [SCRAPE_STATUS.SUCCESS]:         `${scrapeResult.reviews.length} reviews`,
        [SCRAPE_STATUS.NO_REVIEWS]:      "no reviews",
        [SCRAPE_STATUS.PLACE_NOT_FOUND]: "not found",
        [SCRAPE_STATUS.ERROR]:           "scrape error",
      };
      console.log(`  🌐 ${statusLabels[scrapeResult.status]}${scrapeResult.placeType ? ` | ${scrapeResult.placeType}` : ""}`);

      await sleep(1000);

      // Phân tích AI
      try {
        const aiResult = await analyzeWithAI(place, scrapeResult);
        const enrichedPlace = {
          ...place,
          category: aiResult.category,
          tags:     aiResult.tags,
          _enrichMeta: {
            scrapeStatus: scrapeResult.status,
            aiSource:     aiResult.aiSource,
            enrichedAt:   new Date().toISOString(),
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