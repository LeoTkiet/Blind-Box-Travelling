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
- `MAX_REVIEWS`: Số lượng bình luận tối đa được thu thập cho mỗi địa điểm (hiện tại là **40 bình luận** để cung cấp cho AI góc nhìn đầy đủ nhất).
- `SLEEP_BETWEEN_ACTIONS`: Chống bị khóa bởi Google bằng cách tự động dừng chờ vài giây.
- `HEADLESS`: Đặt thành `true` nếu bạn muốn chạy ẩn Chrome ở chế độ nền (không mở giao diện).

* **Chuẩn bị:** Đảm bảo bạn đã có sẵn thư mục con tên là `data/` chứa file gốc từ quá trình crawl (`data.json`) ở bên trong thư mục `data_pipeline`.

---

## 3. Quá trình hoạt động và Tiêu chuẩn Dữ liệu

Mở terminal ở trong thư mục `data_pipeline` và chạy lệnh:

```bash
node enricher.js
```

### Các bước thực thi sẽ diễn ra như sau:
1. **Trích xuất Đánh giá cực mạnh (Resilient Scraping):** Kịch bản sẽ mở trình duyệt Chrome bằng WebDriver, tìm kiếm tên địa điểm. Khác với các công cụ bình thường, script này tích hợp **JavaScript tiêm thẳng vào trình duyệt gốc** để vượt qua hàng rào tự động thay đổi giao diện (đổi tên CSS Class) liên tục của Google Maps. Nó sẽ tự động cuộn trang, tự bấm nút "Xem thêm" và lấy tối đa **40 bình luận**.
2. **Phân tích với Dual AI (Unbiased Classification):** Bình luận sẽ được nạp song song cho cả hai AI (`Gemini-2.5-Flash` và `LLaMA-3.3-70B-Versatile` qua Groq). 
   - AI được lập trình nghiêm ngặt **bỏ qua thuộc tính category ban đầu** của dữ liệu (ví dụ: "Bưu Điện Trung Tâm" bị dán nhầm là cấu trúc "market" sẽ được ép về chuẩn "attraction"). 
   - **Cơ chế Gộp (Consensus Merge):** Hệ thống lấy kết quả giao thoa của 2 AI. **Đặc biệt:** Nếu hai mô hình không đồng nhất về Danh mục (Category), kết quả quyết định từ **Groq LLaMA** sẽ được ưu tiên do khả năng suy luận logic vượt trội của mô hình 70 tỷ tham số này.
3. **Smart Search Tags:** AI tự động tạo ra tối đa 10 tags viết thường không dấu phục vụ theo chiều hướng: Loại hình, Trải nghiệm, Đối tượng tham quan, Thời điểm phù hợp, và Điểm đặc biệt.
4. **Enrich Metadata:** Dữ liệu thành phẩm được lưu liên tục vào tệp `data/data_enriched.json`, đính kèm metadata `_enrichMeta` ghi rõ thông tin cào dữ liệu, số lượng Review và AI Source (Ai đã ra quyết định: Dual, Gemini-only hay Groq-only).

> 🛑 **Xử lý lỗi API thông minh (Error Handling):**
> - **1 AI lỗi → Tự động fallback:** Nếu Gemini lỗi, Groq sẽ tự phân tích (fallback mode) và ngược lại. Dữ liệu vẫn được xử lý bình thường.
> - **2 AI lỗi → Dừng khẩn cấp:** Nếu cả 2 AI đều thất bại trong cùng 1 địa điểm, hệ thống **dừng ngay lập tức** (fail-safe) kèm báo cáo lỗi chi tiết, tự động thoát Chrome để giải phóng RAM thay vì sinh ra dữ liệu lỗi.
> - **Phân loại lỗi:** Hệ thống nhận diện 5 loại lỗi API: `AUTH` (key hết hạn), `RATE_LIMIT` (hết quota), `SERVER` (lỗi 5xx), `NETWORK` (mất mạng/timeout), `UNKNOWN`.
> - **Bộ đếm lỗi liên tiếp:** Theo dõi số lần lỗi liên tiếp của từng AI. Khi đạt ngưỡng 3 lần, in cảnh báo nghiêm trọng cho người dùng biết AI đó có thể đã "chết".
> - **Gợi ý khắc phục tự động:** Khi dừng khẩn cấp, hệ thống in hướng dẫn xử lý (kiểm tra mạng, API key, thử lại sau vài phút...).

> 💡 **Tính năng khôi phục (Resume):** Script được cài đặt cơ chế tự động lưu khi mỗi địa điểm làm xong. Nếu quá trình chạy gặp gián đoạn (mạng đứt, bấm `Ctrl + C`), lần chạy `node enricher.js` tiếp theo script sẽ thông minh nhận diện và tự động bỏ qua những địa điểm đã tồn tại trong `data_enriched.json`. Nếu bạn muốn chạy lại các địa điểm có `scrapeStatus: "error"`, bạn chỉ việc xóa đối tượng đó khỏi file (hoặc xóa nguyên file) rồi chạy lại bot.
