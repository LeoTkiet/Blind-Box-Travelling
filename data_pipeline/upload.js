const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY; 

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function ensureArray(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) return parsed;
            return [parsed];
        } catch (e) {
            return data.split(',').map(item => item.trim());
        }
    }
    return [data];
}

async function uploadEnrichedData() {
    try {
        console.log('1. Đang đọc dữ liệu...');
        const enrichedRaw = fs.readFileSync(path.join(__dirname, 'data', 'data_enriched.json'), 'utf8');
        const vectorsRaw = fs.readFileSync(path.join(__dirname, 'data', 'data_vectors.json'), 'utf8');

        const enrichedLocations = JSON.parse(enrichedRaw);
        const vectorLocations = JSON.parse(vectorsRaw);

        console.log('2. Đang phân tích file Vector...');
        const vectorMap = new Map();
        vectorLocations.forEach(v => {
            if (v.name) {
                // Chuyển tên về CHỮ THƯỜNG và xóa khoảng trắng để khớp nối chuẩn hơn
                const cleanName = v.name.toLowerCase().trim();
                vectorMap.set(cleanName, v.embedding);
            }
        });

        let matchCount = 0;
        let missingCount = 0;

        const mergedData = enrichedLocations.map(loc => {
            const cleanName = loc.name ? loc.name.toLowerCase().trim() : '';
            const rawEmbedding = vectorMap.get(cleanName);
            
            if (rawEmbedding) matchCount++; else missingCount++;

            let formattedEmbedding = null;
            if (rawEmbedding) {
                formattedEmbedding = Array.isArray(rawEmbedding) 
                    ? `[${rawEmbedding.join(',')}]` 
                    : `[${rawEmbedding.replace(/\[|\]/g, '')}]`;
            }

            return {
                name: loc.name,
                category: loc.category,
                lat: loc.lat,
                lng: loc.lng,
                rating: loc.rating,
                reviews_count: loc.reviews_count,
                tags_price: ensureArray(loc.tags_price || (loc.tags && loc.tags.price)),
                tags_location: ensureArray(loc.tags_location || (loc.tags && loc.tags.location)),
                tags_audience: ensureArray(loc.tags_audience || (loc.tags && loc.tags.audience)),
                tags_time: ensureArray(loc.tags_time || (loc.tags && loc.tags.time)),
                tags_highlight: ensureArray(loc.tags_highlight || (loc.tags && loc.tags.highlight)),
                tags: loc.tags ? (typeof loc.tags === 'object' && !Array.isArray(loc.tags) ? loc.tags : ensureArray(loc.tags)) : null,
                search_document: loc.search_document || null,
                embedding: formattedEmbedding 
            };
        });

        console.log(`\n📊 KẾT QUẢ KHỚP NỐI:`);
        console.log(`   - Tìm thấy vector cho: ${matchCount} quán ✅`);
        console.log(`   - Không thấy vector cho: ${missingCount} quán ❌`);

        if (matchCount === 0) {
            console.error('\n🚨 CẢNH BÁO: Không có quán nào khớp tên giữa 2 file JSON! Hãy kiểm tra lại cột "name" trong 2 file.');
            return;
        }

        const uniqueDataMap = new Map();
        mergedData.forEach(item => uniqueDataMap.set(item.name, item));
        const dataToUpsert = Array.from(uniqueDataMap.values());

        console.log(`\n3. Đang đẩy ${dataToUpsert.length} bản ghi lên Supabase (Batch 50)...`);
        const BATCH_SIZE = 50; 
        for (let i = 0; i < dataToUpsert.length; i += BATCH_SIZE) {
            const batch = dataToUpsert.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from('locations').upsert(batch, { onConflict: 'name' }); 
            if (error) throw error;
            console.log(`   -> Đã xong đợt ${Math.floor(i/BATCH_SIZE)+1}`);
        }

        console.log('\n🎉 HOÀN TẤT THÀNH CÔNG!');
    } catch (err) {
        console.error('❌ Lỗi:', err.message);
    }
}

uploadEnrichedData();