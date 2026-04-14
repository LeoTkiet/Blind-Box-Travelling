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

def generate_place_names(model, province: str, count: int = 20, exclude_names: list[str] | None = None) -> list[str]:
    exclude_text = ""
    if exclude_names and len(exclude_names) > 0:
        sample_excludes: list[str] = []
        start_idx = max(0, len(exclude_names) - 100)
        for i in range(start_idx, len(exclude_names)):
            sample_excludes.append(exclude_names[i])
            
        exclude_text = f"KHÔNG ĐƯỢC sinh ra các địa điểm đã có trong danh sách sau: {', '.join(sample_excludes)}"

    prompt = f"""
    Bạn là một chuyên gia bản đồ. Hãy Liệt kê {count} TÊN ĐỊA ĐIỂM có thật tại {province}, Việt Nam. Chỉ trả về mảng các tên gọi.
    Đa dạng các thể loại: nhà nghỉ, khách sạn, resort, bảo tàng, nhà hàng, quán ăn, quán cà phê, đài tưởng niệm, khu di tích, điểm tham quan, chợ, trung tâm thương mại.
    KHÔNG liệt kê tên các công ty, doanh nghiệp.
    {exclude_text}
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
    raw = f"{raw_category} {name}".lower() # Use both raw_category and name for mapping logic
    
    # exclude company, business, factory, etc.
    if any(k in raw for k in ["công ty", "tnhh", "cổ phần", "cp", "jsc", "company", "co., ltd", "trách nhiệm hữu hạn", "xí nghiệp", "doanh nghiệp", "tập đoàn", "trụ sở", "head office", "nhà trọ", "trọ", "thuốc"]): return "company"
    
    if any(k in raw for k in ["nhà nghỉ", "motel", "guesthouse", "guest house"]): return "motel"
    if any(k in raw for k in ["khách sạn", "hotel", "resort", "homestay", "villa", "boutique", "retreat", "suites", "apartment", "serviced apartment", "hostel"]): return "hotel"
    if any(k in raw for k in ["bảo tàng", "museum", "gallery", "exhibition"]): return "museum"
    if any(k in raw for k in ["nhà hàng", "quán ăn", "restaurant", "bún", "phở", "nướng", "cơm", "lẩu", "pizza", "tiệm ăn", "bistro", "steak", "bbq", "sushi", "eatery", "cuisine", "dining", "food", "mì", "cháo", "hủ tiếu", "chè", "dimsum", "hotpot", "seafood", "hải sản", "ốc "]): return "restaurant"
    if any(k in raw for k in ["tưởng niệm", "memorial", "đài", "lăng", "tượng đài", "bia"]): return "memorial"
    if any(k in raw for k in ["di tích", "phế tích", "ruin", "địa đạo", "historic", "lịch sử", "heritage"]): return "ruins"
    if any(k in raw for k in ["cà phê", "cafe", "coffee", "trà sữa", "bar", "pub", "lounge", "brewing", "craft beer", "tea", "roastery", "beverage", "baker", "bakery", "tiệm bánh"]): return "cafe"
    if any(k in raw for k in ["chợ", "market", "siêu thị", "vincom", "mega market", "mall", "shopping", "mart", "co.op", "store", "cửa hàng", "plaza", "center"]): return "market"
    if any(k in raw for k in ["điểm tham quan", "du lịch", "attraction", "cảnh quan", "đền", "chùa", "khu sinh thái", "công viên", "nhà thờ", "đại học", "university", "cầu", "bridge", "pagoda", "temple", "church", "cathedral", "tourist", "farm", "theatre", "rạp"]): return "attraction"
    
    return "attraction" # default fallback

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
        print("Lỗi: Hãy đặt biến môi trường GEMINI_API_KEY trước khi chạy script.")
        sys.exit(1)
         
    genai.configure(api_key=API_KEY)
    gemini_model = genai.GenerativeModel('gemini-2.5-flash')

    province = "Bình Thạnh"
    target_count = 2000

    scraper = GoogleMapsScraper(headless=False)
    
    try:
        existing_data = []
        if os.path.exists("data.json"):
            with open("data.json", "r", encoding="utf-8") as f:
                try:
                    existing_data = json.load(f)
                    print(f"Đã load {len(existing_data)} địa điểm từ data.json")
                except json.JSONDecodeError:
                    pass

        scraped_names = {p.get("name", "").lower() for p in existing_data if "name" in p}
        
        while len(existing_data) < target_count:
            print(f"\n--- Tiến độ: {len(existing_data)}/{target_count} ---")
            batch_names = generate_place_names(gemini_model, province, count=20, exclude_names=list(scraped_names))
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
                            
                        # Bỏ qua các địa điểm được nhận diện là công ty
                        if p_dict['category'] == 'company':
                            print(f"Bỏ qua công ty/doanh nghiệp: '{p_dict['name']}'...")
                            continue
                        
                        lat1, lng1 = p_dict['lat'], p_dict['lng']
                        is_too_close = False
                        for (lat2, lng2) in accepted_coords_this_query:
                            if (lat1 - lat2)**2 + (lng1 - lng2)**2 < 0.00015:
                                is_too_close = True
                                break
                                
                        if is_too_close:
                            print(f"Bỏ qua kết quả gần trùng lặp của '{p_dict['name']}'...")
                            continue
                            
                        if p_dict["name"].lower() not in scraped_names:
                            existing_data.append(p_dict)
                            scraped_names.add(p_dict["name"].lower())
                            accepted_coords_this_query.append((lat1, lng1))
                            
                            with open("data.json", "w", encoding="utf-8") as f:
                                json.dump(existing_data, f, ensure_ascii=False, indent=4)
                            print(f" [Lưu ngay] Đã thêm mới '{p_dict['name']}' ({p_dict['category']}). Tổng: {len(existing_data)}/{target_count} địa điểm.")
                        else:
                            print(f"Bỏ qua '{p_dict['name']}' vì đã tồn tại trong database.")
                else:
                    print(f"Không tìm được trên Google Maps, bỏ qua '{place_name}'...")
                    
    except KeyboardInterrupt:
        print(f"\n[!] Người dùng ngắt chương trình! Đã lưu {len(existing_data)} địa điểm vào data.json")
    except Exception as e:
        print(f"\n[!] Lỗi bất ngờ: {e}")
    finally:
        scraper.close()