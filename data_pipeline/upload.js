const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// 1. Initialize Supabase client using environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Error: Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function seedData() {
    try {
        console.log('Reading hcm_data.json file...');
        // 2. Read data from JSON file
        const rawData = fs.readFileSync('hcm_data.json', 'utf8');
        const locations = JSON.parse(rawData);

        console.log(`Found ${locations.length} locations. Uploading to Supabase...`);

        // 3. Insert data into 'locations' table
        // Supabase allows inserting an array of objects at once
        const { data, error } = await supabase
            .from('locations')
            .insert(locations);

        if (error) {
            throw error;
        }

        console.log('✅ Data uploaded successfully!');
    } catch (err) {
        console.error('❌ An error occurred:', err.message);
    }
}

seedData();