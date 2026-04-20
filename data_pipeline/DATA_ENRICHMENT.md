# Data Enrichment Pipeline

File `enricher.js` được sử dụng để làm giàu (enrich) tập dữ liệu địa điểm ban đầu. Cụ thể, script sẽ giả lập trình duyệt thu thập (crawl) bình luận từ Google Maps để lấy dữ liệu thực tế, sau đó sử dụng sức mạnh kép từ **hệ thống AI luân phiên (Groq & Pollinations)** theo pipeline tuần tự (Groq đóng vai trò Analyst phân tích trước, Pollinations đóng vai trò Supervisor kiểm định sau) để chuẩn hóa danh mục (category) và gắn các thẻ đặc trưng (tags tiếng Việt có dấu, mô tả điểm nổi bật) nhằm tối ưu cho chức năng tìm kiếm thông minh (smart search).

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
   SELECT
      name,
      category,
      lat,
      lng,
      rating,
      reviews_count,
      tags
   FROM locations;
   ```
4. Nhấn **Run**. Kết quả dưới ô màn hình sẽ trả ra một cục JSON mảng. Nhấn vào dòng "Limit results to" ở góc dưới bên phải , chọn No limit sau đó nhấn **Run** lần nữa.
5. Nhấp đúp vào vùng kết quả và **Copy** toàn bộ nội dung.
6. Trở về màn hình code, chung thư mục với `enricher.js`, tạo một thư mục con tên là `data/`.
7. Tạo một file tên là `data.json` trong thư mục `data/` đó và dán đoạn dữ liệu JSON vừa copy vào.

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
Script hoạt động với cơ chế **AI Load-Balancing đa tầng** tận dụng tối đa các tài nguyên miễn phí trên web.
Tạo một file text đăt tên là `api_keys.json` (nằm chung thư mục với `enricher.js`) để cấu hình theo chuẩn đa key (giúp luân phiên tránh chặn Rate-Limit):

1. Lấy API Key miễn phí từ Google AI Studio cho [Gemini API](https://aistudio.google.com/app/apikey) để sử dụng cơ chế Batch Vector Embedding siêu tốc (Gom nhóm 20 địa điểm / 1 lần gọi để tối ưu Limit).
2. Lấy đa dạng API Key miễn phí từ [Groq Console](https://console.groq.com) (cho Groq Analyst). LƯU Ý QUAN TRỌNG: Groq giới hạn rất gắt (30 req/phút/tài khoản), do đó **chúng tôi đặc biệt khuyến nghị bạn dùng 3 tài khoản Email/Github khác nhau để đăng ký 3 tài khoản Groq riêng biệt**. Sau đó lấy 3 Key nhét vào file để mở khóa tốc độ xử lý luân phiên siêu tốc mà không bao giờ lo sập Rate Limit.
3. Lấy API Token miễn phí từ [Pollinations](https://auth.pollinations.ai) (cho Pollinations Supervisor). (1 req/5s).
4. (Tùy chọn) Lấy User ID làm API Key từ [G4F](https://g4f.dev/api_key.html) để làm kế hoạch dự phòng khi Groq/Pollinations sập hàng loạt.
5. Copy định dạng JSON sau dán vào file (có thể nhét thêm nhiều key vào cấu trúc mảng để chạy trơn tru):

```json
{
  "GROQ_API_KEYS": [
    "YOUR_GROQ_KEY_1",
    "YOUR_GROQ_KEY_2",
    "YOUR_GROQ_KEY_3"
  ],
  "POLLINATIONS_TOKENS": [
    "YOUR_POLL_TOKEN_1"
  ],
  "G4F_API_KEYS": [
    "YOUR_G4F_USER_ID_1"
  ],
  "GEMINI_API_KEY": "YOUR_GEMINI_KEY_CHINH"
}
```
*(Yên tâm, file `api_keys.json` được thiết kế bảo mật, script sẽ tự động chạy Round-robin đổi key luân phiên).*

### Bước 2.3: Các thông số cấu hình mã nguồn tùy chỉnh (Tùy chọn)
Trong file `enricher.js`, block `CONFIG` quy định nhiều tham số quan trọng:
- `INPUT_FILE` / `OUTPUT_FILE`: Đường dẫn dữ liệu (thường là `data/data.json` và `data/data_enriched.json`).
- `MAX_REVIEWS`: Số lượng bình luận tối đa được thu thập (hiện tại là **15 bình luận**).
- `MAX_REVIEW_LENGTH`: Giới hạn dung lượng text mỗi dòng (**250 ký tự**) để nhường phần cho các chi tiết cụ thể.
- `AI_CONTEXT_REVIEW_LIMIT`: Gắn khoảng **7** bình luận nếu loại hình địa điểm bình thường.
- `AI_CONTEXT_REVIEW_LIMIT_CLEAR_TYPE`: Gắn khoảng **5** bình luận nếu thể loại Google Maps đã quá rõ nghĩa (restaurant, museum).
- `SLEEP_BETWEEN_PLACES`: Thuật toán delay thư giãn nhấp nhả (với mức thiết lập hiện tại đang đặt là **5000ms** ≈ 5 giây) để kéo rate limit mượt hơn qua nhiều giờ.
- `KEY_COOLDOWN_MS`: Đưa các key bị cháy rụi Tokens (Lỗi 429) vào ngục tối để chờ cooldown **5 phút** trước khi đem ra sai khiến tiếp.
- `RateLimiter` nội bộ: Thuật toán rào tốc Token Bucket nhằm kìm hãm gọi API láo bậy, cố định tốc độ RPM 1 cách hoàn toàn bảo thủ để chiều lòng giới hạn tốc độ gắt gao của Groq, Pollinations và G4F.
- `HEADLESS`: Đặt thành `true` nếu bạn muốn chạy ẩn Chrome ở chế độ nền (không mở giao diện).

---

## 3. Quá trình hoạt động và Tiêu chuẩn Dữ liệu

Mở terminal ở trong thư mục `data_pipeline` và chạy lệnh:

```bash
node enricher.js
```

### Các bước thực thi sẽ diễn ra như sau:
1. **Trích xuất Đánh giá kiên cường (Resilient Scraping):** Tự bỏ qua Google form Consent, quét mã và tìm các thẻ `span` chứa lượng ký tự dài nhất để bốc khối chữ không lo lỗi CSS Class của Maps.
2. **Cơ chế Pipeline AI Thác Nước (Waterfall):** Xuyên suốt quy trình phân cấp gắt gao:
   - **Groq LLaMA-3.3-70B (Analyst):** Phân tích nền và phác thảo dàn `category` và `tags` có gắn yếu tố Trải Nghiệm điểm cực sắc.
   - **Pollinations GPT-4o / GPT-4.1-mini (Supervisor):** Khẳng định lại thẻ Tag, rèn dũa bộ Tag thật trơn tru và gắn dấu tiếng Việt.
   - **G4F.DEV (Master Fallback):** Thòng lọng phòng hờ vĩ đại nhất! Nếu Groq / Pollinations nổ máy vì bị quét sạch Quota. Script sẽ cầu cứu dàn AI đa năng của g4f.dev để duy trì băng tải không nghỉ giải lao suốt đêm dài.
3. **Smart Search Tags 5 Chiều xịn xò:** Cấu trúc dữ liệu địa điểm được AI thiết kế lại hoàn toàn thành hệ thống thẻ 5 chiều với nội dung bằng tiếng Việt chuẩn chỉnh:
   - `tags_price`: Mức giá (1 trong 4 nhãn: *miễn phí, bình dân, tầm trung, cao cấp*).
   - `tags_location`: Không gian/view đặc trưng (VD: ven sông, trong hẻm).
   - `tags_audience`: Nhóm đối tượng phù hợp (VD: cặp đôi, gia đình).
   - `tags_time`: Thời điểm lý tưởng, được lấy chính xác từ `opening_hours` của Google Maps (VD: buổi sáng, về đêm).
   - `tags_highlight`: Điểm đắc sắc khác biệt nhất phi sáo rỗng.
   Tất cả thẻ tiếp tục qua bộ lọc Synonym (Đồng nghĩa) và Stopwords để tóm gọn "Giá trị check-in" tuyệt hảo.
4. **Tích hợp Search Document & Lưu Vector BATCH:** Tự động kết hợp 5 chiều Tag trên thành văn bản hoàn chỉnh tên là `search_document`. Script sử dụng công nghệ **Gemini Batch Embedding** (`gemini-embedding-001`) để nhóm 20 địa điểm gửi lên Google chỉ trong một lần yêu cầu duy nhất nhằm tiết kiệm năng lực và tối đa hoá tốc độ. Dữ liệu thành phẩm (bao gồm text và vector) được lưu ở `data_vectors.json`. File JSON cũng được code tự động "ép phẳng" các mảng dữ liệu (Arrays) nằm gọn trên một dòng giúp giảm dung lượng và dễ nhìn hơn.
5. **Enrich Metadata Gọn Nhẹ:** Dữ liệu hoàn chỉnh được ghi cuộn và đẩy trực tiếp xuống thẳng `data_enriched.json` mỗi vòng mà không lo tràn RAM bùng nổ, ghi nhận minh bạch `aiSource` là nguồn nào đã thực thi.

> 🛑 **Công cụ rào lỗi thông minh (Error Handling Thép):**
> - **Auto-Healing Vector (Tự động chữa lành):** Nếu mạng rớt hoặc bạn tắt máy ngang xương khi các Vector còn mắc kẹt trong hàng đợi chưa kịp gửi Batch, ở lần gõ lệnh `node enricher.js` tiếp theo, hệ thống sẽ dò quét toàn cục và tự động gom hốt tất cả những "đứa con bị rơi rớt" đó gửi bù cho Gemini để bảo toàn dữ liệu trước khi bắt đầu cào tiếp danh sách mới.
> - **Throttle chủ động trước khi gọi API:** Script dùng rate limiter giữ chặt RPM để không bao giờ bị khóa ngập lụt Request bởi Server.
> - **Exponential Backoff:** Quá tải (429) hoặc Máy chủ nghẽn, thời gian tự động rướn giãn nở để cho phép server API phục hồi rồi gọi tiếp. Luân phiên key trong danh sách API lúc có key đang bị kẹt.
> - **JSON Repair tự kháng:** Hệ thống AI tự trả thừa chữ ngoài lề JSON? Trình Parser tự dò quét thẻ mở `{` hoặc `[` đầu tiên để chắt bóp kết quả chính xác, cứu kịch bản chứ không vứt lỗi.
> - **Cảnh báo Crash Đa tằng (Dual-Crash Safety):** Nếu các mũi nhọn Analyst hay Supervisor rớt đài tận 3 lần liên tiếp, Terminal sẽ rú còi báo đỏ cho người dùng. Nếu G4F cũng đầu hàng, hệ sinh thái tự thả dừng Code vĩnh viễn (Exit) chặn ngòi hư hại toàn bộ mảng dữ liệu đã lưu.

> 💡 **Tính năng khôi phục (Resume):** Script được cài đặt cơ chế tự động lưu khi mỗi địa điểm làm xong. Nếu quá trình chạy gặp gián đoạn (mạng đứt, bấm `Ctrl + C`), lần chạy `node enricher.js` tiếp theo script sẽ thông minh nhận diện và tự động bỏ qua những địa điểm đã tồn tại trong `data_enriched.json`. Nếu bạn muốn chạy lại các địa điểm có `scrapeStatus: "error"`, bạn chỉ việc xóa đối tượng đó khỏi file (hoặc xóa nguyên file) rồi chạy lại bot.
