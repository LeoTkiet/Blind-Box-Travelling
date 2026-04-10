# Data Enrichment Pipeline

File `enricher.js` được sử dụng để làm giàu (enrich) tập dữ liệu địa điểm ban đầu. Cụ thể, script sẽ giả lập trình duyệt thu thập (crawl) bình luận từ Google Maps để lấy dữ liệu thực tế, sau đó sử dụng sức mạnh kép từ **hai AI (Google Gemini & Groq LLaMA)** theo pipeline tuần tự (Gemini phân tích trước, Groq kiểm định sau) để chuẩn hóa danh mục (category) và gắn các thẻ đặc trưng (tags) tối ưu cho chức năng tìm kiếm thông minh (smart search).

## 1. Yêu cầu hệ thống và Cài đặt

Môi trường yêu cầu phải có sẵn **Node.js** và phần mềm trình duyệt **Google Chrome**.

Các gói phụ thuộc đã được khai báo trong `package.json`. Để cài đặt, bạn mở terminal ở thư mục `data_pipeline` và chạy lệnh:
```bash
npm install
```
*(Các thư viện chính bao gồm `selenium-webdriver` để tự động hóa trình duyệt và `@google/generative-ai` & `groq-sdk` để tương tác với mô hình ngôn ngữ lớn).*

---

## 2. Thiết lập ban đầu (Dành cho người mới tải về)

Vì script chạy độc lập, bạn cần tự chuẩn bị 2 tài nguyên quan trọng: **Dữ liệu đầu vào** và **Khóa API**.

### Bước 2.1: Chuẩn bị file dữ liệu `data.json` (Trích xuất từ Supabase)
Script yêu cầu một file `data/data.json` chứa danh sách các địa điểm cần xử lý. File này phải là một mảng các JSON Object, bắt buộc chứa các trường `name`, `lat`, `lng`. 

**Cách xuất dữ liệu nguyên chuẩn từ Supabase bằng SQL Editor:**
Thay vì dùng giao diện Table (đôi lúc xuất ra định dạng không khớp), cách tối ưu nhất là dùng mã SQL sinh thẳng ra file JSON:
1. Đăng nhập vào [Supabase Dashboard](https://supabase.com/dashboard) và chọn dự án của bạn.
2. Mở mục **SQL Editor** ở thanh menu bên trái.
3. Tạo một Query mới và dán đoạn mã SQL sau vào:
   ```sql
   SELECT json_agg(
       json_build_object(
           'name', name,
           'category', category,
           'lat', lat,
           'lng', lng,
           'rating', rating,
           'reviews_count', reviews_count,
           'tags', '[]'::json
       )
   ) FROM places;
   ```
   *(Lưu ý: Đổi chữ `places` thành tên bảng chứa địa điểm của bạn nếu bạn đặt tên khác).*
4. Nhấn **Run**. Kết quả dưới ô màn hình sẽ trả ra một cục JSON mảng. Nhấp đúp vào đó và **Copy** toàn bộ nội dung.
5. Trở về màn hình code, chung thư mục với `enricher.js`, tạo một thư mục con tên là `data/`.
6. Tạo một file tên là `data.json` trong thư mục `data/` đó và dán đoạn dữ liệu JSON vừa copy vào.

*Định dạng kì vọng khi bạn dán vào file `data/data.json` sẽ có dạng ngoặc vuông bao bọc các object như vầy:*
```json
[
    {
        "name": "Ramana Hotel Saigon",
        "category": "hotel",
        "lat": 10.7877299,
        "lng": 106.6776313,
        "rating": 3.9,
        "reviews_count": 2407,
        "tags": []
    }
]
```

### Bước 2.2: Thiết lập danh sách API Keys (`api_keys.json`)
Script hoạt động với cơ chế **Dual AI Load-Balancing** vòng lặp phiên tự động. Bạn cần chuẩn bị các API Key.
Tạo một file text đặt tên là `api_keys.json` (nằm chung thư mục với `enricher.js`) để cấu hình theo chuẩn đa key (giúp thoát chặn Rate-Limit):

1. Lấy API Key miễn phí từ [Google AI Studio](https://aistudio.google.com/app/apikey) (cho Gemini Analyst).
2. Lấy API Key miễn phí từ [Groq Console](https://console.groq.com/keys) (cho Groq Supervisor).
3. (Tùy chọn) Lấy API Key từ [OpenRouter](https://openrouter.ai/keys) để làm lớp fallback dự phòng khi Gemini/Groq lỗi.
4. Copy định dạng JSON sau dán vào file (bạn có thể có 1 key hay nhiều keys tùy khả năng đăng ký, chỉ cần điền đúng vào mảng):

```json
{
  "GEMINI_API_KEYS": [
    "YOUR_GEMINI_KEY_1",
    "YOUR_GEMINI_KEY_2",
    "YOUR_GEMINI_KEY_3",
    "YOUR_GEMINI_KEY_4",
    "YOUR_GEMINI_KEY_5"
  ],
  "GROQ_API_KEYS": [
    "YOUR_GROQ_KEY_1",
    "YOUR_GROQ_KEY_2",
    "YOUR_GROQ_KEY_3",
    "YOUR_GROQ_KEY_4",
    "YOUR_GROQ_KEY_5"
  ],
  "OPENROUTER_API_KEYS": [
    "YOUR_OPENROUTER_KEY_1",
    "YOUR_OPENROUTER_KEY_2"
  ]
}
```
*(Yên tâm, file `api_keys.json` được bảo vệ tuyệt đối và không tự động push lên Git nếu cấu hình đúng `.gitignore`).*

#### Khuyến nghị khi dùng key từ nhiều account
- Nên trộn key theo kiểu xen kẽ account (A1, B1, C1, A2, B2...) để phân tải đều hơn.
- Không nên đặt tất cả key của cùng một account liền nhau.
- Nếu một key bị `AUTH` hoặc lỗi liên tục, nên loại bỏ key đó khỏi `api_keys.json`.
- Nhiều key trong cùng 1 account/project có thể vẫn dùng chung quota bucket, nên key từ **nhiều account** thường ổn định hơn khi chạy batch lớn.

Ví dụ sắp xếp key xen kẽ account:

```json
{
  "GEMINI_API_KEYS": [
    "GEMINI_ACC_A_KEY_1",
    "GEMINI_ACC_B_KEY_1",
    "GEMINI_ACC_C_KEY_1",
  ],
  "GROQ_API_KEYS": [
    "GROQ_ACC_A_KEY_1",
    "GROQ_ACC_B_KEY_1",
    "GROQ_ACC_C_KEY_1",
  ],
  "OPENROUTER_API_KEYS": [
    "OPENROUTER_ACC_A_KEY_1",
    "OPENROUTER_ACC_B_KEY_1",
  ]
}
```

### Bước 2.3: Các thông số cấu hình mã nguồn tùy chỉnh (Tùy chọn)
Trong file `enricher.js`, block `CONFIG` quy định nhiều tham số quan trọng:
- `INPUT_FILE` / `OUTPUT_FILE`: Đường dẫn dữ liệu (thường là `data/data.json` và `data/data_enriched.json`).
- `MAX_REVIEWS`: Số lượng bình luận tối đa được thu thập cho mỗi địa điểm (hiện tại là **10 bình luận**).
- `MAX_REVIEW_LENGTH`: Giới hạn cắt ngắn độ dài bình luận (**200 ký tự**) để giữ đủ ngữ cảnh khi phân tích.
- `AI_CONTEXT_REVIEW_LIMIT`: Mức mặc định số bình luận đưa vào prompt AI (mặc định **8**).
- `AI_CONTEXT_REVIEW_LIMIT_CLEAR_TYPE`: Nếu `placeType` rõ ràng, chỉ gửi khoảng **5** bình luận để tiết kiệm quota.
- `AI_CONTEXT_REVIEW_LIMIT_AMBIGUOUS_TYPE`: Nếu `placeType` mơ hồ/không có, gửi nhiều hơn (khoảng **10**) để tăng độ chính xác.
- `SLEEP_BETWEEN_ACTIONS`, `SLEEP_AFTER_NAVIGATE`, `SLEEP_BETWEEN_PLACES`: Các tham số điều chỉnh thời gian chờ để mô phỏng người thật, chống bị khóa bởi Google Maps. Bản free-safe hiện dùng `SLEEP_BETWEEN_PLACES = 15000ms` (15 giây).
- `AI_CALL_TIMEOUT`: Timeout cho các yêu cầu AI API (**30 giây**) tránh gây treo chương trình mãi mãi.
- `RATE_LIMIT_RETRY_DELAY` & `RATE_LIMIT_MAX_RETRIES`: Tự động đợi (**60 giây**) và thử lại khi gặp lỗi hết lượt gọi miễn phí (Rate Limit 429). Với chế độ nhiều API key, script sẽ tự xoay vòng key trước khi chờ theo chu kỳ retry.
- `KEY_COOLDOWN_MS`: Khi một key bị `RATE_LIMIT`, key đó sẽ bị đưa vào trạng thái cooldown tạm thời (mặc định **5 phút**) trước khi được dùng lại.
- `RateLimiter` nội bộ: Script chủ động throttle tốc độ gọi API để giảm xác suất chạm hạn mức free-tier (bản free-safe hiện tại: Gemini ~5 req/phút/key, Groq ~10 req/phút/key, OpenRouter ~5 req/phút/key).
- `OPENROUTER_MODELS` (biến môi trường, tùy chọn): Danh sách model OpenRouter phân tách bằng dấu phẩy để fallback tự động khi model bị `404 no endpoints found`.
  - Ví dụ: `OPENROUTER_MODELS=meta-llama/llama-3.1-8b-instruct:free,mistralai/mistral-7b-instruct:free,google/gemma-2-9b-it:free,qwen/qwen-2.5-7b-instruct:free`
  - Script sẽ thử lần lượt theo danh sách và tự chuyển model dự phòng nếu model hiện tại không có endpoint.
- Script cũng tự kiểm tra một số biến môi trường endpoint Google; nếu phát hiện typo `googlleapis.com` sẽ tự sửa thành `googleapis.com` trước khi gọi Gemini.
- `HEADLESS`: Đặt thành `true` nếu bạn muốn chạy ẩn Chrome ở chế độ nền (không mở giao diện).

---

## 3. Quá trình hoạt động và Tiêu chuẩn Dữ liệu

Mở terminal ở trong thư mục `data_pipeline` và chạy lệnh:

```bash
node enricher.js
```

### Các bước thực thi sẽ diễn ra như sau:
1. **Trích xuất Đánh giá cực mạnh (Resilient Scraping):** Kịch bản sẽ mở trình duyệt bằng WebDriver, tự động vượt qua trang **"Google Consent"** (nếu có). Script dùng **JavaScript tiêm thẳng vào trình duyệt** để tự động cuộn (với tính năng **Smart Scroll** dừng sớm khi đủ review hoặc không tải được đánh giá mới), tự bấm "Xem thêm" và móc xuất `placeType` (loại hình) lẫn nội dung text từ tối đa **10 bình luận**.
2. **Phân tích tuần tự (Sequential Pipeline Gemini → Groq):** Hai khối AI phối hợp nhịp nhàng theo chuỗi chuyên nghiệp:
   - **Gemini-2.5-Flash (Analyst):** Đóng vai trò chuyên viên phân tích dữ liệu, nhận ngữ cảnh và đề xuất `category` + `tags` bước một.
   - **Groq LLaMA-3.3-70B (Supervisor):** Ở vị trí quản lý/giám sát chặt chẽ. Nó kiểm tra lại kết quả của Gemini, đối chiếu thẳng với tập thông tin `placeType` và bình luận. Nếu Gemini đúng, nó phê duyệt (`dual-confirmed`). Nếu Gemini sai/thiếu, Groq mạnh dạn sửa category và chèn thêm tag vào (`groq-corrected`).
   - **OpenRouter (Fallback đa vai trò):** Nếu Gemini hoặc Groq lỗi, OpenRouter sẽ tạm thay vai trò tương ứng (Analyst hoặc Supervisor) để pipeline không bị ngắt.
3. **Smart Search Tags:** AI tự động sinh ra các tag mạnh về không dấu như: Loại hình, Trải nghiệm, Đối tượng, Thời điểm phù hợp.
4. **Enrich Metadata Gọn Nhẹ:** Dữ liệu thành phẩm được lưu liên tục vào `data/data_enriched.json`. Metadata `_enrichMeta` giờ đây **đã được tối giản hóa** cắt các log nháp, chỉ lưu cực kỳ gọn những thông số chủ chốt: `scrapeStatus` (kết quả cào), `aiSource` (nguồn quyết định AI: `dual-confirmed`, `groq-corrected`, `gemini-only`, `groq-only`) và `enrichedAt`.

> 🛑 **Xử lý lỗi API thông minh (Error Handling):**
> - **Throttle chủ động trước khi gọi API:** Script dùng rate limiter nội bộ để giới hạn nhịp gọi, giảm rủi ro dính 429 khi chạy batch lớn.
> - **Luân phiên API key có nhận biết cooldown:** Khi key gặp `RATE_LIMIT`, key đó bị cooldown tạm thời và hệ thống tự chuyển qua key khác còn khả dụng (áp dụng cho Gemini, Groq, OpenRouter).
> - **Exponential Backoff + Jitter:** Khi lỗi `RATE_LIMIT`/`SERVER`/`NETWORK`, script chờ theo backoff tăng dần kèm jitter ngẫu nhiên trước khi retry.
> - **Thời gian chờ (Timeout):** Mỗi yêu cầu AI có timeout 30 giây. Nếu quá thời gian phản hồi, request bị xem là lỗi mạng/timeout và được chuyển key hoặc retry.
> - **JSON Repair cho Gemini:** Nếu Gemini trả output có text thừa ngoài JSON (ví dụ mở đầu bằng câu giải thích), script sẽ tự gọi thêm một lượt reformat để bóc JSON hợp lệ.
> - **Fallback mở rộng qua OpenRouter:** Khi Gemini hoặc Groq thất bại trong vai trò hiện tại, OpenRouter sẽ được gọi thay thế tạm thời trước khi fail-safe dừng chương trình.
> - **1 AI lỗi → Tự động fallback:** Nếu ở giai đoạn Groq bị lỗi mạng, kết quả từ Gemini sẽ được giữ nguyên (`gemini-only`). Nếu Gemini ngã ngựa ngay từ đầu, phần mềm sẽ kêu gọi Groq phân tích một mình (`groq-only`).
> - **Cả 2 AI lỗi → Dừng khẩn cấp:** Nếu cả 2 đều mất kết nối hoặc đều hết limit hoàn toàn, hệ thống **bật Fail-safe**, ngừng ngay lập tức để giữ an toàn dữ liệu và tắt Chrome giải phóng RAM thay vì cố ghi ra file lỗi.
> - **Bộ đếm lỗi liên tiếp & Cảnh báo:** Hệ thống đếm xem API báo "chết" liên tiếp bao nhiêu trang. Nếu đứt bóng liên tiếp 3 mặt trận, terminal sẽ hiện đỏ cảnh báo lớn cho người dùng có biện pháp. Mọi lỗi đều được phân loại chi tiết (AUTH, SERVER, NETWORK, RATE_LIMIT).

> 💡 **Tính năng khôi phục (Resume):** Script được cài đặt cơ chế tự động lưu khi mỗi địa điểm làm xong. Nếu quá trình chạy gặp gián đoạn (mạng đứt, bấm `Ctrl + C`), lần chạy `node enricher.js` tiếp theo script sẽ thông minh nhận diện và tự động bỏ qua những địa điểm đã tồn tại trong `data_enriched.json`. Nếu bạn muốn chạy lại các địa điểm có `scrapeStatus: "error"`, bạn chỉ việc xóa đối tượng đó khỏi file (hoặc xóa nguyên file) rồi chạy lại bot.
