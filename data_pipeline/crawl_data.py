import os
import json
import time
import dataclasses
from typing import List, Optional, Dict, Any
from urllib.parse import urlparse, parse_qs

try:
    import google.generativeai as genai
    from pydantic import BaseModel, Field
    from google.api_core.exceptions import ResourceExhausted
except ImportError as e:
    print(f"Error importing generative AI libraries: {e}")
    print("Please make sure they are installed: pip install google-generativeai pydantic google-api-core")
    exit(1)

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import NoSuchElementException, TimeoutException
except ImportError as e:
    print(f"Error importing selenium: {e}")
    print("Please make sure selenium is installed: pip install selenium")
    exit(1)

class PlaceNamesResponse(BaseModel):
    names: list[str]

def call_gemini_with_retry(model, prompt, schema, temperature=0.7, retries=5):
    import re
    for attempt in range(retries):
        try:
            response = model.generate_content(
                prompt,
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=temperature
                )
            )
            return json.loads(response.text)
        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "quota" in error_msg.lower() or "retry" in error_msg.lower():
                match = re.search(r"retry in (\d+(?:\.\d+)?)s", error_msg)
                wait_time = float(match.group(1)) + 5.0 if match else 60.0
                print(f"[!] Quota vượt hạn mức khi sinh tên. Tạm nghỉ {wait_time:.1f} giây trước khi thử lại (lần {attempt+1}/{retries})...")
                time.sleep(wait_time)
            else:
                print(f"[!] Lỗi khi gọi Gemini: {error_msg}")
                if attempt == retries - 1:
                    return None
                time.sleep(5)
    return None

def generate_place_names(model, province: str, count: int = 20, category_focus: str = "Tất cả các mảng") -> list[str]:
    import random
    focus_areas = ["trung tâm thành phố", "vùng ngoại ô", "gần bãi biển", "khu dân cư đông đúc", "các hẻm nhỏ", "gần chợ", "khu vực lịch sử"]
    focus = random.choice(focus_areas)

    prompt = f"""
    Bạn là một chuyên gia bản đồ am hiểu địa phương. Hãy liệt kê ngẫu nhiên {count} TÊN ĐỊA ĐIỂM có thật tại {province}, Việt Nam.
    Để tránh lặp lại các tên phổ biến, hãy đào sâu tìm kiếm tập trung vào khu vực {focus} hoặc các địa điểm/hẻm nhỏ ít người biết đến.
    
    YÊU CẦU CHUYÊN MÔN:
    1. Chỉ sinh các địa điểm thuộc nhóm loại hình: 🎯 {category_focus}
    2. Tên địa điểm phải CỤ THỂ, RÕ RÀNG (ví dụ: "Quán Ốc Tự Nhiên 2", "Cà Phê Úp Ngược", "Hẻm 42 Trần Phú", không ghi chung chung kiểu "Quán cà phê", "Nhà nghỉ").
    3. CẤM liệt kê: Tên công ty, xí nghiệp, đại lý, ngân hàng, bệnh viện, trạm xăng, trường học, hay doanh nghiệp B2B.
    4. CẤM bịa đặt tên. Tiêu chí hàng đầu là địa điểm PHẢI TỒN TẠI TRÊN GOOGLE MAPS.

    Output bắt buộc phải là một JSON Object tuân thủ chuẩn schema: {{"names": ["Tên 1", "Tên 2", ...]}}. KHÔNG sinh dư thừa lời chào hay định dạng Markdown markdown text.
    """
    
    data = call_gemini_with_retry(model, prompt, PlaceNamesResponse, temperature=0.9)
    if data:
        return data.get("names", [])
    return []

@dataclasses.dataclass
class RawPlace:
    name: str
    category: str
    lat: float
    lng: float
    rating: Optional[float]
    reviews_count: Optional[int]
    url: str
    tags: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "category": self.category,
            "lat": self.lat,
            "lng": self.lng,
            "rating": self.rating,
            "reviews_count": self.reviews_count,
            "tags": self.tags
        }

def map_category(raw_category: str, name: str = "") -> str:
    raw = f"{raw_category} {name}".lower()
    
    if any(k in raw for k in ["công ty", "tnhh", "cổ phần", "cp", "jsc", "company", "co., ltd", "trách nhiệm hữu hạn", "xí nghiệp", "doanh nghiệp", "tập đoàn", "trụ sở", "head office"]): return "company"
    
    if any(k in raw for k in ["nhà nghỉ", "motel", "guesthouse", "guest house"]): return "motel"
    if any(k in raw for k in ["khách sạn", "hotel", "resort", "homestay", "villa", "boutique", "retreat", "suites", "apartment", "serviced apartment", "hostel"]): return "hotel"
    if any(k in raw for k in ["bảo tàng", "museum", "gallery", "exhibition"]): return "museum"
    if any(k in raw for k in ["nhà hàng", "quán ăn", "restaurant", "bún", "phở", "nướng", "cơm", "lẩu", "pizza", "tiệm ăn", "bistro", "steak", "bbq", "sushi", "eatery", "cuisine", "dining", "food", "mì", "cháo", "hủ tiếu", "chè", "dimsum", "hotpot", "seafood", "hải sản", "ốc "]): return "restaurant"
    if any(k in raw for k in ["tưởng niệm", "memorial", "đài", "lăng", "tượng đài", "bia"]): return "memorial"
    if any(k in raw for k in ["di tích", "phế tích", "ruin", "địa đạo", "historic", "lịch sử", "heritage"]): return "ruins"

    if any(k in raw for k in ["rạp chiếu phim", "rạp phim", "cinema", "cgv", "lotte cinema", "galaxy cinema", "bhd", "cinestar", "dcine", "cụm rạp", "movie theater"]): return "cinema"
    if any(k in raw for k in ["cà phê chó", "cà phê mèo", "cà phê thú", "cat cafe", "dog cafe", "pet cafe", "animal cafe", "cà phê hamster", "cà phê thỏ", "cà phê chim", "zoo cafe", "café thú"]): return "animal_cafe"
    if any(k in raw for k in ["toystation", "toy station", "gameplus", "game plus", "khu trò chơi điện tử", "arcade", "gaming center", "esport", "e-sport", "net", "phòng game", "điện tử", "vr gaming", "virtual reality", "vr zone", "laser tag", "lasertag", "trung tâm trò chơi", "amusement", "khu vui chơi trẻ em", "play zone", "game world", "wonder world", "fun world"]): return "gaming"
    if any(k in raw for k in ["workshop", "làm gốm", "vẽ tranh", "làm nến", "lắp ráp mô hình", "lớp học nấu ăn", "lớp nấu ăn", "studio ảnh", "art class", "pottery", "craft", "diy", "sáng tạo", "handmade", "lớp học vẽ", "lớp học thủ công", "creative studio"]): return "workshop"
    if any(k in raw for k in ["bowling", "billiard", "karaoke", "escape room", "go-kart", "go kart", "karting", "paintball", "nhà bóng", "khu liên hợp", "team building", "mini golf", "bắn cung", "axe throwing", "billiards", "snooker", "phòng hát", "vui chơi", "giải trí", "fun city", "happy land", "sky garden", "nhà bóng"]): return "entertainment"
    if any(k in raw for k in ["cà phê", "cafe", "coffee", "trà sữa", "bar", "pub", "lounge", "brewing", "craft beer", "tea", "roastery", "beverage", "baker", "bakery", "tiệm bánh", "board game cafe", "cà phê sách", "book cafe", "cà phê âm nhạc"]): return "cafe"
    if any(k in raw for k in ["chợ", "market", "siêu thị", "vincom", "mega market", "mall", "shopping", "mart", "co.op", "store", "cửa hàng", "plaza", "center"]): return "market"
    if any(k in raw for k in ["điểm tham quan", "du lịch", "attraction", "cảnh quan", "đền", "chùa", "khu sinh thái", "công viên", "nhà thờ", "đại học", "university", "cầu", "bridge", "pagoda", "temple", "church", "cathedral", "tourist", "farm", "theatre", "rạp"]): return "attraction"
    
    return "attraction"

class GoogleMapsScraper:
    def __init__(self, headless: bool = False):
        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        
        self.driver = webdriver.Chrome(options=chrome_options)
        self.wait = WebDriverWait(self.driver, 10)

    def scrape_query(self, query: str, limit: int = 50) -> List[RawPlace]:
        url = f"https://www.google.com/maps/search/{query.replace(' ', '+')}/"
        print(f"Opening Google Maps for query: {query}")
        self.driver.get(url)
        time.sleep(3)
        
        extracted_places = []
        
        if "/maps/place/" in self.driver.current_url:
            print(f"Redirected directly to place page for {query}")
            p = self._extract_place_details(self.driver.current_url)
            if p:
                extracted_places.append(p)
            return extracted_places
            
        try:
            feed = self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'div[role="feed"]')))
        except TimeoutException:
            print("Could not find result feed. Checking if it's a direct place page...")
            p = self._extract_place_details(self.driver.current_url)
            if p:
                extracted_places.append(p)
            return extracted_places

        print("Scrolling results to load more places...")
        places_count = 0
        last_count = 0
        retries = 0

        while places_count < limit and retries < 3:
            self.driver.execute_script('arguments[0].scrollBy(0, 1000);', feed)
            time.sleep(2)
            cards = self.driver.find_elements(By.CSS_SELECTOR, 'a[href*="/maps/place/"]')
            valid_links: List[str] = [str(card.get_attribute("href")) for card in cards if card.get_attribute("href") is not None]
            unique_links: List[str] = list(set(valid_links))
            places_count = len(unique_links)
            
            if places_count > last_count:
                last_count = places_count
                retries = 0
            else:
                retries += 1
                
        import itertools
        raw_links = self.driver.find_elements(By.CSS_SELECTOR, 'a[href*="/maps/place/"]')
        valid_raw_links: List[str] = [str(card.get_attribute("href")) for card in raw_links if card.get_attribute("href") is not None]
        unique_links: List[str] = list(dict.fromkeys(valid_raw_links))
        links_to_process = list(itertools.islice(unique_links, limit))
        
        if not links_to_process:
            p = self._extract_place_details(self.driver.current_url)
            if p:
                extracted_places.append(p)
            return extracted_places
            
        print(f"Processing {len(links_to_process)} places...")

        for link in links_to_process:
            if not link:
                continue
            place_data = self._extract_place_details(link)
            if place_data:
                extracted_places.append(place_data)
                
        return extracted_places

    def _extract_place_details(self, url: str) -> Optional[RawPlace]:
        if url != self.driver.current_url:
            self.driver.get(url)
            time.sleep(2)
        else:
            time.sleep(1)
        try:
            heading = self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "h1")))
            name = heading.get_attribute("textContent").strip()
            if not name:
                time.sleep(2)
                name = heading.get_attribute("textContent").strip()
        except TimeoutException:
            return None

        time.sleep(1)

        try:
            category_elems = self.driver.find_elements(By.CSS_SELECTOR, 'button[jsaction="pane.rating.category"]')
            if category_elems:
                raw_category = category_elems[0].get_attribute("textContent").strip()
            else:
                raw_category = "Unknown"
        except NoSuchElementException:
            raw_category = "Unknown"
            
        category = map_category(raw_category, name)

        rating = None
        reviews_count = None
        try:
            elems = self.driver.find_elements(By.CSS_SELECTOR, '[aria-label]')
            import re
            for elem in elems:
                aria = elem.get_attribute("aria-label").lower()
                
                if rating is None:
                    match_rating = re.search(r'([\d.,]+)\s*(?:stars?|sao)', aria)
                    if match_rating:
                        try:
                            rating = float(match_rating.group(1).replace(",", "."))
                        except Exception:
                            pass
                            
                if reviews_count is None:
                    match_reviews = re.search(r'([\d.,]+)\s*(?:reviews?|đánh giá|bài)', aria)
                    if match_reviews:
                        try:
                            reviews_count = int(match_reviews.group(1).replace(".", "").replace(",", ""))
                        except Exception:
                            pass
                            
                if rating is not None and reviews_count is not None:
                    break
        except Exception:
            pass

        tags = []
        try:
            tag_elems = self.driver.find_elements(By.CSS_SELECTOR, 'div[aria-label][role="button"] > div > span')
            tags = [t.text for t in tag_elems if t.text]
        except NoSuchElementException:
            pass

        lat, lng = 0.0, 0.0
        import re
        current_resolved_url = self.driver.current_url
        
        def extract_coords(u):
            m_at = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', u)
            if m_at:
                return float(m_at.group(1)), float(m_at.group(2))
            m_3d = re.search(r'!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)', u)
            if m_3d:
                return float(m_3d.group(1)), float(m_3d.group(2))
            return 0.0, 0.0
            
        lat, lng = extract_coords(current_resolved_url)
        if lat == 0.0:
            lat, lng = extract_coords(url)

        print(f"Extracted: {name} ({category}) - {rating}⭐ ({reviews_count}) - [{lat}, {lng}]")

        return RawPlace(
            name=name,
            category=category,
            lat=lat,
            lng=lng,
            rating=rating,
            reviews_count=reviews_count,
            url=url,
            tags=list(set(tags))
        )

    def close(self):
        self.driver.quit()

if __name__ == "__main__":
    import sys
    
    API_KEY = os.environ.get("GEMINI_API_KEY")
    if not API_KEY:
        try:
            with open("api_keys.json", "r", encoding="utf-8") as f:
                keys = json.load(f)
                if "GEMINI_API_KEYS" in keys and len(keys["GEMINI_API_KEYS"]) > 0:
                    API_KEY = keys["GEMINI_API_KEYS"][0]
        except Exception:
            pass

    if not API_KEY:
        print("Lỗi: Không tìm thấy GEMINI_API_KEY trong biến môi trường hoặc file api_keys.json.")
        sys.exit(1)
         
    genai.configure(api_key=API_KEY)
    gemini_model = genai.GenerativeModel('gemini-2.5-flash')

    province = "Bình Thạnh"
    target_count = 2000
    OUTPUT_FILE = "hcm_data.json"

    ENTERTAINMENT_QUERIES = [
        # Rạp chiếu phim
        f"rạp chiếu phim {province}",
        f"cinema {province}",
        f"CGV {province}",
        f"Lotte Cinema {province}",
        f"Galaxy Cinema {province}",
        # Gaming / Điện tử
        f"ToyStation {province}",
        f"khu trò chơi điện tử {province}",
        f"arcade game {province}",
        f"VR gaming {province}",
        f"phòng game {province}",
        f"GamePlus {province}",
        # Cà phê thú cưng
        f"cà phê mèo {province}",
        f"cà phê chó {province}",
        f"cat cafe {province}",
        f"pet cafe {province}",
        f"cà phê thú cưng {province}",
        # Workshop / Sáng tạo
        f"workshop {province}",
        f"làm gốm {province}",
        f"lớp học vẽ {province}",
        f"làm nến thơm {province}",
        f"creative studio {province}",
        f"lớp nấu ăn {province}",
        # Hoạt động nhóm / Hội bạn
        f"bowling {province}",
        f"karaoke {province}",
        f"billiards {province}",
        f"escape room {province}",
        f"go-kart {province}",
        f"laser tag {province}",
        f"paintball {province}",
        f"khu vui chơi trong nhà {province}",
        f"nhà bóng {province}",
        f"mini golf {province}",
        f"câu cá giải trí {province}",
        f"trượt patin {province}",
        f"bắn cung {province}",
        f"hồ bơi {province}",
        f"sân bóng đá {province}",
        f"sân tennis {province}",
        f"công viên nước {province}",
        f"khu câu cá {province}",
        # Cà phê đặc biệt
        f"board game cafe {province}",
        f"cà phê sách {province}",
        f"cà phê board game {province}",
        f"cà phê acoustic {province}",
        f"cà phê nhạc sống {province}",
    ]

    scraper = GoogleMapsScraper(headless=False)
    
    try:
        existing_data = []
        if os.path.exists(OUTPUT_FILE):
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                try:
                    existing_data = json.load(f)
                    print(f"Đã load {len(existing_data)} địa điểm từ {OUTPUT_FILE}")
                except json.JSONDecodeError:
                    pass

        scraped_names = {p.get("name", "").lower() for p in existing_data if "name" in p}

        print("\n=== BẮT ĐẦU CRAWL ĐỊA ĐIỂM VUI CHƠI GIẢI TRÍ ===")
        for query in ENTERTAINMENT_QUERIES:
            print(f"\n🎯 Crawl query: {query}")
            new_places = scraper.scrape_query(query, limit=20)
            for p in new_places:
                p_dict = p.to_dict()
                if p_dict.get('lat', 0.0) == 0.0 or p_dict.get('rating') is None or p_dict.get('reviews_count') is None:
                    print(f"  Thiếu dữ liệu cho '{p_dict['name']}', bỏ qua...")
                    continue
                if p_dict['category'] == 'company':
                    print(f"  Bỏ qua công ty: '{p_dict['name']}'...")
                    continue
                if p_dict["name"].lower() not in scraped_names:
                    existing_data.append(p_dict)
                    scraped_names.add(p_dict["name"].lower())
                    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                        json.dump(existing_data, f, ensure_ascii=False, indent=4)
                    print(f"  ✅ [{p_dict['category']}] Thêm: '{p_dict['name']}'. Tổng: {len(existing_data)}/{target_count}")
                else:
                    print(f"  Đã có: '{p_dict['name']}', bỏ qua.")
        print(f"\n=== XONG CRAWL GIẢI TRÍ. Tổng hiện tại: {len(existing_data)} địa điểm ===\n")

        while len(existing_data) < target_count:
            # Randomize category focus for a completely broad AI generation phase
            import random
            general_categories = [
                "Lưu trú (nhà nghỉ, khách sạn nhỏ, homestay, resort bình dân)",
                "Ẩm thực vô danh (quán ăn địa phương, quán ốc, quán vỉa hè, xe đẩy)",
                "Cà phê/Đồ uống (quán cà phê góc phố, tiệm trà, quán nước)",
                "Văn hóa/Di tích (đài tưởng niệm, đền chùa nhỏ, miếu, điểm tham quan độc lạ)",
                "Mua sắm (chợ đêm, chợ truyền thống, tạp hóa lớn, tiệm đặc sản)",
                "Vui chơi giải trí (tiệm net, bida, sân bóng, câu cá, khu vui chơi nhỏ)"
            ]
            current_focus = random.choice(general_categories)

            print(f"\n--- Tiến độ: {len(existing_data)}/{target_count} ---")
            
            batch_names = generate_place_names(gemini_model, province, count=20, category_focus=current_focus)
            if not batch_names:
                print("Gemini không trả về thêm địa điểm nào, chờ 10s rồi thử lại...")
                time.sleep(10)
                continue
                
            for place_name in batch_names:
                if len(existing_data) >= target_count:
                    break
                
                if place_name.lower() in scraped_names:
                    continue
                    
                query = f"{place_name}, {province}"
                new_places = scraper.scrape_query(query)
                
                if new_places:
                    accepted_coords_this_query = []
                    for p in new_places:
                        p_dict = p.to_dict()
                        if p_dict.get('lat', 0.0) == 0.0 or p_dict.get('rating') is None or p_dict.get('reviews_count') is None:
                            print(f"Google Maps thiếu dữ liệu cho '{p_dict['name']}', bỏ qua...")
                            continue
                        
                        if p_dict['category'] == 'company':
                            print(f"Bỏ qua công ty/doanh nghiệp: '{p_dict['name']}'...")
                            continue
                        
                        lat1, lng1 = p_dict['lat'], p_dict['lng']
                        is_too_close = False
                        for (lat2, lng2) in accepted_coords_this_query:
                            if (lat1 - lat2)**2 + (lng1 - lng2)**2 < 0.00000002:
                                is_too_close = True
                                break
                                
                        if is_too_close:
                            print(f"Bỏ qua kết quả gần trùng lặp của '{p_dict['name']}'...")
                            continue
                            
                        if p_dict["name"].lower() not in scraped_names:
                            existing_data.append(p_dict)
                            scraped_names.add(p_dict["name"].lower())
                            accepted_coords_this_query.append((lat1, lng1))
                            
                            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                                json.dump(existing_data, f, ensure_ascii=False, indent=4)
                            print(f" [Lưu ngay] Đã thêm mới '{p_dict['name']}' ({p_dict['category']}). Tổng: {len(existing_data)}/{target_count} địa điểm.")
                        else:
                            print(f"Bỏ qua '{p_dict['name']}' vì đã tồn tại trong database.")
                else:
                    print(f"Không tìm được trên Google Maps, bỏ qua '{place_name}'...")
                    
    except KeyboardInterrupt:
        print(f"\n[!] Người dùng ngắt chương trình! Đã lưu {len(existing_data)} địa điểm vào {OUTPUT_FILE}")
    except Exception as e:
        print(f"\n[!] Lỗi bất ngờ: {e}")
    finally:
        scraper.close()
