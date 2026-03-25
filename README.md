# 🎁 Blind Box Travelling

A travel discovery web application that suggests surprise "blind box" locations for your next trip or hangout.

## 🚀 Current Progress: Data Pipeline

Currently, the project is focusing on building a robust, automated data pipeline to collect real-world location data (restaurants, cafes, museums, attractions, etc.) to seed our database.

### 📍 `data_pipeline/crawl_data.py`
A Python script that combines AI generation and web scraping to build our location dataset:
- **AI-Powered Location Generation:** Uses Google Gemini (`gemini-2.5-flash`) to intelligently generate lists of diverse, real-world places in a specific province.
- **Automated Scraping:** Uses Selenium (`GoogleMapsScraper`) to search for these places on Google Maps and extract metadata.
- **Accurate Extraction:** Extensively extracts exact coordinates (Latitude/Longitude), Google Maps Ratings, Review Counts, Categories, and Location Tags.
- **Smart Deduplication:** Includes built-in coordinate distance algorithms to prevent crawling duplicate branches or nearby pins of the same place.
- **Resilient Fallbacks:** Handles UI edge cases such as direct place page resolutions, missing review metadata, and delayed coordinate loading via original URL inspection.

### 📂 Output
The pipeline exports all scraped and structured location data to `data_pipeline/data.json`. This JSON file will later be used to seed our Supabase PostgreSQL database.

## 💻 Tech Stack
- **Data Pipeline:** Python, Selenium, Google Gemini API
- **Frontend (Upcoming):** Next.js, React
- **Database (Upcoming):** Supabase (PostgreSQL)
