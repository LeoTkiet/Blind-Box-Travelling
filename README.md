# 🎁 Blind Box Travelling

Ứng dụng khám phá địa điểm du lịch bất ngờ theo phong cách "Hộp mù" (Blind Box).

## 🚀 Tính năng chính

- **Thiết kế tối giản (Minimalist Black & White):** Giao diện sạch sẽ, tập trung vào trải nghiệm người dùng.
- **Hệ thống đăng nhập (Supabase Auth):**
  - Đăng nhập bằng Google để lưu lại lịch sử.
  - Đăng nhập Ẩn danh (Guest) để thử nghiệm nhanh.
- **Thuật toán "Hidden Gem":** 
  - Tự động lọc các địa điểm trong bán kính bạn chọn.
  - Xếp hạng dựa trên chất lượng (Rating) và độ "ẩn" (ít reviews).
  - Kết quả ngẫu nhiên mang lại sự bất ngờ mỗi lần quay.
- **Bản đồ tương tác (Mapbox):**
  - Hiển thị vị trí của bạn và vùng bán kính tìm kiếm.
  - Đánh dấu địa điểm "Hộp mù" ngay khi được tạo ra.
  - Tích hợp tìm kiếm địa chỉ thông qua Mapbox Geocoding.

---

## 🛠 Hướng dẫn cài đặt

### 1. Cài đặt Dependencies

Mở terminal tại thư mục gốc và chạy:
```bash
npm install
```

### 2. Thiết lập Supabase

1. Tạo một project trên [Supabase](https://supabase.com/).
2. Trong **Authentication > Providers**:
   - Bật **Google** (Cần thiết lập OAuth credentials nếu chạy production).
   - Bật **Anonymous Sign-ins**.
3. Trong **SQL Editor**, chạy đoạn mã sau để tạo bảng `locations`:

```sql
create table locations (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  rating float8,
  review_count int8,
  category text,
  photo_url text,
  created_at timestamp with time zone default now()
);

-- Bật Row Level Security (RLS) để cho phép đọc dữ liệu
alter table locations enable row level security;

create policy "Cho phép mọi người đọc địa điểm"
on locations for select
to public
using (true);
```

### 3. Thiết lập Mapbox

1. Đăng ký tài khoản tại [Mapbox](https://www.mapbox.com/).
2. Lấy **Default Public Token** trong dashboard của bạn.

### 4. Cấu hình Biến môi trường

Tạo file `.env.local` tại thư mục gốc và điền các thông tin sau:

```env
# Supabase - Lấy từ Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Mapbox - Lấy từ Mapbox Dashboard
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your-token-here
```

---

## 🏃‍♂️ Chạy ứng dụng

Sau khi đã hoàn tất các bước trên, chạy lệnh:

```bash
npm run dev
```

Truy cập [http://localhost:3000](http://localhost:3000) để bắt đầu hành trình!

---

## 📂 Dữ liệu Locations

Hiện tại dữ liệu mẫu đang nằm ở `data_pipeline/data.json`. Bạn có thể dùng tính năng **Import Data** trong Supabase Dashboard để đưa dữ liệu này vào bảng `locations` vừa tạo.

> **Lưu ý:** Đảm bảo các tên cột (`name`, `latitude`, `longitude`, ...) trong file JSON khớp hoàn toàn với bảng trong Supabase.
