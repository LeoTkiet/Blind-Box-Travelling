const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// warning: set env before run
// $env:SUPABASE_URL="https://your-project.supabase.co"
// $env:SUPABASE_ANON_KEY="your-anon-key"
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
        const rawData = fs.readFileSync('hcm_data.json', 'utf8');
        const locations = JSON.parse(rawData); // read data from json file
        
        console.log(`Found ${locations.length} locations in local file.`);

        console.log('Checking existing data on Supabase...');
        
        // get existing data from supabase
        const { data: existingData, error: fetchError } = await supabase
            .from('locations')
            .select('name');

        if (fetchError) throw fetchError;

        // get new locations
        const existingNames = new Set(existingData.map(item => item.name));
        const newLocations = locations.filter(loc => !existingNames.has(loc.name));

        if (newLocations.length === 0) {
            console.log('All data is up to date. No new locations to upload!');
            return;
        }

        console.log(`Found ${newLocations.length} NEW locations. Uploading to Supabase...`);         // upload new locations to supabase

        /*
        use upsert to prevent duplicate data
        */
        const { error: upsertError } = await supabase
            .from('locations')
            .upsert(newLocations, {
                onConflict: 'name', // using 'name' column to prevent duplicate data
                ignoreDuplicates: true // ignore duplicate data
            });

        if (upsertError) {
            throw upsertError;
        }

        console.log('Data uploaded successfully!');
    } catch (err) {
        console.error('An error occurred:', err.message);
    }
}

seedData();