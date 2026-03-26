# Data Pipeline - Blind Box Travelling

Thư mục này chứa các script để tự động hóa việc thu thập dữ liệu địa điểm từ Google Maps và tải chúng lên cơ sở dữ liệu Supabase.

Quy trình bao gồm 2 bước chính:
1. **Cào dữ liệu (Crawl Data):** Sử dụng AI (Gemini) để sinh tên các địa điểm thực tế, sau đó dùng Selenium tìm kiếm trên Google Maps để lấy thông tin chi tiết (tọa độ, category, đánh giá, v.v.) và lưu vào file JSON.
2. **Upload dữ liệu:** Đọc file JSON và đẩy dữ liệu mới lên Supabase, tự động bỏ qua các địa điểm đã tồn tại.

---

## Bước 1: Cào dữ liệu (Crawl Data)

Script `crawl_data.py` chịu trách nhiệm thu thập dữ liệu và lưu vào file `hcm_data.json`.

### 1. Cài đặt thư viện yêu cầu
Bạn cần cài đặt Python và các thư viện cần thiết:
```bash
pip install -r requirements.txt
```

### 2. Thiết lập biến môi trường
Script yêu cầu API key của khóa Gemini để hoạt động.
- Trên **Windows (PowerShell)**:
  ```powershell
  $env:GEMINI_API_KEY="your-gemini-api-key"
  ```
- Trên **Windows (Command Prompt)**:
  ```cmd
  set GEMINI_API_KEY=your-gemini-api-key
  ```
- Trên **macOS/Linux**:
  ```bash
  export GEMINI_API_KEY="your-gemini-api-key"
  ```

### 3. Chạy lệnh cào dữ liệu
Trong file crawl_data.py nhấn `Ctrl + F` rồi tìm "hcm_data.json", thay đổi tất cả thành tên file bạn muốn lưu, sau đó ở hàm main, đổi province thành nơi bạn muốn cào data.
Chạy script bằng lệnh:
```bash
python crawl_data.py
```
> **Lưu ý:** Quá trình cào dữ liệu sẽ mở trình duyệt Chrome, vui lòng không đóng trình duyệt trong quá trình này. Bạn có thể bấm `Ctrl + C` để dừng script bất cứ lúc nào, dữ liệu đã cào sẽ được lưu lại an toàn. Dữ liệu đầu ra nằm ở file `hcm_data.json`.

---

## Bước 2: Upload dữ liệu lên Supabase

Script `upload.js` sẽ đọc dữ liệu từ `hcm_data.json` và tải lên bảng `locations` trên Supabase. Script có hỗ trợ upsert để tránh trùng lặp dữ liệu.

### 1. Cài đặt thư viện yêu cầu
Máy tính của bạn cần cài đặt Node.js. Cài đặt thư viện của Supabase bằng lệnh:
```bash
npm install @supabase/supabase-js
```
*(Nếu bạn chạy file này từ thư mục gốc của project đã có file `package.json` cài sẵn supabase thì có thể bỏ qua bước này).*

### 2. Thiết lập biến môi trường
Bạn cần cung cấp URL và Anon Key của project Supabase.
- Trên **Windows (PowerShell)**:
  ```powershell
  $env:SUPABASE_URL="https://your-project.supabase.co"
  $env:SUPABASE_ANON_KEY="your-anon-key"
  ```
- Trên **Windows (Command Prompt)**:
  ```cmd
  set SUPABASE_URL=https://your-project.supabase.co
  set SUPABASE_ANON_KEY=your-anon-key
  ```
- Trên **macOS/Linux**:
  ```bash
  export SUPABASE_URL="https://your-project.supabase.co"
  export SUPABASE_ANON_KEY="your-anon-key"
  ```

### 3. Chạy lệnh upload
Trong file upload.js nhấn `Ctrl + F` rồi tìm "hcm_data.json", thay đổi tất cả thành tên file data của bạn.
Chạy script bằng lệnh:
```bash
node upload.js
```
Script sẽ kiểm tra những dữ liệu nào đã có sẵn trên Supabase và chỉ tải lên **những địa điểm mới** để tiết kiệm thời gian và resource.
