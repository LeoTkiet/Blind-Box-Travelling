"use strict";

const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

// Cấu hình chung
const CONFIG = {
  INPUT_FILE: "data/data.json",
  OUTPUT_FILE: "data/data_enriched.json",

  // Giới hạn bình luận
  MAX_REVIEWS: 50,

  // Thời gian chờ (mili-giây)
  SLEEP_BETWEEN_ACTIONS: 3000,
  SLEEP_AFTER_NAVIGATE: 5000,
  SLEEP_BETWEEN_PLACES: 4000,

  // Giới hạn load DOM
  EXPLICIT_WAIT_TIMEOUT: 15000,

  // ✅ Danh mục hợp lệ đã được mở rộng
  VALID_CATEGORIES: [
    // Ăn uống
    "restaurant",         // Nhà hàng, quán ăn, food court, buffet, street food
    "cafe",               // Quán cà phê, trà, tiệm bánh ngọt, juice bar
    "bar/pub",            // Bar, pub, rooftop bar, bia craft
    "bakery",             // Tiệm bánh, tiệm kem, dessert shop, pastry

    // Lưu trú
    "hotel",              // Khách sạn, resort, nhà nghỉ
    "hostel",             // Hostel, guesthouse, nhà trọ khách du lịch
    "homestay",           // Homestay, villa, bungalow

    // Tham quan & Văn hoá
    "attraction",         // Điểm tham quan, di tích, kiến trúc nổi tiếng, công trình lịch sử, quảng trường
    "museum",             // Bảo tàng, nhà trưng bày, gallery nghệ thuật
    "pagoda/temple",      // Chùa, đền, đình, miếu, nhà thờ, thánh đường
    "park",               // Công viên, vườn hoa, khu sinh thái, vườn thực vật

    // Mua sắm
    "market",             // Chợ truyền thống, chợ đêm, chợ ẩm thực
    "shopping_mall",      // Trung tâm thương mại, siêu thị lớn, khu mua sắm hiện đại
    "souvenir_shop",      // Cửa hàng quà lưu niệm, đồ thủ công mỹ nghệ, đặc sản địa phương

    // Giải trí & Vui chơi
    "entertainment",      // Khu vui chơi, rạp chiếu phim, karaoke, club, sân khấu
    "spa/wellness",       // Spa, massage, yoga, gym, trung tâm sức khoẻ
    "sports",             // Sân thể thao, bowling, sân golf, bể bơi
    "theme_park",         // Công viên chủ đề, công viên nước, khu giải trí tích hợp

    // Thiên nhiên & Phiêu lưu
    "beach",              // Bãi biển, khu biển, hồ tắm thiên nhiên
    "viewpoint",          // Điểm ngắm cảnh, đỉnh núi, cầu kính, tháp quan sát
    "nature",             // Thác nước, hang động, rừng, vườn quốc gia, khu bảo tồn

    // Dịch vụ & Tiện ích có giá trị du lịch
    "transport_hub",      // Bến xe, bến tàu, ga xe lửa, sân bay — điểm di chuyển của du khách
    "event_venue",        // Trung tâm hội nghị, nhà thi đấu, không gian sự kiện
  ],

  // Ẩn giao diện Chrome (true = chạy ngầm)
  HEADLESS: false,
};

// Trạng thái cào dữ liệu
const SCRAPE_STATUS = {
  SUCCESS: "success",
  NO_REVIEWS: "no_reviews",
  PLACE_NOT_FOUND: "place_not_found",
  ERROR: "error",
};

// Khởi tạo AI (Gemini + Groq)
const geminiKey = process.env.GEMINI_API_KEY;
const groqKey = process.env.GROQ_API_KEY;
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const groq = groqKey ? new Groq({ apiKey: groqKey }) : null;

// System instruction cho Gemini (vai trò: Analyst)
const GEMINI_SYSTEM_INSTRUCTION = `Bạn là chuyên gia phân tích và phân loại địa điểm du lịch tại Việt Nam.
Nhiệm vụ của bạn: đọc kỹ dữ liệu thực tế (bình luận + loại hình Google Maps) để xác định category và tags chính xác nhất.
QUAN TRỌNG:
- Phân loại hoàn toàn DỰA TRÊN DỮ LIỆU THỰC TẾ (bình luận + placeType từ Google Maps).
- KHÔNG copy category gốc từ dữ liệu input — có thể sai.
- placeType (chữ nhỏ dưới tên địa điểm trên Google Maps) là tín hiệu RẤT ĐÁNG TIN CẬY, ưu tiên cao.
- Chỉ trả về JSON hợp lệ, không markdown, không giải thích.`;

// System instruction cho Groq (vai trò: Supervisor/Validator)
const GROQ_SUPERVISOR_INSTRUCTION = `Bạn là giám thị kiểm định chất lượng dữ liệu địa điểm du lịch tại Việt Nam.
Nhiệm vụ: nhận kết quả phân tích từ AI khác (Gemini) và KIỂM TRA lại tính chính xác.
Nếu kết quả đúng → xác nhận và trả về nguyên vẹn.
Nếu kết quả SAI hoặc THIẾU → sửa lại và/hoặc bổ sung tags phù hợp, giải thích ngắn lý do thay đổi.
Luôn ưu tiên placeType (loại hình Google Maps) và bình luận thực tế làm bằng chứng.
Chỉ trả về JSON hợp lệ, không markdown, không giải thích ngoài trường "supervisorNote".`;

// Tiện ích sleep
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tiện ích đọc/ghi file JSON
function readInputData(filePath) {
  console.log(`\n Đang đọc dữ liệu từ: ${filePath}`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Không tìm thấy file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);
  console.log(` Đọc thành công ${data.length} địa điểm.`);
  return data;
}

function saveEnrichedPlace(filePath, enrichedPlace) {
  let existingData = [];

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      existingData = JSON.parse(raw);
    } catch {
      existingData = [];
    }
  }

  const idx = existingData.findIndex(
    (p) =>
      p.name === enrichedPlace.name &&
      p.lat === enrichedPlace.lat &&
      p.lng === enrichedPlace.lng
  );

  if (idx !== -1) {
    existingData[idx] = enrichedPlace;
  } else {
    existingData.push(enrichedPlace);
  }

  fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), "utf-8");
}

// Cài đặt Selenium WebDriver
async function buildDriver() {
  console.log("\n🚀 Khởi tạo Selenium WebDriver (Chrome)...");

  const options = new chrome.Options();

  if (CONFIG.HEADLESS) {
    options.addArguments("--headless=new");
  }

  options.addArguments("--no-sandbox");
  options.addArguments("--disable-dev-shm-usage");
  options.addArguments("--disable-blink-features=AutomationControlled");
  options.addArguments("--window-size=1366,768");
  options.addArguments(
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  options.excludeSwitches(["enable-automation"]);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  console.log("✅ WebDriver khởi tạo thành công.");
  return driver;
}

// BƯỚC 2: CÀO BÌNH LUẬN GOOGLE MAPS

/**
 * Kiểm tra xem có đúng là trang địa điểm cụ thể không.
 */
async function isValidPlacePage(driver) {
  try {
    const url = await driver.getCurrentUrl();
    if (url.includes("/maps/place/") || url.includes("/place/")) {
      return true;
    }
    if (url.includes("/maps/search/") || url.includes("/search/")) {
      const firstResult = await driver.findElements(
        By.css("a[href*='/maps/place/'], div[data-result-index='0'] a")
      );
      if (firstResult.length > 0) {
        await firstResult[0].click();
        await sleep(CONFIG.SLEEP_AFTER_NAVIGATE);
        const newUrl = await driver.getCurrentUrl();
        return newUrl.includes("/maps/place/") || newUrl.includes("/place/");
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Kiểm tra xem địa điểm có bình luận hay không.
 */
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
  } catch {
    return true;
  }
}

/**
 * Truy cập Google Maps và thu thập text bình luận + placeType.
 * @returns {{ status: string, reviews: string[], placeType: string }}
 */
async function scrapeReviews(driver, place) {
  const { name, lat, lng } = place;

  const url = `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
  console.log(`\n  🌐 Điều hướng tới: ${url}`);

  await driver.get(url);
  await sleep(CONFIG.SLEEP_AFTER_NAVIGATE);

  // Bước 2a: Xác định đúng trang
  const validPage = await isValidPlacePage(driver);
  if (!validPage) {
    console.warn(`  ⚠️  Không tìm thấy địa điểm khớp trên Google Maps.`);
    return { status: SCRAPE_STATUS.PLACE_NOT_FOUND, reviews: [], placeType: "" };
  }

  // Bước 2a+: Đọc loại hình địa điểm (chữ nhỏ dưới tên - placeType)
  // Đây là tín hiệu rất quan trọng được truyền cho cả Gemini và Groq
  let placeType = await driver.executeScript(`
    // Cách 1: Qua nút chức năng
    const categoryBtn = document.querySelector("button[jsaction*='category']");
    if (categoryBtn && categoryBtn.innerText) return categoryBtn.innerText.trim();

    // Cách 2: Tìm text kề H1 (Header)
    const header = document.querySelector("h1");
    if (header) {
      let sibling = header.parentElement?.nextElementSibling;
      for (let i = 0; i < 5 && sibling; i++) {
        const text = sibling.innerText?.trim();
        if (text && text.length > 1 && text.length < 50 && !/\\d{3,}/.test(text)) {
          if (!/giờ|open|close|star|sao|đánh giá|review/i.test(text)) {
            return text;
          }
        }
        sibling = sibling.nextElementSibling;
      }
    }

    // Cách 3: Quét qua các lớp CSS đặc thù của Maps
    const typeCandidates = document.querySelectorAll(".DkEaL, .skqShb, .mgr77e, .LrzXr, span[jstcache]");
    for (const el of typeCandidates) {
      const t = el.innerText?.trim();
      if (t && t.length > 1 && t.length < 50 && !/\\d{3,}/.test(t) && !/giờ|open|close/i.test(t)) {
        return t;
      }
    }

    return "";
  `);

  if (placeType) {
    console.log(`  🏷️  Loại hình trên Google Maps: "${placeType}"`);
  }

  // Bước 2b: Kiểm tra số lượng đánh giá
  const reviewsExist = await hasAnyReviews(driver);
  if (!reviewsExist) {
    console.log(`  ℹ️  Địa điểm chưa có bình luận nào trên Google Maps.`);
    return { status: SCRAPE_STATUS.NO_REVIEWS, reviews: [], placeType };
  }

  // Bước 2c: Mở tab Đánh giá
  let reviewTabFound = await driver.executeScript(`
    const tabs = Array.from(document.querySelectorAll("button, div[role='tab']"));
    const reviewTab = tabs.find(t => {
       const text = (t.innerText || t.getAttribute('aria-label') || "").toLowerCase();
       return text.includes("đánh giá") || text.includes("reviews") || text === "review";
    });
    if (reviewTab) {
       reviewTab.click();
       return true;
    }
    return false;
  `);

  if (!reviewTabFound) {
    console.warn(`  ⚠️  Không click được tab Đánh giá qua JS, thử dùng XPath...`);
    const reviewTabSelectors = [
      "//button[@aria-label[contains(., 'Reviews')]]",
      "//button[@aria-label[contains(., 'Đánh giá')]]",
      "//div[@role='tab'][contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'review')]",
      "//div[@role='tab'][contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'đánh giá')]",
    ];
    for (const selector of reviewTabSelectors) {
      try {
        const tab = await driver.wait(until.elementLocated(By.xpath(selector)), 3000);
        await tab.click();
        reviewTabFound = true;
        break;
      } catch { }
    }
  }

  if (reviewTabFound) {
    console.log(`  ✅ Đã chuyển sang tab Đánh giá.`);
    await sleep(CONFIG.SLEEP_BETWEEN_ACTIONS);
  } else {
    console.warn(`  ⚠️  Không tìm thấy tab Đánh giá cụ thể (có thể đang hiển thị tất cả).`);
  }

  await sleep(2000);

  // Bước 2d: Cuộn để tải thêm bình luận
  const scrollTimes = Math.ceil(CONFIG.MAX_REVIEWS / 5);
  for (let i = 0; i < scrollTimes; i++) {
    await driver.executeScript(`
      let scrollBox = document.querySelector(".rLxhL") || document.querySelector(".DxyBCb, .dS8AEf") || document.querySelector("div[role='main']");
      if (!scrollBox) {
        const reviews = document.querySelectorAll("[data-review-id]");
        if (reviews.length > 0) scrollBox = reviews[0].parentElement.parentElement;
      }
      if (scrollBox) {
         scrollBox.scrollTop = scrollBox.scrollHeight;
      } else {
         window.scrollBy(0, 1000);
      }
    `);
    await sleep(CONFIG.SLEEP_BETWEEN_ACTIONS);
  }
  console.log(`  📜 Đã scroll ${scrollTimes} lần để tải bình luận.`);

  // Bước 2e: Mở rộng đoạn text dài bị ẩn
  await driver.executeScript(`
    document.querySelectorAll("button.w8nwRe, span.w8nwRe, button[aria-label*='See more'], button[aria-label*='Xem thêm'], button[aria-expanded='false']").forEach(btn => {
      try { 
         if (/[Mm]ore|[Tt]hêm/.test(btn.innerText || "")) btn.click();
      } catch (e) {}
    });
  `);
  await sleep(1000);

  // Bước 2f: Trích xuất text bình luận
  let reviews = await driver.executeScript(`
    return Array.from(document.querySelectorAll("[data-review-id]")).map(el => {
      const exactSpan = el.querySelector(".wiI7pd") || el.querySelector(".MyEned span");
      if (exactSpan && exactSpan.innerText) return exactSpan.innerText.trim();
      
      const spans = el.querySelectorAll("span");
      let longestText = "";
      for (const s of spans) {
        if (s.innerText && s.innerText.length > longestText.length) {
           longestText = s.innerText.trim();
        }
      }
      return longestText;
    }).filter(text => text.length > 5);
  `);

  if (reviews.length > CONFIG.MAX_REVIEWS) {
    reviews = reviews.slice(0, CONFIG.MAX_REVIEWS);
  }

  if (reviews.length === 0) {
    return { status: SCRAPE_STATUS.ERROR, reviews: [], placeType: placeType || "" };
  }

  console.log(`  💬 Cào được ${reviews.length} bình luận.`);
  return { status: SCRAPE_STATUS.SUCCESS, reviews, placeType: placeType || "" };
}

// BƯỚC 3: XÂY DỰNG NGỮ CẢNH

/** Tạo bối cảnh và chấm điểm tin cậy cho AI */
function buildReviewContext(place, scrapeResult) {
  const { status, reviews, placeType } = scrapeResult;

  // placeType là tín hiệu quan trọng — luôn đưa vào context
  const placeTypeInfo = placeType
    ? `\n- Loại hình trên Google Maps (chữ nhỏ dưới tên địa điểm — RẤT ĐÁNG TIN CẬY): "${placeType}"`
    : "";

  switch (status) {
    case SCRAPE_STATUS.SUCCESS:
      return {
        confidence: "high",
        contextBlock:
          `Thông tin bổ sung từ Google Maps:${placeTypeInfo}\n\n` +
          `Có ${reviews.length} bình luận thực tế từ khách tham quan:\n` +
          reviews.map((r, i) => `${i + 1}. ${r}`).join("\n"),
      };

    case SCRAPE_STATUS.NO_REVIEWS:
      return {
        confidence: placeType ? "medium" : "low",
        contextBlock:
          `Thông tin bổ sung từ Google Maps:${placeTypeInfo}\n\n` +
          `Địa điểm này tồn tại trên Google Maps nhưng chưa có bình luận nào.\n` +
          `Hãy phân tích dựa trên tên địa điểm${placeType ? " và loại hình Google Maps" : ""}.`,
      };

    case SCRAPE_STATUS.PLACE_NOT_FOUND:
      return {
        confidence: "low",
        contextBlock:
          `Không tìm thấy địa điểm này trên Google Maps.\n` +
          `Hãy phân tích thuần túy dựa trên tên địa điểm và category gợi ý.`,
      };

    case SCRAPE_STATUS.ERROR:
    default:
      return {
        confidence: "low",
        contextBlock:
          `Thông tin bổ sung từ Google Maps:${placeTypeInfo}\n\n` +
          `Quá trình cào dữ liệu gặp lỗi kỹ thuật, không thu thập được bình luận.\n` +
          `Hãy phân tích dựa trên tên địa điểm${placeType ? " và loại hình Google Maps" : ""}.`,
      };
  }
}

// BƯỚC 4: PHÂN TÍCH AI (Gemini Analyst → Groq Supervisor)

/**
 * Tạo prompt phân tích cho Gemini (Analyst).
 * Truyền đầy đủ: tên, toạ độ, placeType, bình luận, danh sách categories.
 */
function buildGeminiAnalystPrompt(place, contextBlock) {
  const categoriesTable = CONFIG.VALID_CATEGORIES.map(cat => {
    const descriptions = {
      "restaurant": "Nhà hàng, quán ăn, food court, buffet, bếp gia đình, quán vỉa hè",
      "cafe": "Quán cà phê, quán trà, juice bar, tiệm bánh ngọt, bubble tea",
      "bar/pub": "Bar, pub, rooftop bar, bia craft, wine bar, cocktail lounge",
      "bakery": "Tiệm bánh mì, tiệm bánh ngọt, tiệm kem, dessert shop",
      "hotel": "Khách sạn, resort, motel — có dịch vụ lưu trú đầy đủ",
      "hostel": "Hostel, guesthouse, nhà trọ dành cho khách du lịch bụi",
      "homestay": "Homestay, villa, bungalow, căn hộ cho thuê ngắn ngày",
      "attraction": "Điểm tham quan, di tích, công trình lịch sử nổi tiếng, quảng trường, tượng đài, toà nhà mang giá trị du lịch (VD: Bưu điện TP.HCM, Nhà hát Lớn)",
      "museum": "Bảo tàng, nhà trưng bày, gallery nghệ thuật, triển lãm thường trực",
      "pagoda/temple": "Chùa, đền, đình, miếu, nhà thờ Thiên Chúa giáo, thánh đường Hồi giáo",
      "park": "Công viên đô thị, vườn hoa, khu sinh thái, vườn thực vật, thảo cầm viên",
      "market": "Chợ truyền thống, chợ đêm, chợ ẩm thực đường phố",
      "shopping_mall": "Trung tâm thương mại, siêu thị lớn, khu mua sắm hiện đại (Vincom, Aeon...)",
      "souvenir_shop": "Cửa hàng lưu niệm, đồ thủ công mỹ nghệ, đặc sản địa phương, cửa hàng thổ cẩm",
      "entertainment": "Rạp phim, karaoke, vũ trường, club, sân khấu ca nhạc, khu vui chơi trẻ em",
      "spa/wellness": "Spa, massage, trung tâm yoga, gym, phòng tập thể dục, beauty salon",
      "sports": "Sân bóng, bowling, sân golf, bể bơi, sân tennis, khu thể thao tổng hợp",
      "theme_park": "Công viên chủ đề, công viên nước, khu giải trí tổng hợp (Đầm Sen, Suối Tiên...)",
      "beach": "Bãi biển, khu nghỉ dưỡng biển, hồ bơi tự nhiên, suối nước",
      "viewpoint": "Điểm ngắm cảnh, đỉnh núi, cầu kính, tháp quan sát, rooftop view",
      "nature": "Thác nước, hang động, rừng nguyên sinh, vườn quốc gia, khu bảo tồn thiên nhiên",
      "transport_hub": "Bến xe, bến tàu, ga xe lửa — điểm trung chuyển du khách quan trọng",
      "event_venue": "Trung tâm hội nghị, nhà thi đấu, hội trường lớn, không gian tổ chức sự kiện",
    };
    return `| "${cat}" | ${descriptions[cat] || cat} |`;
  }).join("\n");

  return `
Bạn là chuyên gia phân tích địa điểm du lịch tại Việt Nam. Nhiệm vụ: phân tích dữ liệu thực tế để phân loại chính xác cho hệ thống smart search du lịch.

## Thông tin địa điểm
- Tên: ${place.name}
- Toạ độ: ${place.lat}, ${place.lng}
- Category GỐC trong dữ liệu (⚠️ CÓ THỂ SAI — KHÔNG tin, hãy tự phân tích độc lập): "${place.category}"

## Dữ liệu thực tế từ Google Maps
${contextBlock}

## Nhiệm vụ
Trả về JSON với đúng 2 trường:

### 1. "category"
Phân loại DỰA TRÊN DỮ LIỆU THỰC TẾ (placeType + bình luận). Ưu tiên placeType (chữ nhỏ dưới tên trên Google Maps) vì đây là nhãn chính thức.
Chọn đúng 1 trong các giá trị sau:

| Category | Dùng khi địa điểm là... |
|---|---|
${categoriesTable}

**Quy tắc quan trọng:**
- "Bưu điện TP.HCM", "Nhà hát Lớn", công trình lịch sử nổi tiếng → "attraction"
- Nhà thờ, chùa, thánh đường bất kể hệ phái → "pagoda/temple"
- Chợ Bến Thành, Chợ Đêm → "market" (không phải shopping_mall)
- Vincom, AEON, Takashimaya → "shopping_mall" (không phải market)
- Đầm Sen, Suối Tiên → "theme_park" (không phải entertainment)
- Nếu địa điểm có chức năng kép (VD: cafe + view đẹp) → chọn theo chức năng CHÍNH

### 2. "tags"
Mảng tối đa 10 tags, **viết thường, tiếng Việt không dấu, không dấu gạch ngang**.
Phục vụ người dùng TÌM KIẾM địa điểm theo nhu cầu cụ thể.

**Chọn tags từ các chiều sau (không cần đủ tất cả, chỉ lấy tags thật sự phù hợp):**
1. **Loại hình** — địa điểm này LÀ GÌ? VD: "di tich lich su", "cho dem", "ca phe san vuon", "buffet hai san"
2. **Đối tượng** — AI nên đến? VD: "gia dinh co tre em", "cap doi", "nhom ban", "du khach nuoc ngoai"  
3. **Trải nghiệm** — đến để LÀM GÌ? VD: "chup anh check-in", "tham quan mien phi", "mua sam dac san"
4. **Thời điểm** — khi nào phù hợp? VD: "ve dem", "buoi sang som", "cuoi tuan"
5. **Đặc điểm nổi bật** — điều gì KHÁC BIỆT? VD: "kien truc phap co", "view song", "khong gian xanh"

**KHÔNG dùng:** "sach se", "phuc vu tot", "dang di", "dep", "hay" (quá chung chung)
**KHÔNG dùng:** tags về dịch vụ phi du lịch như "gui hang", "giao hang", "thu phi"

Chỉ trả về JSON, không có text nào khác.
`.trim();
}

/**
 * Tạo prompt giám sát cho Groq (Supervisor).
 * Nhận toàn bộ context + kết quả từ Gemini để xác minh.
 */
function buildGroqSupervisorPrompt(place, contextBlock, geminiResult) {
  const validCatList = CONFIG.VALID_CATEGORIES.map(c => `"${c}"`).join(", ");

  return `
Bạn là giám thị kiểm định dữ liệu địa điểm du lịch. Nhiệm vụ: xem xét kết quả phân tích từ AI Analyst (Gemini) và xác nhận hoặc sửa lại nếu phát hiện sai sót.

## Thông tin địa điểm
- Tên: ${place.name}
- Toạ độ: ${place.lat}, ${place.lng}
- Category GỐC (có thể sai): "${place.category}"

## Dữ liệu thực tế từ Google Maps
${contextBlock}

## Kết quả từ AI Analyst (Gemini) cần kiểm tra
\`\`\`json
${JSON.stringify(geminiResult, null, 2)}
\`\`\`

## Nhiệm vụ giám sát
Đọc kỹ dữ liệu thực tế (đặc biệt placeType từ Google Maps và bình luận) rồi đánh giá:

1. **Category có chính xác không?**
   - Phải là một trong: ${validCatList}
   - Có khớp với placeType (chữ nhỏ dưới tên trên Google Maps) không?
   - Có khớp với nội dung bình luận thực tế không?

2. **Tags có đầy đủ và phù hợp không?**
   - Có thiếu tags quan trọng nào từ bình luận/placeType không?
   - Có tags nào không phù hợp hoặc quá chung chung không?

## Trả về JSON với 3 trường:
- "category": Giữ nguyên hoặc sửa lại category đúng nhất
- "tags": Giữ nguyên, bổ sung hoặc thay thế — tối đa 10 tags, viết thường tiếng Việt không dấu
- "supervisorNote": Chuỗi ngắn (1-2 câu) giải thích quyết định. Nếu giữ nguyên: "Xác nhận kết quả Gemini chính xác." Nếu sửa: ghi rõ đã thay đổi gì và tại sao.

Chỉ trả về JSON hợp lệ, không markdown, không text nào khác ngoài JSON.
`.trim();
}

/**
 * Phân loại lỗi API để in log rõ ràng hơn.
 * @returns {{ type: string, detail: string }}
 */
function classifyAPIError(err) {
  const msg = err.message || "";
  const status = err.status || err.statusCode || err.code || "";

  if (/401|403|invalid.*key|authentication/i.test(`${msg} ${status}`)) {
    return { type: "AUTH", detail: "API key không hợp lệ hoặc đã hết hạn" };
  }
  if (/429|rate.?limit|quota|resource.?exhausted/i.test(`${msg} ${status}`)) {
    return { type: "RATE_LIMIT", detail: "Hết hạn ngạch (rate limit / quota exceeded)" };
  }
  if (/500|502|503|504|unavailable|internal/i.test(`${msg} ${status}`)) {
    return { type: "SERVER", detail: "Lỗi phía server (5xx)" };
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|network/i.test(`${msg} ${status}`)) {
    return { type: "NETWORK", detail: "Lỗi mạng hoặc timeout" };
  }
  return { type: "UNKNOWN", detail: msg || "Lỗi không xác định" };
}

// Bộ đếm lỗi liên tiếp cho từng AI — dùng để phát hiện lỗi kéo dài
const aiErrorTracker = {
  gemini: { consecutiveFailures: 0, lastError: null },
  groq:   { consecutiveFailures: 0, lastError: null },
};

// Ngưỡng lỗi liên tiếp — vượt qua sẽ kích hoạt cảnh báo nghiêm trọng
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Gọi Gemini với vai trò Analyst.
 * Trả về kết quả JSON hoặc null nếu lỗi (đồng thời cập nhật error tracker).
 */
async function callGeminiAnalyst(userPrompt) {
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    });
    const res = await model.generateContent(userPrompt);
    const raw = res.response.text() || "{}";
    const parsed = JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());

    // Reset tracker khi thành công
    aiErrorTracker.gemini.consecutiveFailures = 0;
    aiErrorTracker.gemini.lastError = null;
    return parsed;
  } catch (err) {
    const classified = classifyAPIError(err);
    aiErrorTracker.gemini.consecutiveFailures++;
    aiErrorTracker.gemini.lastError = classified;
    console.warn(`    ⚠️  Gemini Analyst lỗi [${classified.type}]: ${classified.detail}`);
    console.warn(`    📊 Gemini lỗi liên tiếp: ${aiErrorTracker.gemini.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`);
    return null;
  }
}

/**
 * Gọi Groq với vai trò Supervisor — nhận kết quả Gemini để kiểm định.
 * Trả về kết quả JSON hoặc null nếu lỗi (đồng thời cập nhật error tracker).
 */
async function callGroqSupervisor(supervisorPrompt) {
  if (!groq) return null;
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: GROQ_SUPERVISOR_INSTRUCTION },
        { role: "user", content: supervisorPrompt },
      ],
      temperature: 0.1, // Thấp hơn để Groq đưa ra quyết định nhất quán hơn
      max_tokens: 600,
      response_format: { type: "json_object" },
    });
    const raw = res.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());

    // Reset tracker khi thành công
    aiErrorTracker.groq.consecutiveFailures = 0;
    aiErrorTracker.groq.lastError = null;
    return parsed;
  } catch (err) {
    const classified = classifyAPIError(err);
    aiErrorTracker.groq.consecutiveFailures++;
    aiErrorTracker.groq.lastError = classified;
    console.warn(`    ⚠️  Groq Supervisor lỗi [${classified.type}]: ${classified.detail}`);
    console.warn(`    📊 Groq lỗi liên tiếp: ${aiErrorTracker.groq.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`);
    return null;
  }
}

/**
 * Gọi Groq với vai trò Analyst (fallback khi Gemini lỗi).
 * Dùng cùng prompt Analyst nhưng gọi qua Groq thay vì Gemini.
 */
async function callGroqAnalystFallback(analystPrompt) {
  if (!groq) return null;
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: GEMINI_SYSTEM_INSTRUCTION },
        { role: "user", content: analystPrompt },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });
    const raw = res.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());

    // Reset tracker khi thành công
    aiErrorTracker.groq.consecutiveFailures = 0;
    aiErrorTracker.groq.lastError = null;
    return parsed;
  } catch (err) {
    const classified = classifyAPIError(err);
    aiErrorTracker.groq.consecutiveFailures++;
    aiErrorTracker.groq.lastError = classified;
    console.warn(`    ⚠️  Groq Analyst (fallback) lỗi [${classified.type}]: ${classified.detail}`);
    console.warn(`    📊 Groq lỗi liên tiếp: ${aiErrorTracker.groq.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`);
    return null;
  }
}

// Chuẩn hoá kết quả AI
function validateAIResult(raw, fallbackCategory) {
  if (!raw || typeof raw !== "object") return null;
  const result = { ...raw };

  if (!CONFIG.VALID_CATEGORIES.includes(result.category)) {
    console.warn(`    ⚠️  Category "${result.category}" không hợp lệ → fallback về "${fallbackCategory}"`);
    result.category = fallbackCategory;
  }
  if (!Array.isArray(result.tags)) result.tags = [];
  result.tags = result.tags
    .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
    .filter((t) => t.length > 2)
    .slice(0, 10);

  return result;
}

/**
 * Kiểm tra xem 1 AI cụ thể có đang lỗi liên tiếp quá ngưỡng không.
 * Nếu lỗi liên tiếp >= MAX_CONSECUTIVE_FAILURES → coi như AI đó "chết".
 */
function isAIPersistentlyFailing(aiName) {
  const tracker = aiErrorTracker[aiName];
  return tracker.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
}

/**
 * Tạo thông báo lỗi chi tiết khi cả 2 AI đều thất bại.
 */
function buildDualFailureErrorMessage() {
  const geminiInfo = aiErrorTracker.gemini.lastError
    ? `Gemini: [${aiErrorTracker.gemini.lastError.type}] ${aiErrorTracker.gemini.lastError.detail} (lỗi liên tiếp: ${aiErrorTracker.gemini.consecutiveFailures})`
    : "Gemini: không có API key";
  const groqInfo = aiErrorTracker.groq.lastError
    ? `Groq: [${aiErrorTracker.groq.lastError.type}] ${aiErrorTracker.groq.lastError.detail} (lỗi liên tiếp: ${aiErrorTracker.groq.consecutiveFailures})`
    : "Groq: không có API key";

  return (
    "🛑 CẢ 2 AI ĐỀU THẤT BẠI — DỪNG CHƯƠNG TRÌNH!\n" +
    "─".repeat(50) + "\n" +
    `  • ${geminiInfo}\n` +
    `  • ${groqInfo}\n` +
    "─".repeat(50) + "\n" +
    "Gợi ý khắc phục:\n" +
    "  1. Kiểm tra kết nối mạng\n" +
    "  2. Xác nhận API key còn hiệu lực (chưa hết hạn ngạch)\n" +
    "  3. Thử lại sau vài phút nếu lỗi rate limit / server\n" +
    "  4. Chạy lại script — các địa điểm đã xử lý sẽ được bỏ qua tự động."
  );
}

/**
 * Phân tích với pipeline Gemini Analyst → Groq Supervisor (tuần tự).
 *
 * Chiến lược xử lý lỗi:
 *  • Gemini OK + Groq OK  → Dual pipeline (Analyst → Supervisor) ✅
 *  • Gemini OK + Groq lỗi → Dùng kết quả Gemini (gemini-only) ⚠️
 *  • Gemini lỗi + Groq OK → Groq tự phân tích fallback (groq-only) ⚠️
 *  • Cả 2 lỗi             → DỪNG CHƯƠNG TRÌNH ngay lập tức 🛑
 *
 *  Ngoài ra: nếu 1 AI lỗi liên tiếp >= MAX_CONSECUTIVE_FAILURES lần,
 *  in cảnh báo nghiêm trọng để người dùng biết AI đó có thể đã "chết".
 */
async function analyzeWithAI(place, scrapeResult) {
  const { confidence, contextBlock } = buildReviewContext(place, scrapeResult);
  const geminiPrompt = buildGeminiAnalystPrompt(place, contextBlock);

  let finalResult;
  let aiSource;
  let supervisorNote = "";

  // === BƯỚC 1: Gemini Analyst phân tích ===
  console.log(`  🔍 [Bước 1/2] Gemini Analyst đang phân tích...`);
  const geminiRaw = await callGeminiAnalyst(geminiPrompt);
  const geminiResult = geminiRaw ? validateAIResult(geminiRaw, place.category) : null;

  if (geminiResult) {
    console.log(`    → Gemini: category="${geminiResult.category}", tags=[${geminiResult.tags.slice(0, 3).join(", ")}...]`);
  } else {
    console.warn(`    → Gemini không trả kết quả hoặc lỗi.`);
    // Cảnh báo nếu Gemini lỗi liên tiếp nhiều lần
    if (isAIPersistentlyFailing("gemini")) {
      console.error(`    🔴 CẢNH BÁO: Gemini đã lỗi liên tiếp ${aiErrorTracker.gemini.consecutiveFailures} lần!`);
      console.error(`       Loại lỗi: [${aiErrorTracker.gemini.lastError?.type}] ${aiErrorTracker.gemini.lastError?.detail}`);
    }
  }

  // === BƯỚC 2: Xử lý theo kết quả Gemini ===

  if (geminiResult && groq) {
    // ────────────────────────────────────────────
    // CASE 1: Gemini OK + Groq available → Pipeline đầy đủ
    // ────────────────────────────────────────────
    console.log(`  🔎 [Bước 2/2] Groq Supervisor đang kiểm định...`);
    const supervisorPrompt = buildGroqSupervisorPrompt(place, contextBlock, geminiResult);
    const groqRaw = await callGroqSupervisor(supervisorPrompt);
    const groqResult = groqRaw ? validateAIResult(groqRaw, geminiResult.category) : null;

    if (groqResult) {
      // Groq OK → so sánh với Gemini
      supervisorNote = groqRaw.supervisorNote || "";
      const categoryChanged = groqResult.category !== geminiResult.category;
      const tagsChanged = JSON.stringify(groqResult.tags.sort()) !== JSON.stringify(geminiResult.tags.sort());

      if (categoryChanged || tagsChanged) {
        console.log(`    → Groq đã sửa: category="${groqResult.category}" (Gemini đề xuất: "${geminiResult.category}")`);
        if (supervisorNote) console.log(`    → Lý do: ${supervisorNote}`);
        aiSource = "groq-corrected";
      } else {
        console.log(`    → Groq xác nhận kết quả Gemini ✅`);
        aiSource = "dual-confirmed";
      }
      finalResult = { category: groqResult.category, tags: groqResult.tags };

    } else {
      // Groq lỗi → fallback về Gemini (1 AI lỗi, vẫn tiếp tục)
      console.warn(`    ⚠️  Groq Supervisor lỗi — fallback giữ kết quả Gemini.`);
      if (isAIPersistentlyFailing("groq")) {
        console.error(`    🔴 CẢNH BÁO: Groq đã lỗi liên tiếp ${aiErrorTracker.groq.consecutiveFailures} lần!`);
        console.error(`       Loại lỗi: [${aiErrorTracker.groq.lastError?.type}] ${aiErrorTracker.groq.lastError?.detail}`);
        console.error(`       → Pipeline đang chạy ở chế độ Gemini-only (giảm độ chính xác).`);
      }
      finalResult = geminiResult;
      aiSource = "gemini-only";
    }

  } else if (geminiResult && !groq) {
    // ────────────────────────────────────────────
    // CASE 2: Gemini OK + Không có Groq key
    // ────────────────────────────────────────────
    finalResult = geminiResult;
    aiSource = "gemini-only";
    console.log(`  ℹ️  Chỉ có Gemini (không có GROQ_API_KEY).`);

  } else if (!geminiResult && groq) {
    // ────────────────────────────────────────────
    // CASE 3: Gemini lỗi + Groq available → Groq tự phân tích (fallback)
    // ────────────────────────────────────────────
    console.log(`  🔎 Gemini lỗi, Groq tự phân tích (fallback mode)...`);
    const groqFallbackRaw = await callGroqAnalystFallback(geminiPrompt);
    const groqFallbackResult = groqFallbackRaw ? validateAIResult(groqFallbackRaw, place.category) : null;

    if (groqFallbackResult) {
      // Groq fallback OK → 1 AI lỗi (Gemini), vẫn tiếp tục
      finalResult = groqFallbackResult;
      aiSource = "groq-only";
      console.log(`    → Groq fallback: category="${groqFallbackResult.category}", tags=[${groqFallbackResult.tags.slice(0, 3).join(", ")}...]`);
    } else {
      // ────────────────────────────────────────────
      // CẢ 2 AI ĐỀU LỖI → DỪNG CHƯƠNG TRÌNH
      // ────────────────────────────────────────────
      throw new Error(buildDualFailureErrorMessage());
    }

  } else if (!geminiResult && !groq) {
    // ────────────────────────────────────────────
    // CASE 4: Gemini lỗi + Không có Groq key → Không còn AI nào
    // ────────────────────────────────────────────
    throw new Error(buildDualFailureErrorMessage());

  } else {
    // ────────────────────────────────────────────
    // CASE 5: Không có key nào / edge case
    // ────────────────────────────────────────────
    throw new Error(buildDualFailureErrorMessage());
  }

  console.log(`  ✅ Kết quả cuối: category="${finalResult.category}", tags=[${finalResult.tags.join(", ")}]`);
  console.log(`     Source: ${aiSource}${supervisorNote ? ` | Note: ${supervisorNote}` : ""}`);

  return { ...finalResult, confidence, aiSource, supervisorNote };
}

// PIPELINE CHÍNH

async function main() {
  console.log("=".repeat(60));
  console.log("  🗺️  DATA ENRICHMENT PIPELINE - Bắt đầu");
  console.log("  🔄 Mode: Gemini Analyst → Groq Supervisor");
  console.log("=".repeat(60));

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    throw new Error(
      "Thiếu API key! Cần ít nhất 1 trong 2:\n" +
      "  - GEMINI_API_KEY (Google Gemini)\n" +
      "  - GROQ_API_KEY (Groq/Llama)\n" +
      "Đặt cả 2 để kích hoạt chế độ Analyst + Supervisor chính xác nhất."
    );
  }

  const aiStatus = [];
  if (geminiKey) aiStatus.push("✅ Gemini (Analyst)");
  else aiStatus.push("❌ Gemini (thiếu GEMINI_API_KEY)");
  if (groqKey) aiStatus.push("✅ Groq LLaMA (Supervisor)");
  else aiStatus.push("❌ Groq (thiếu GROQ_API_KEY)");
  console.log(`\n🤖 AI Engines: ${aiStatus.join(" | ")}`);
  if (geminiKey && groqKey) {
    console.log("🔄 Pipeline: Gemini phân tích → Groq xác minh & sửa → Kết quả chính xác nhất!");
    console.log(`📂 ${CONFIG.VALID_CATEGORIES.length} categories khả dụng.`);
  }

  const places = readInputData(CONFIG.INPUT_FILE);

  let alreadyDone = new Set();
  if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(CONFIG.OUTPUT_FILE, "utf-8"));
      existing.forEach((p) => alreadyDone.add(`${p.name}_${p.lat}_${p.lng}`));
      console.log(`\n♻️  Tìm thấy ${alreadyDone.size} địa điểm đã xử lý. Script sẽ bỏ qua và tiếp tục.`);
    } catch {
      alreadyDone = new Set();
    }
  }

  let driver = null;
  try {
    driver = await buildDriver();

    for (let i = 0; i < places.length; i++) {
      const place = places[i];
      const placeKey = `${place.name}_${place.lat}_${place.lng}`;

      console.log(`\n${"─".repeat(60)}`);
      console.log(`📍 [${i + 1}/${places.length}] Đang xử lý: "${place.name}"`);

      if (alreadyDone.has(placeKey)) {
        console.log(`  ⏭️  Đã xử lý rồi, bỏ qua.`);
        continue;
      }

      const enrichedPlace = { ...place };

      // Bước 2: Trích xuất Dữ liệu (Scraping)
      let scrapeResult = { status: SCRAPE_STATUS.ERROR, reviews: [], placeType: "" };
      try {
        scrapeResult = await scrapeReviews(driver, place);
      } catch (scrapeError) {
        console.warn(`  ⚠️  Lỗi scraping không xử lý được: ${scrapeError.message}`);
        scrapeResult = { status: SCRAPE_STATUS.ERROR, reviews: [], placeType: "" };
      }

      const statusLabel = {
        [SCRAPE_STATUS.SUCCESS]: `✅ Cào được ${scrapeResult.reviews.length} bình luận`,
        [SCRAPE_STATUS.NO_REVIEWS]: `ℹ️  Địa điểm chưa có bình luận`,
        [SCRAPE_STATUS.PLACE_NOT_FOUND]: `❓ Không tìm thấy địa điểm trên Maps`,
        [SCRAPE_STATUS.ERROR]: `⚠️  Lỗi kỹ thuật khi scrape`,
      }[scrapeResult.status];
      console.log(`  → Scrape status: ${statusLabel}`);
      if (scrapeResult.placeType) {
        console.log(`  → placeType (Google Maps): "${scrapeResult.placeType}"`);
      }

      await sleep(1000);

      // Bước 3: Phân tích qua AI (Gemini → Groq)
      try {
        const aiResult = await analyzeWithAI(place, scrapeResult);
        enrichedPlace.category = aiResult.category;
        enrichedPlace.tags = aiResult.tags;
        enrichedPlace._enrichMeta = {
          scrapeStatus: scrapeResult.status,
          placeType: scrapeResult.placeType || null,
          reviewCount: scrapeResult.reviews.length,
          aiConfidence: aiResult.confidence,
          aiSource: aiResult.aiSource,
          supervisorNote: aiResult.supervisorNote || null,
          enrichedAt: new Date().toISOString(),
        };
      } catch (aiError) {
        console.error(`  ❌ Lỗi AI nghiêm trọng: ${aiError.message}`);
        console.error("  🛑 Đã dừng chương trình vì cả 2 AI đều mất kết nối hoặc hết hạn ngạch.");
        throw aiError;
      }

      // Bước 4: Ghi kết quả vào file
      saveEnrichedPlace(CONFIG.OUTPUT_FILE, enrichedPlace);
      console.log(`  💾 Đã lưu vào ${CONFIG.OUTPUT_FILE}`);

      alreadyDone.add(placeKey);

      if (i < places.length - 1) {
        console.log(`  ⏳ Chờ ${CONFIG.SLEEP_BETWEEN_PLACES / 1000}s trước địa điểm tiếp theo...`);
        await sleep(CONFIG.SLEEP_BETWEEN_PLACES);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎉 HOÀN THÀNH! Kết quả đã lưu tại: ${CONFIG.OUTPUT_FILE}`);
    console.log(`${"=".repeat(60)}\n`);
  } finally {
    if (driver) {
      await driver.quit();
      console.log("🔒 WebDriver đã đóng.");
    }
  }
}

main().catch((err) => {
  console.error("\n💥 LỖI NGHIÊM TRỌNG:", err.message);
  process.exit(1);
});