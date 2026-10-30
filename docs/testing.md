# Kiểm tra trước khi phát hành

- `npm test`: các kịch bản nhiệm vụ, simulator, Valetudo, cấu hình, health và hồi quy lưu sau mất kết nối.
- `node scripts/smoke-review.js`: khởi động Node-RED và Mosquitto riêng trên loopback 1891/1886, dùng thư mục tạm. Cần `mosquitto` trong PATH. Kiểm tra retained khi thêm robot, redeploy riêng node MQTT, đổi topic/cache bản đồ, cảnh báo broker, và giao Bếp → T01. Script từ chối chạy nếu cổng đã bận và dừng các process do nó tạo khi xong.

Để kiểm tra trình duyệt, cần Playwright và Chromium (có thể dùng bản cài ngoài repo qua `PLAYWRIGHT_MODULE` và `PLAYWRIGHT_CHROMIUM`):

1. `npm run web`
2. `SMOKE_HOLD=1 node scripts/smoke-review.js` — đợi dòng `HOLD for browser tests`.
3. Ở terminal khác: `python3 -m http.server 1892 --bind 127.0.0.1 --directory ../web`
4. `node scripts/smoke-browser.js` — các màn 1280×800 / 800×1280, web 390px, xung đột lưu, phản hồi bản đồ cũ và định vị.
5. `node scripts/smoke-web.js` — bấm nút thật ở trạm và màn robot trong demo để giao Bếp → T01.
6. Gửi SIGTERM cho process `smoke-review.js` để nó dọn các dịch vụ tạm; dừng HTTP server.

Các bài smoke thay đổi dữ liệu **môi trường tạm**, không dùng cổng 1880/1884 đang vận hành. Robot thật được mô phỏng qua MQTT; cần kiểm tra riêng trên phần cứng trước khi đưa thay đổi điều khiển vào vận hành.
