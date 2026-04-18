"use strict";
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── ENV VALIDATION ──────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const missing = [];
if (!SUPABASE_URL) missing.push("SUPABASE_URL");
if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
if (missing.length) {
    console.error("❌ Thiếu biến môi trường:", missing.join(", "));
    console.error("   Cách chạy:");
    console.error("   SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx GEMINI_API_KEY=xxx node upload.js");
    process.exit(1);
}

// ─── CONFIG ──────────────────────────────────────────────────────
const CONFIG = {
    ENRICHED_FILE: path.join(__dirname, "data", "data_enriched.json"),
    EMBED_MODEL: "gemini-embedding-001",
    VECTOR_DIM: 768,

    EMBED_BATCH_SIZE: 20,
    EMBED_DELAY_MS: 15000,
   
    TEST_MODE: false,
    TEST_LIMIT: 10,
};

// ─── CLIENTS ─────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── HELPERS ─────────────────────────────────────────────────────

function makePlaceKey(item) {
    return JSON.stringify([
        String(item.name || "").trim().toLowerCase(),
        Number(item.lat).toFixed(5),
        Number(item.lng).toFixed(5),
    ]);
}

// Đảm bảo giá trị là array hoặc null — dùng cho tags_location/audience/time/highlight/tags
function toArray(val) {
    if (val == null) return null;
    if (Array.isArray(val)) return val.length ? val : null;
    if (typeof val === "string") {
        const t = val.trim();
        if (!t) return null;
        if (t.startsWith("[")) {
            try { return JSON.parse(t); } catch { /* fall through */ }
        }
        return [t];
    }
    return [String(val)];
}


function toSingleString(val) {
    if (!val) return null;
    if (Array.isArray(val)) return val[0] || null;
    return String(val).trim() || null;
}

// Float array → chuỗi pgvector "[x,x,x,...]"
function fmtVec(values) {
    if (!Array.isArray(values) || !values.length) return null;
    return `[${values.join(",")}]`;
}

function buildRecord(enriched, embedding) {
    return {
        // ── Định danh ──────────────────────────────────────────
        name: String(enriched.name || "").trim(),
        lat: Number(enriched.lat),
        lng: Number(enriched.lng),

        // ── Phân loại ──────────────────────────────────────────
        category: enriched.category || null,

        // ── Điểm đánh giá ─────────────────────────────────────
        rating: enriched.rating != null ? Number(enriched.rating) : null,
        reviews_count: enriched.reviews_count != null ? Number(enriched.reviews_count) : null,

        // ── Tags 5 chiều — output chuẩn của enricher.js ───────
        tags_price: toArray(enriched.tags_price),
        tags_location: toArray(enriched.tags_location),      
        tags_audience: toArray(enriched.tags_audience),      
        tags_time: toArray(enriched.tags_time),          
        tags_highlight: toArray(enriched.tags_highlight),     

        // ── Flat tags ───────
        tags: toArray(enriched.tags),               

        // ── Search document ────────
        search_document: enriched.search_document || null,
        embedding: fmtVec(embedding),
    };
}

// ─── GEMINI BATCH EMBED ──────────────────────────────────────────
async function embedBatch(items) {
    // Gọi batchEmbedContents — 1 request cho tối đa 50 items
    const requests = items.map(item => ({
        model: `models/${CONFIG.EMBED_MODEL}`,
        content: { parts: [{ text: item.search_document }] },
        outputDimensionality: CONFIG.VECTOR_DIM,
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!data.embeddings || data.embeddings.length !== items.length) {
        throw new Error(`Gemini trả ${data.embeddings?.length ?? 0} vectors, cần ${items.length}`);
    }

    // Trả về Map<placeKey → float[]>
    const resultMap = new Map();
    items.forEach((item, i) => {
        resultMap.set(makePlaceKey(item), data.embeddings[i].values);
    });
    return resultMap;
}

// ─── MAIN ────────────────────────────────────────────────────────
async function main() {
    console.log("=".repeat(60));
    console.log("  UPLOAD → SUPABASE  (Gemini 768D)");
    console.log("=".repeat(60));

    // 1. Đọc data_enriched.json
    if (!fs.existsSync(CONFIG.ENRICHED_FILE)) {
        throw new Error(`Không tìm thấy: ${CONFIG.ENRICHED_FILE}\nHãy chạy enricher.js trước.`);
    }
    const raw = JSON.parse(fs.readFileSync(CONFIG.ENRICHED_FILE, "utf-8"));

    const deduped = new Map();
    raw.forEach(loc => { if (loc.name) deduped.set(makePlaceKey(loc), loc); });
    const allData = Array.from(deduped.values());
    console.log(`📂 Enriched file: ${raw.length} records → ${allData.length} sau dedup`);

    // Cảnh báo record thiếu search_document
    const missingDoc = allData.filter(d => !d.search_document?.trim());
    if (missingDoc.length) {
        console.warn(`⚠️  ${missingDoc.length} địa điểm không có search_document → embedding = null`);
    }

    // 2. Auto-resume: lấy những gì đã có embedding trong DB
    // Dùng pagination để vượt giới hạn 1000 rows mặc định của PostgREST
    console.log("\n🔍 Kiểm tra DB...");
    let existing = [];
    let page = 0;
    const pageSize = 1000;
    while (true) {
        const { data, error: fetchErr } = await supabase
            .from("locations")
            .select("name, lat, lng")
            .not("embedding", "is", null)
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (fetchErr) throw new Error(`Query Supabase lỗi: ${fetchErr.message}`);
        if (!data || data.length === 0) break;

        existing.push(...data);
        if (data.length < pageSize) break; 
        page++;
    }

    const existingKeys = new Set((existing || []).map(makePlaceKey));
    const needUpload = allData.filter(d => !existingKeys.has(makePlaceKey(d)));

    console.log(`📊 DB đã có embedding: ${existingKeys.size} | Cần upload: ${needUpload.length}`);

    if (needUpload.length === 0) {
        console.log("🎉 Tất cả đã upload rồi.");
        return;
    }

    // 3. Test mode
    let toProcess = needUpload;
    if (CONFIG.TEST_MODE) {
        toProcess = needUpload.slice(0, CONFIG.TEST_LIMIT);
        console.log(`\n🧪 [TEST MODE] Chỉ xử lý ${toProcess.length} địa điểm`);
        console.log("   → Chạy thật: TEST_MODE=false node upload.js\n");
    } else {
        console.log(`\n🚀 [FULL MODE] ${toProcess.length} địa điểm\n`);
    }

    // 4. Embed từng batch → Ghi Database 
    const { EMBED_BATCH_SIZE, EMBED_DELAY_MS } = CONFIG;
    const totalEmbedBatches = Math.ceil(toProcess.length / EMBED_BATCH_SIZE);
    const failedEmbedBatches = [];
    let savedTotal = 0;

    for (let i = 0; i < toProcess.length; i += EMBED_BATCH_SIZE) {
        const batch = toProcess.slice(i, i + EMBED_BATCH_SIZE);
        const batchNum = Math.floor(i / EMBED_BATCH_SIZE) + 1;
        console.log(`\n📦 Batch ${batchNum}/${totalEmbedBatches}: ${batch.length} địa điểm`);

        const hasDoc = batch.filter(d => d.search_document?.trim());
        let embedMap = new Map();

        // [A] Embed API (3 lần thử)
        if (hasDoc.length > 0) {
            let ok = false;
            for (let retry = 1; retry <= 3; retry++) {
                try {
                    embedMap = await embedBatch(hasDoc);
                    console.log(`   ✅ Gemini: ${hasDoc.length} vectors`);
                    ok = true;
                    break;
                } catch (err) {
                    const wait = retry * 15000;
                    console.warn(`   ⚠️ Gemini lỗi lần ${retry}/3: ${err.message}`);
                    if (retry < 3) {
                        console.warn(`   ⏳ Thử lại sau ${wait / 1000}s...`);
                        await sleep(wait);
                    }
                }
            }
            if (!ok) {
                console.error(`   ❌ Embed thất bại — bỏ qua để chạy Batch tiếp theo`);
                failedEmbedBatches.push(batchNum);
                continue; 
            }
        }

        // [B] Record build
        let curReadyRecords = [];
        batch.forEach(item => {
            curReadyRecords.push(buildRecord(item, embedMap.get(makePlaceKey(item)) || null));
        });

        // [C] Upsert Lên Database 
        const { error } = await supabase
            .from("locations")
            .upsert(curReadyRecords, { onConflict: "name,lat,lng" });

        if (error) {
            console.error(`   ❌ Lỗi ghi Database: ${error.message}`);
        } else {
            console.log(`   ✅ Database: Đã Upload ${curReadyRecords.length} records!`);
            savedTotal += curReadyRecords.length;
        }

        // Giữ nhịp chờ cho Google Gemini tránh Quota Limit
        if (i + EMBED_BATCH_SIZE < toProcess.length) {
            console.log(`   ⏳ Thở ${EMBED_DELAY_MS / 1000}s để chống dội Gemini...`);
            await sleep(EMBED_DELAY_MS);
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log(`🎉 HOÀN TẤT`);
    console.log(`   Đã kéo thành công: ${savedTotal} items lên database`);
    if (failedEmbedBatches.length) {
        console.log(`   Có vài Batch lấy rỗng vector: [${failedEmbedBatches.join(", ")}]`);
        console.log("   Bạn có thể ngưng chạy 1 ngày, bật máy chạy node upload.js lại để vét máng!");
    }
    console.log("=".repeat(60));
}

main().catch(err => {
    console.error("\n💥 LỖI NGHIÊM TRỌNG:", err.message);
    process.exit(1);
});