# EPU Extension

Tiện ích trình duyệt (Chrome / Edge / Cốc Cốc / Firefox, Manifest V3) giúp sinh viên Đại học Điện lực (EPU) thao tác nhanh hơn trên web sinh viên `https://sv.epu.edu.vn` và `https://thanhtoanhocphi.epu.edu.vn`.

> Extension chưa lên store, cài thủ công theo hướng dẫn bên dưới. Cài xong, mở popup sẽ thấy **số phiên bản** và được **tự báo khi có bản mới** trên GitHub.

## Tính năng

- **Liên kết nhanh** — popup có nút mở nhanh các trang hay dùng (Trang chủ, Lịch theo tuần, Kết quả học tập, Đăng ký học phần…). Danh sách sửa được trong Cài đặt.
- **Thống kê % nghỉ học** — chèn cột phần trăm đã nghỉ cho từng môn ngay trên trang điểm danh; bấm vào số buổi nghỉ để xem chi tiết từng buổi.
- **Tự kiểm tra điểm danh** — tự đọc trang điểm danh (tối đa 30 phút/lần, lưu theo từng MSSV) và báo nổi trên trang khi số buổi nghỉ thay đổi.
- **Tra cứu giảng viên** — trang riêng mở từ popup, danh sách tải sẵn nền nên tra cứu tức thì.
- **Đồng bộ lịch học ra `.ics`** — bật trong Cài đặt; tự lấy lịch theo tuần bằng cookie đăng nhập và tạo link `.ics` để thêm vào Google Calendar / Outlook / lịch điện thoại. Chọn được khoảng ngày, tự thử lại khi lỗi tạm thời, có nút đồng bộ tay.
- **Thông báo qua webhook Discord** (tùy chọn) — mỗi lần đồng bộ lịch gửi một tin về kênh Discord (thành công kèm thay đổi, hoặc lỗi kèm lý do). Link webhook chỉ lưu trong trình duyệt.
- **Tự động khảo sát** — khi bị ép khảo sát bắt buộc, mở một trang chuyên dụng tự điền và gửi lần lượt các phiếu theo cấu hình (điểm mặc định, câu tự luận). Có đếm ngược và nút Huỷ/Dừng; mặc định tắt, bật phải cấu hình trước.
- **Quản lý cookie** — xuất / sao chép / nhập / sửa / xóa cookie của web sinh viên trong popup.
- **Ẩn thông tin cá nhân** — ẩn các trường chọn trong Cài đặt (họ tên, MSSV, CCCD, số tài khoản…); bật/tắt nhanh trong popup, có ô CSS tùy chỉnh.
- **Quét mã QR** (Alt+Q) — chụp màn hình, kéo chọn vùng chứa QR rồi giải mã: link tự mở tab, còn Wi-Fi / VietQR / email / SĐT / vị trí / văn bản hiện kết quả kèm nút sao chép. Đổi phím tắt tại `chrome://extensions/shortcuts`.

## Cài đặt

Extension cài thủ công ở **chế độ nhà phát triển** (chưa có trên store).

### Chrome / Edge / Cốc Cốc
1. Tải mã nguồn: trên GitHub bấm **Code → Download ZIP** rồi giải nén (hoặc `git clone`). Nhớ thư mục chứa file `manifest.json`.
2. Mở trang tiện ích: `chrome://extensions` (Edge: `edge://extensions`; Cốc Cốc: `coccoc://extensions`).
3. Bật **Chế độ nhà phát triển** (Developer mode) ở góc trên bên phải.
4. Bấm **Tải tiện ích đã giải nén** (Load unpacked) và trỏ tới thư mục vừa giải nén.
5. Extension xuất hiện; trang Cài đặt tự mở lần đầu — kiểm tra địa chỉ web sinh viên. Ghim icon lên thanh công cụ cho tiện dùng.

### Firefox
Mở `about:debugging` → **This Firefox** → **Load Temporary Add-on** → chọn file `manifest.json`. (Bản nạp tạm sẽ mất khi đóng Firefox.)

### Cập nhật
Mở popup sẽ thấy phiên bản hiện tại; nếu có bản mới trên GitHub, popup hiện thanh báo kèm nút dẫn tới trang tải. Tải bản mới rồi làm lại bước Load unpacked (hoặc bấm nút nạp lại ở trang tiện ích).

## Quyền và quyền riêng tư

- **Quyền cố định**: `storage`, `activeTab`, `scripting`, `cookies`, `notifications`, `alarms`, cùng truy cập `*://sv.epu.edu.vn/*` và `*://thanhtoanhocphi.epu.edu.vn/*`. Phải giữ cả `http`: cookie đăng nhập `ASC.AUTH` không có cờ Secure nên Chrome xếp nó thuộc `http://sv.epu.edu.vn`.
- **Quyền tùy chọn**: các địa chỉ khác (máy chủ đồng bộ lịch, hoặc web sinh viên ở domain khác) chỉ được xin khi bạn bật tính năng hoặc lưu địa chỉ đó trong Cài đặt. Chỉ chấp nhận `https://`.
- **An toàn dữ liệu**: dữ liệu từ server luôn đưa vào trang bằng `textContent` / DOM API; HTML server được lọc bỏ `script` và thuộc tính `on*`. Link webhook và dữ liệu cá nhân (lịch, điểm danh, cookie) chỉ lưu trong `chrome.storage.local` của trình duyệt bạn.

## Đóng gói để phát hành
```powershell
powershell -ExecutionPolicy Bypass -File tools/package.ps1
```
Tạo `dist/epu-extension-<version>.zip` chỉ gồm các file extension cần thiết. Nhớ tăng `version` trong `manifest.json` trước khi phát hành bản mới.
