# EPU Extension (Chrome/Edge/Firefox, Manifest V3)

Extension hỗ trợ sinh viên thao tác nhanh trên web sinh viên EPU (`https://sv.epu.edu.vn`).

## Tính năng
- Liên kết nhanh tới các trang hay dùng (TKB, điểm, đăng ký tín chỉ...).
- Tra cứu giảng viên (trang riêng, mở từ popup; có nút Cài đặt ở góc trên).
- Thống kê % nghỉ học ngay trên trang dashboard của web sinh viên; tự kiểm tra điểm danh và báo khi có thay đổi.
- Đồng bộ lịch học tự động: khi mở trình duyệt (tối đa 1 lần thành công mỗi ngày), extension tự lấy lịch theo tuần từ web sinh viên bằng cookie đăng nhập có sẵn của trình duyệt, lưu vào bộ nhớ cục bộ rồi gửi lên Worker lịch (MSSV tự lấy). Worker đổi sang `.ics`; mở `<địa chỉ Worker>/?id=<MSSV>` để đăng ký lịch vào Google Calendar/Outlook/điện thoại. Người dùng chọn khoảng "từ ngày … đến ngày …" (tối đa 1 năm) trong Cài đặt; để trống thì lấy từ hôm nay đến 12 tuần sau. Extension lấy và gửi trọn từng tuần chạm vào khoảng đó; Worker đè lại tuần nào được gửi (buổi bị hủy/đổi trong tuần đó biến mất), các tuần khác giữ nguyên và Worker không tự xóa dữ liệu cũ. Nếu lúc mở trình duyệt chưa đăng nhập hoặc chưa có mạng thì tự thử lại khi sinh viên vào web sinh viên; nút "Đồng bộ ngay" ở popup/Cài đặt để chạy tay.
- Xem/sửa/nhập/xuất cookie.
- Đồng bộ cookie đăng nhập lên Cloudflare Worker của bạn (tắt mặc định, cần cấp quyền khi bật). Chỉ dùng cho cá nhân, không cần cho đồng bộ lịch học ở trên.
- Ẩn thông tin cá nhân trên trang (họ tên, MSSV, CCCD...) theo lựa chọn trong Cài đặt.
- Quét QR bằng phím tắt **Alt+Q**: chụp màn hình, kéo chọn vùng có mã QR, extension giải mã và xử lý theo loại
  (liên kết → tự mở tab mới; Wi-Fi, VietQR, email, SĐT, vị trí, văn bản → hiện kết quả kèm nút sao chép/mở).
  Đổi phím tắt tại `chrome://extensions/shortcuts`.

## Cài đặt thử
1. Mở `chrome://extensions` (hoặc `edge://extensions`), bật **Developer mode**.
2. Chọn **Load unpacked** và trỏ tới thư mục này.
3. Trang Cài đặt tự mở lần đầu: kiểm tra địa chỉ web sinh viên.

## Quyền và quyền riêng tư
- Quyền cố định: `storage`, `activeTab`, `scripting`, `cookies`, `notifications` và truy cập `*://sv.epu.edu.vn/*`. Phải giữ cả `http`: cookie đăng nhập `ASC.AUTH` không có cờ Secure nên Chrome tính nó thuộc `http://sv.epu.edu.vn`; nếu chỉ cho `https`, `chrome.cookies` sẽ không thấy cookie và các tính năng cookie (xuất/sửa, đồng bộ) báo như chưa đăng nhập.
- Địa chỉ khác (ví dụ Worker đồng bộ cookie, hoặc web sinh viên ở domain khác) là **quyền tùy chọn**: trình duyệt hỏi khi bạn bật đồng bộ hoặc lưu địa chỉ đó trong Cài đặt. Chỉ chấp nhận `https://`.
- Các content script chỉ chạy trên `https://sv.epu.edu.vn`. Đổi địa chỉ web sinh viên sang domain khác chỉ ảnh hưởng popup và trang tra cứu giảng viên, không bật được content script ở domain đó.
- Dữ liệu lấy từ server luôn được đưa vào trang bằng `textContent`/DOM API (không dùng `innerHTML`); HTML của server (bảng chi tiết nghỉ) được lọc bỏ script và thuộc tính `on*`.

## Cấu trúc
- `manifest.json`: khai báo extension
- `config.js`: cấu hình mặc định và hàm dùng chung cho các trang extension (popup, cài đặt, tra cứu giảng viên, service worker)
- `shared/`: mã dùng chung cho content script và trang tra cứu giảng viên (`dom.js` dựng DOM an toàn, `teachers.js` logic giảng viên)
- `content/`: chạy trên trang web sinh viên, mỗi file một tính năng
  - `student-info.js` (đọc MSSV/họ tên), `attendance.js` (kiểm tra điểm danh), `absent-dashboard.js` (thống kê % nghỉ), `teachers.js` (tải sẵn danh sách giảng viên), `hide-fields.js` (ẩn thông tin)
  - `main.js`: khởi động các tác vụ nền (nạp sau cùng, thứ tự nạp khai báo trong `manifest.json`)
  - `qr-scan.js`: lớp phủ chọn vùng + giải mã + hiển thị kết quả QR (chèn khi bấm Alt+Q)
- `lib/jsQR.js`: thư viện giải mã QR (jsQR 1.4.0, Apache-2.0, kèm file license)
- `background/service-worker.js`: đồng bộ cookie, mở tab từ QR, xử lý phím tắt, chạy đồng bộ lịch khi mở trình duyệt (`onStartup`)
- `background/calendar-sync.js`: lấy lịch từng tuần từ web sinh viên, lưu `chrome.storage.local`, gửi lên Worker lịch
- `calendar-worker/`: Cloudflare Worker nhận lịch từ extension, đổi sang `.ics`, lưu KV, trả `.ics` theo `?id=<MSSV>` (không đóng gói vào extension, xem mục dưới)
- `popup/` (cookie, đồng bộ, ẩn thông tin, liên kết nhanh), `options/` (trang cài đặt), `teachers/` (trang tra cứu giảng viên)
- `icons/`: icon 16/32/48/128
- `tools/`: công cụ cho người phát triển, **không** đóng gói vào extension (`package.ps1`, `logo-source.png` là logo gốc 818px để tạo lại icon)
- `html/`, `.playwright-mcp/`: dữ liệu phân tích/thử nghiệm cục bộ, đã nằm trong `.gitignore`

## Worker lịch (`calendar-worker/`)
Worker chỉ nhận dữ liệu lịch do extension gửi (không giữ cookie, không tự truy vấn web sinh viên, không cron).
- `POST /` với JSON `{ id, dates, events }`: lưu lịch; các ngày trong `dates` được thay mới, ngày khác giữ nguyên.
- `GET /?id=<MSSV>`: trả file `.ics`; chưa có dữ liệu thì trả JSON lỗi (404). `&action=view` hiện dữ liệu lưu trong KV dạng JSON thay vì `.ics`.
- Link chỉ dựa vào MSSV, ai biết MSSV đều xem được lịch của MSSV đó.

Triển khai trên dashboard Cloudflare (không cần cài gì):
1. **Workers & Pages** > tạo Worker mới > **Edit code** > dán toàn bộ `calendar-worker/index.js` > **Deploy**.
2. **Storage & Databases > KV**: tạo một KV namespace mới. Vào Worker mới > **Settings > Bindings > Add > KV namespace**, chọn namespace đó và đặt tên biến là đúng `CALENDAR_KV`.
3. Chép địa chỉ `https://<tên>.<tài khoản>.workers.dev` vào `DEFAULT_CONFIG.calendarSync.workerUrl` trong `config.js` để người dùng khỏi phải nhập (họ chỉ cần tick "Bật đồng bộ lịch học" trong Cài đặt).

## Đóng gói để phát hành
```powershell
powershell -ExecutionPolicy Bypass -File tools/package.ps1
```
Tạo `dist/epu-extension-<version>.zip` chỉ gồm các file extension cần (không có `html/`, `tools/`, README...). Nhớ tăng `version` trong `manifest.json` trước khi phát hành bản mới.
