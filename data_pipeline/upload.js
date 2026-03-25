const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// 1. Thay thế bằng URL và KEY của bạn (lấy ở Bước 1)
const SUPABASE_URL = 'https://eaujzojbaysroecyshdz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HX0QLyf0WDhsXxUY0SjbfQ_ruYUcDPB';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function seedData() {
    try {
        console.log('Đang đọc file hcm_data.json...');
        // 2. Đọc dữ liệu từ file JSON
        const rawData = fs.readFileSync('hcm_data.json', 'utf8');
        const locations = JSON.parse(rawData);

        console.log(`Tìm thấy ${locations.length} địa điểm. Đang đẩy lên Supabase...`);

        // 3. Insert dữ liệu vào bảng 'locations'
        // Supabase cho phép insert một array các object cùng lúc
        const { data, error } = await supabase
            .from('locations')
            .insert(locations);

        if (error) {
            throw error;
        }

        console.log('✅ Đẩy dữ liệu thành công!');
    } catch (err) {
        console.error('❌ Có lỗi xảy ra:', err.message);
    }
}

seedData();