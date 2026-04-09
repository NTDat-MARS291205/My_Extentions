# 🎵 YT Music Saver v2

Tải nhạc YouTube, quản lý thư viện theo thể loại, kiểm tra trùng lặp, bật/tắt server ngay trong extension.

---

## 📁 Cấu trúc

```
yt-music-extension/
├── extension/          ← Cài vào Chrome
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   └── content.js
├── server/             ← Server tải nhạc
│   └── server.py
└── native-host/        ← Cho phép bật server từ extension
    ├── native_host.py
    └── install.bat     ← Chạy 1 lần để đăng ký
```

---

## ⚙️ Cài đặt

### Bước 1 — Cài Python dependencies

```powershell
pip install yt-dlp
# Tuỳ chọn (để có MP3):
choco install ffmpeg
```

### Bước 2 — Đăng ký Native Host (để bật server từ extension)

Chạy file `native-host/install.bat` **một lần duy nhất**.  
File này đăng ký vào Registry để Chrome biết cách khởi động server.

### Bước 3 — Cài Extension vào Chrome

1. Vào `chrome://extensions/`
2. Bật **Developer mode**
3. Nhấn **Load unpacked** → chọn thư mục `extension/`

---

## 🚀 Cách dùng

### Tải nhạc
1. Mở video YouTube
2. Click icon 🎵 trên Chrome
3. Chọn **Thể loại** (hoặc thêm thể loại mới bằng nút ＋)
4. Chọn **Định dạng**: MP3 / MP4 720p / MP4 1080p / M4A
5. Nhấn **TẢI VỀ**
6. File lưu vào `~/Downloads/YT-Music/`

### Bật/Tắt server
- Vào tab **🖥 Server** trong extension
- Nhấn **▶ KHỞI ĐỘNG SERVER** (cần đã chạy `install.bat` trước)
- Chấm xanh ở góc = server đang chạy

### Thư viện nhạc
- Tab **📚 Thư viện** hiển thị toàn bộ bài đã tải
- Lọc theo **thể loại** hoặc **tìm kiếm**
- Nếu mở video đã có trong thư viện → hiện cảnh báo ⚠ ĐÃ CÓ

---

## 🛡️ Tính năng chống trùng & chống bị chặn

| Tính năng | Mô tả |
|-----------|-------|
| Kiểm tra trùng | So sánh Video ID trước khi tải, cảnh báo nếu đã có |
| Strip playlist | URL tự động bỏ `list=...` — chỉ tải 1 video |
| Cookie bypass | Copy cookie DB sang file tạm, bỏ qua lock của Chrome |
| robocopy | Dùng khi shutil không copy được file đang bị lock |

---

## ❓ Lỗi thường gặp

| Lỗi | Cách sửa |
|-----|----------|
| Server offline sau khi install.bat | Reload extension ở `chrome://extensions/` |
| Cookie thất bại | Đảm bảo đã đăng nhập YouTube trên Chrome |
| Không có MP3 | `choco install ffmpeg` |
| Nút Start không làm gì | Chạy `install.bat` trước, sau đó reload extension |
