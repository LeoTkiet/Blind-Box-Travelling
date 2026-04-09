# Data Enrichment Pipeline

File `enricher.js` được sử dụng để làm giàu (enrich) tập dữ liệu địa điểm ban đầu. Cụ thể, script sẽ giả lập trình duyệt thu thập (crawl) bình luận từ Google Maps để lấy dữ liệu thực tế, sau đó sử dụng sức mạnh kép từ **hai AI (Google Gemini & Groq LLaMA)** chạy song song để phân tích, chuẩn hóa danh mục (category) và gắn các thẻ đặc trưng (tags) tối ưu nhất cho chức năng tìm kiếm thông minh (smart search).

## 1. Yêu cầu hệ thống và Cài đặt

Môi trường yêu cầu phải có sẵn **Node.js** và phần mềm trình duyệt **Google Chrome**.

Các gói phụ thuộc đã được khai báo trong `package.json`. Để cài đặt, bạn mở terminal ở thư mục `data_pipeline` và chạy lệnh:
```bash
npm install
```
*(Các thư viện chính bao gồm `selenium-webdriver` để tự động hóa trình duyệt và `@google/generative-ai` & `groq-sdk` để tương tác với mô hình ngôn ngữ lớn).*

---

## 2. Thiết lập cấu hình

### Thiết lập Biến môi trường (Gemini & Groq API Key)
Script hoạt động với cơ chế **Dual AI**. Bạn cần cấu hình ít nhất 1 trong 2 key (Khuyến nghị cấu hình cả 2 để độ chính xác cao nhất):
- API Key miễn phí từ [Google AI Studio](https://aistudio.google.com/app/apikey)
- API Key miễn phí từ [Groq Console](https://console.groq.com/keys)

Tùy theo hệ điều hành, hãy thiết lập biến môi trường trước khi chạy:

- Trên **Windows (PowerShell)**:
  ```powershell
  $env:GEMINI_API_KEY="your-gemini-key"
  $env:GROQ_API_KEY="your-groq-key"
  ```
- Trên **Windows (Command Prompt / CMD)**:
  ```cmd
  set GEMINI_API_KEY=your-gemini-key
  set GROQ_API_KEY=your-groq-key
  ```
- Trên **macOS/Linux**:
  ```bash
  export GEMINI_API_KEY="your-gemini-key"
  export GROQ_API_KEY="your-groq-key"
  ```

### Cấu hình cốt lõi trong `enricher.js`
Trong file `enricher.js`, block `CONFIG` quy định nhiều tham số quan trọng:
- `INPUT_FILE` / `OUTPUT_FILE`: Đường dẫn dữ liệu (thường là `data/data.json` và `data/data_enriched.json`).
- `MAX_REVIEWS`: Số lượng bình luận tối đa được thu thập cho mỗi địa điểm (hiện tại là **30 bình luận**).
- `MAX_REVIEW_LENGTH`: Giới hạn cắt ngắn độ dài bình luận (**200 ký tự**) để tiết kiệm token API và giảm chi phí.
- `SLEEP_BETWEEN_ACTIONS`, `SLEEP_AFTER_NAVIGATE`, `SLEEP_BETWEEN_PLACES`: Các tham số điều chỉnh thời gian chờ để mô phỏng người thật, chống bị khóa bởi Google Maps.
- `AI_CALL_TIMEOUT`: Timeout cho các yêu cầu AI API (**30 giây**) tránh gây treo chương trình mãi mãi.
- `RATE_LIMIT_RETRY_DELAY` & `RATE_LIMIT_MAX_RETRIES`: Tự động đợi (**60 giây**) và thử lại tối đa 2 lần khi gặp lỗi hết lượt gọi miễn phí (Rate Limit 429).
- `HEADLESS`: Đặt thành `true` nếu bạn muốn chạy ẩn Chrome ở chế độ nền (không mở giao diện).

* **Chuẩn bị:** Đảm bảo bạn đã có sẵn thư mục con tên là `data/` chứa file gốc từ quá trình crawl (`data.json`) ở bên trong thư mục `data_pipeline`.

---

## 3. Quá trình hoạt động và Tiêu chuẩn Dữ liệu

Mở terminal ở trong thư mục `data_pipeline` và chạy lệnh:

```bash
node enricher.js
```

### Các bước thực thi sẽ diễn ra như sau:
1. **Trích xuất Đánh giá cực mạnh (Resilient Scraping):** Kịch bản sẽ mở trình duyệt bằng WebDriver, tự động vượt qua trang **"Google Consent"** (nếu có). Script dùng **JavaScript tiêm thẳng vào trình duyệt** để tự động cuộn (với tính năng **Smart Scroll** dừng sớm khi đủ review hoặc không tải được đánh giá mới), tự bấm "Xem thêm" và móc xuất `placeType` (loại hình) lẫn nội dung text từ tối đa **30 bình luận**.
2. **Phân tích tuần tự (Sequential Pipeline Gemini → Groq):** Hai khối AI phối hợp nhịp nhàng theo chuỗi chuyên nghiệp:
   - **Gemini-2.5-Flash (Analyst):** Đóng vai trò chuyên viên phân tích dữ liệu, nhận ngữ cảnh và đề xuất `category` + `tags` bước một.
   - **Groq LLaMA-3.3-70B (Supervisor):** Ở vị trí quản lý/giám sát chặt chẽ. Nó kiểm tra lại kết quả của Gemini, đối chiếu thẳng với tập thông tin `placeType` và bình luận. Nếu Gemini đúng, nó phê duyệt (`dual-confirmed`). Nếu Gemini sai/thiếu, Groq mạnh dạn sửa category và chèn thêm tag vào (`groq-corrected`).
3. **Smart Search Tags:** AI tự động sinh ra các tag mạnh về không dấu như: Loại hình, Trải nghiệm, Đối tượng, Thời điểm phù hợp.
4. **Enrich Metadata Gọn Nhẹ:** Dữ liệu thành phẩm được lưu liên tục vào `data/data_enriched.json`. Metadata `_enrichMeta` giờ đây **đã được tối giản hóa** cắt các log nháp, chỉ lưu cực kỳ gọn những thông số chủ chốt: `scrapeStatus` (kết quả cào), `aiSource` (ai đã đưa ra quyết định: dual, gemini-only hay groq-fallback) và `enrichedAt`.

> 🛑 **Xử lý lỗi API thông minh (Error Handling):**
> - **Chống cạn kiệt Quota (Rate Limit/429):** Tự động phát hiện lỗi 429, chờ 60 giây để khôi phục hạn ngạch rồi tự chạy lại yêu cầu (tối đa 2 lần).
> - **Thời gian chờ (Timeout):** Mỗi yêu cầu AI chỉ được phép phản hồi trong 30 giây để ngăn chặn đóng băng toàn phần phần mềm.
> - **1 AI lỗi → Tự động fallback:** Nếu ở giai đoạn Groq bị lỗi mạng, kết quả từ Gemini sẽ được giữ nguyên (`gemini-only`). Nếu Gemini ngã ngựa ngay từ đầu, phần mềm sẽ kêu gọi Groq phân tích một mình (`groq-only`).
> - **Cả 2 AI lỗi → Dừng khẩn cấp:** Nếu cả 2 đều mất kết nối hoặc đều hết limit hoàn toàn, hệ thống **bật Fail-safe**, ngừng ngay lập tức để giữ an toàn dữ liệu và tắt Chrome giải phóng RAM thay vì cố ghi ra file lỗi.
> - **Bộ đếm lỗi liên tiếp & Cảnh báo:** Hệ thống đếm xem API báo "chết" liên tiếp bao nhiêu trang. Nếu đứt bóng liên tiếp 3 mặt trận, terminal sẽ hiện đỏ cảnh báo lớn cho người dùng có biện pháp. Mọi lỗi đều được phân loại chi tiết (AUTH, SERVER, NETWORK, RATE_LIMIT).

> 💡 **Tính năng khôi phục (Resume):** Script được cài đặt cơ chế tự động lưu khi mỗi địa điểm làm xong. Nếu quá trình chạy gặp gián đoạn (mạng đứt, bấm `Ctrl + C`), lần chạy `node enricher.js` tiếp theo script sẽ thông minh nhận diện và tự động bỏ qua những địa điểm đã tồn tại trong `data_enriched.json`. Nếu bạn muốn chạy lại các địa điểm có `scrapeStatus: "error"`, bạn chỉ việc xóa đối tượng đó khỏi file (hoặc xóa nguyên file) rồi chạy lại bot.
