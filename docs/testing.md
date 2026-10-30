# Kiểm tra trước khi phát hành

- `npm test`: các kịch bản nhiệm vụ, simulator, Valetudo, cấu hình, health và hồi quy lưu sau mất kết nối; thêm `test-feature-policy.js` (cấu hình version 2, chuyển cấu hình cũ, gợi ý, điều kiện bật, hai seed), `test-billing.js` (vòng đời phiếu tính tiền, 30 ngày) và `test-guest-policy.js` (orchestrator: gọi nhân viên/tính tiền, báo nhầm món, phiếu qua WS, tắt tính năng giữa chừng). Cấu hình cũ trong test được dựng từ seed bằng `scripts/helpers/legacy-site.js`.
- `node scripts/smoke-review.js`: khởi động Node-RED và Mosquitto riêng trên loopback 1891/1886, dùng thư mục tạm. Cần `mosquitto` trong PATH. Kiểm tra retained khi thêm robot, redeploy riêng node MQTT, đổi topic/cache bản đồ, cảnh báo broker, và giao Bếp → T01. Script từ chối chạy nếu cổng đã bận và dừng các process do nó tạo khi xong.

Để kiểm tra trình duyệt, cần Playwright và Chromium. Có thể dùng bản cài ngoài repo: `PLAYWRIGHT_MODULE` = thư mục module `playwright`, `PLAYWRIGHT_CHROMIUM` = file chạy Chromium. Bản Playwright không tìm thấy Chromium đúng phiên bản thì trỏ tới headless shell đã có, vd. `~/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`.

1. `npm run web`
2. `SMOKE_HOLD=1 node scripts/smoke-review.js` — đợi dòng `HOLD for browser tests`.
3. Ở terminal khác: `python3 -m http.server 1892 --bind 127.0.0.1 --directory ../web`
4. `node scripts/smoke-browser.js` — các màn 1280×800 / 800×1280, web 390px, xung đột lưu, phản hồi bản đồ cũ và định vị.
5. `node scripts/smoke-feature-policy.js` — tab Tính năng, trang QR / màn robot / trạm theo từng tính năng, dẫn khách (robot Valetudo giả qua MQTT 1886), tính tiền tại trạm. Mỗi kịch bản xoá state và lưu lại cấu hình của **môi trường tạm**. `SMOKE_ONLY=<regex>` chỉ chạy kịch bản khớp tên, vd. `SMOKE_ONLY=billing` (chạy một phần vẫn in `FEATURE_POLICY_BROWSER_OK`).
6. `node scripts/smoke-web.js` — bấm nút thật ở trạm và màn robot trong demo để giao Bếp → T01; hai trình duyệt độc lập: một bên lưu tính năng khác, bên kia vẫn thấy mặc định của `demo/site.json`.
7. Gửi SIGTERM cho process `smoke-review.js` để nó dọn các dịch vụ tạm; dừng HTTP server.

Các bài smoke chỉ dùng cổng 1891 (Node-RED), 1886 (MQTT) và 1892 (web tĩnh), thay đổi dữ liệu **môi trường tạm**, không dùng cổng 1880/1884 đang vận hành. Robot thật được mô phỏng qua MQTT; cần kiểm tra riêng trên phần cứng trước khi đưa thay đổi điều khiển vào vận hành.
