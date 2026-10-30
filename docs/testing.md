# Kiểm tra trước khi phát hành

- `npm test`: các kịch bản nhiệm vụ, simulator, Valetudo, cấu hình, health và hồi quy lưu sau mất kết nối; thêm `test-feature-policy.js` (cấu hình version 2, chuyển cấu hình cũ, gợi ý, điều kiện bật, hai seed), `test-billing.js` (vòng đời phiếu tính tiền, 30 ngày) và `test-guest-policy.js` (orchestrator: gọi nhân viên/tính tiền, báo nhầm món, phiếu qua WS, tắt tính năng giữa chừng, khởi động lại giữa các bước phiếu). Cấu hình cũ trong test được dựng từ seed bằng `scripts/helpers/legacy-site.js`.
- `node scripts/smoke-review.js`: khởi động Node-RED và Mosquitto riêng trên loopback 1891/1886, dùng thư mục tạm. Cần `mosquitto` trong PATH. Kiểm tra retained khi thêm robot, redeploy riêng node MQTT, đổi topic/cache bản đồ, cảnh báo broker, và giao Bếp → T01. Script từ chối chạy nếu cổng đã bận và dừng các process do nó tạo khi xong.

Để kiểm tra trình duyệt, cần Playwright và Chromium. Có thể dùng bản cài ngoài repo: `PLAYWRIGHT_MODULE` = thư mục module `playwright`, `PLAYWRIGHT_CHROMIUM` = file chạy Chromium. Bản Playwright không tìm thấy Chromium đúng phiên bản thì trỏ tới headless shell đã có, vd. `~/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`.

1. `npm run web`
2. `SMOKE_HOLD=1 node scripts/smoke-review.js` — đợi dòng `HOLD for browser tests`.
3. Ở terminal khác: `python3 -m http.server 1892 --bind 127.0.0.1 --directory ../web`
4. `node scripts/smoke-browser.js` — các màn 1280×800 / 800×1280, web 390px, xung đột lưu, phản hồi bản đồ cũ và định vị.
5. `node scripts/smoke-feature-policy.js` — tab Tính năng, trang QR / màn robot / trạm theo từng tính năng, dẫn khách (robot Valetudo giả qua MQTT 1886), tính tiền tại trạm, từng gợi ý được lưu, từng tính năng bật riêng, trang QR tiếng Anh ở 390 px và yêu cầu khách bị mất kết nối giữa chừng. Mỗi kịch bản xoá state và lưu lại cấu hình của **môi trường tạm**. `SMOKE_ONLY=<regex>` chỉ chạy kịch bản khớp tên, vd. `SMOKE_ONLY=billing` (chạy một phần vẫn in `FEATURE_POLICY_BROWSER_OK`).
6. `node scripts/smoke-web.js` — bấm nút thật ở trạm và màn robot trong demo để giao Bếp → T01; hai trình duyệt độc lập: một bên lưu tính năng khác, bên kia vẫn thấy mặc định của `demo/site.json`.
7. Gửi SIGTERM cho process `smoke-review.js` để nó dọn các dịch vụ tạm; dừng HTTP server.

Các bài smoke chỉ dùng cổng 1891 (Node-RED), 1886 (MQTT) và 1892 (web tĩnh), thay đổi dữ liệu **môi trường tạm**, không dùng cổng 1880/1884 đang vận hành. Robot thật được mô phỏng qua MQTT; cần kiểm tra riêng trên phần cứng trước khi đưa thay đổi điều khiển vào vận hành.

## Nghiệm thu 2026-10-30 — chính sách tính năng nhà hàng và tính tiền do nhân viên xác nhận

Spec: [restaurant feature policy](superpowers/specs/2026-10-30-restaurant-feature-policy-design.md) §9, §10. Branch `feat/ui-redesign-phase2`: trial `5eda9b7..` (lib/UI lúc nghiệm thu: `fa0be26`), web `5c495a5..bc1b735`. Chạy trên macOS, Node-RED/Mosquitto tạm 1891/1886, web tĩnh 1892, Chromium headless shell 1248 (Playwright 1.61.1). Không đụng 1880/1884.

### Lệnh và kết quả

| Lệnh / bước | Kết quả |
|---|---|
| `npm test` | exit 0. `test.js` OK; `test-feature-policy` 22/22; `test-billing` 15/15; `test-guest-policy` 31/31 (thêm test khởi động lại); `test-valetudo`, `test-site`, `test-health`, `test-review` đạt; 0 fail. |
| `node scripts/smoke-review.js` (đầy đủ) | exit 0: 7 ✓ (broker simulator im lặng, retained, redeploy MQTT, đổi topic, topic cũ, outage, giao Bếp → T01), `SMOKE_OK`. |
| `SMOKE_HOLD=1 node scripts/smoke-review.js` | 7 ✓, `HOLD for browser tests`. |
| `node scripts/smoke-feature-policy.js` | 18/18 ✓ (15 kịch bản có sẵn + 3 mới), `FEATURE_POLICY_BROWSER_OK`. |
| `node scripts/smoke-browser.js` | 6 ✓, `BROWSER_OK`. |
| `python3 -m http.server 1892 …` + `node scripts/smoke-web.js` | 2 ✓ (giao Bếp → T01 bằng nút thật trong demo; hai trình duyệt độc lập). |
| Dừng các process nền | 1891/1886/1892 trống, không còn mosquitto/robot-review/http.server. |
| Khởi động lại Node-RED thật (script dùng một lần, không commit) | Bản sao tạm `data/`, Node-RED 1891, broker trỏ 1886. Sau prepare, claim, settle và close: SIGTERM rồi khởi động lại (5 lần boot). Mỗi lần: trạng thái phiếu còn nguyên, gửi lại cùng requestId → `duplicate`, receipt `call` còn; lượt sau nhận phiếu #2. |
| `npm run pack` | `dist/robot-nodered.tar.gz` (684 KB). Có `data/lib/feature-policy.js`, `data/lib/billing.js`. Tập `data/lib` + `data/public` trong gói = tập file git theo dõi. Mọi `<script src>` của 7 trang có trong gói (`lib/` phục vụ qua `httpStatic` `/lib/`). |
| `git diff --check 5eda9b7 HEAD`, `git -C ../web diff --check 5c495a5 HEAD` | sạch. |
| Quét conflict marker (`git grep`, hai repo) | không có. |
| `cmp` trial ↔ `../web/demo` (public trừ transport/index/showcase, 6 module lib, seed demo) | 38/38 giống. |

### Ma trận trình duyệt và vận hành

| Ô | Kết quả | Bằng chứng |
|---|---|---|
| 1280×800, 800×1280 | Đạt | `smoke-browser`: 10 màn Node-RED không tràn ngang ở cả hai cỡ. `smoke-feature-policy`: tab Tính năng/Hệ thống chạm được mọi control; màn robot gọi món (khi tắt), màn trả tiền và vùng Tính tiền của trạm vừa màn hình ở cả hai cỡ. |
| 390 px | Đạt | QR T05 tiếng Việt (chính sách request) và tiếng Anh (direct, hai nút gọi) không cuộn ngang; web index/serve/demo/contact/demo-index (`smoke-browser`). |
| VI/EN trang khách | Đạt | QR: chuyển EN, tải lại vẫn EN, nhãn nút / trợ giúp / toast tiếng Anh. Màn robot luôn song ngữ. |
| Bốn preset áp dụng + lưu | Đạt | Mỗi preset lưu đúng hàng bảng §4.2; thực đơn, ghi chú, ngân hàng, điểm, robot và trạm nhận không đổi. Áp dụng chỉ đổi bản nháp (kịch bản có sẵn). |
| Từng tính năng riêng | Đạt | Tất cả tắt + từng flag trong 6 flag: QR T05, R1 chờ tại T05 (có phiếu 0đ), R2 chờ tại quầy chỉ hiện đúng nút của flag đó. |
| Trộn simulator + Valetudo | Đạt (Valetudo giả) | R2 là Valetudo giả qua MQTT 1886: không có nút đi chậm; R1 simulator có và đổi tốc độ. Unit: server từ chối `speed` của Valetudo, không đổi state. |
| Mất kết nối lúc lưu | Đạt | "a save lost in a reconnect…" và xung đột lưu (`smoke-browser`). |
| Mất kết nối lúc khách gửi yêu cầu | Đạt | Lệnh `call` bị giữ, socket đóng; khi nối lại gửi lại cùng requestId → một cảnh báo, một toast; bản gốc tới muộn được trả `duplicate`. |
| Khởi động lại sau prepare/claim/settle/close | Đạt | Node:test (`st` qua JSON như context localfilesystem, gửi lại cùng requestId sau mỗi bước) và khởi động lại Node-RED tạm thật (bảng trên). |
| Tắt từng tính năng giữa luồng (§9) | Đạt | callStaff/requestBill: nút ẩn, cảnh báo đang mở giữ tới khi ack, ack không đổi phiếu. order: giỏ giữ, bật lại gửi được. guide: chuyến đang chạy xong, nút chậm/huỷ còn. pay: màn đang mở vẫn claim. busRobot: chuyến thu dọn đang chạy dỡ xong, trạm vẫn tạo thu dọn. direct → request: nút đổi, lệnh huỷ của trang cũ bị từ chối `policy`, chuyến giữ nguyên. |

### A01–A12

| AC | Bằng chứng |
|---|---|
| A01 | `ack` chỉ lọc `st.alerts` (orchestrator `case 'ack'`). Unit: `test.js` ack cũ, `test-guest-policy` ack không đổi phiếu/đơn. Browser: ack yêu cầu tính tiền và claim giữ đơn/phiếu. |
| A02 | `test-feature-policy`/`test-site`: migrate không đổi rev/by/savedAt, không bật thêm. `test-guest-policy`: hello site cũ không lưu, trang cache trước v2 bị từ chối. Browser: `notes:[]` giữ rỗng sau lưu + tải lại, cảnh báo đã chuyển cấu hình. |
| A03 | Browser: preset chỉ đổi bản nháp và liệt kê thay đổi; bốn preset lưu đúng bảng; xung đột lưu / mất kết nối giữ bản nháp. |
| A04 | Browser: order bật với thực đơn rỗng → "Chưa đủ điều kiện" + lý do có link; callStaff thiếu trạm nhận. Unit: server trả `not-ready` kèm lý do; QR chỉ toast khi có reply. |
| A05 | Unit: callStaff/requestBill/pay độc lập, định tuyến về trạm nhận, một cảnh báo mỗi bàn/loại, returnRequest khi callStaff tắt. Browser: chỉ nút tính tiền, cảnh báo ở Quầy pha chế, trả món về trạm của chuyến. |
| A06 | Browser: đổi bàn giao từ trạm, QR VI/EN, chip ghi chú tuỳ chỉnh / rỗng, busRobot tắt ẩn lối tắt robot. Unit + browser: trạm vẫn tạo thu dọn khi busRobot tắt. |
| A07 | Browser: Valetudo giả không có nút chậm, simulator đổi tốc độ, dẫn khách cần chọn + xác nhận bàn. Unit: `speed` Valetudo bị từ chối không đổi `slow`. |
| A08 | `test-billing`: snapshot/rev/requestId, claim không nhận amount, chỉ settle mới đổi trạng thái thanh toán, close đóng đúng `orderIds`, từ chối khi còn đơn/chuyến. Tìm kiếm mã: không có filter theo bàn xoá đơn, không có amount từ client vào phiếu/cảnh báo, không có trạng thái "paid" cục bộ ở trang nào. |
| A09 | Browser: sau claim không hỏi chuyển khoản lại; QR lỗi → QR tĩnh + tổng đúng; đổi tài khoản khi có phiếu mở bị chặn. Unit: sửa thực đơn không đổi snapshot. |
| A10 | Tắt từng tính năng giữa luồng (ma trận trên); retry/restart giữ idempotency (node:test + khởi động lại thật). |
| A11 | Browser: `tab=guest` mở tab Tính năng, Hệ thống dẫn tới editor duy nhất, control chạm được ở hai cỡ tablet, QR VI/EN 390 px. |
| A12 | `cmp` 38/38 trial ↔ web demo (cùng policy/billing/orchestrator); `smoke-web` đạt; copy demo đã rà ở Task 9 (robot mô phỏng, chậm chỉ trên simulator, claim không phải xác nhận ngân hàng). |

### Chưa xác minh / giới hạn phần cứng

- Robot Valetudo thật: chỉ dùng `scripts/fake-valetudo.js` qua MQTT. Chưa thử điều hướng, từ chối tốc độ và dẫn khách trên phần cứng.
- Thiết bị thật (tablet Android/iPad, điện thoại iOS/Android, Safari, bàn phím ảo, cảm ứng): chỉ Chromium headless theo kích thước màn hình.
- VietQR: `img.vietqr.io` bị chặn hoặc giả lập trong smoke; chưa quét QR bằng app ngân hàng. Xác minh tiền vào là việc của nhân viên (ngoài phạm vi).
- Âm báo trạm/robot; Wi-Fi rớt thật (mô phỏng bằng đóng socket / bỏ lệnh gửi).
- Demo web tĩnh: luồng tính tiền và từng tính năng chỉ chạy trên Node-RED tạm; demo dùng cùng file (cmp) và `smoke-web` chỉ giao món + lưu tính năng.
- Gói `npm run pack`: kiểm nội dung, chưa cài trên Termux.
- Lưu giữ 30 ngày: kiểm bằng đồng hồ giả trong unit test.
- Thông báo chuyển cấu hình cũ trong trình duyệt: smoke chèn message; hello với site cũ kiểm bằng unit test.
- Các bước nâng cấp production (export cấu hình, sao lưu context khi đã dừng, nâng core + UI cùng lúc, tải lại tablet, rollback bằng snapshot) chỉ có trong `docs/valetudo-setup.md` §2d, không thực hiện.

### Ghi nhận, không sửa trong đợt này

- Nút "↺ Khởi động lại demo" (tab Mô phỏng của trạm, hiện khi có robot simulator) gửi `reset`: xoá toàn bộ state, kể cả đơn/phiếu đang mở; server nhận `reset` từ mọi client. Đây là thao tác hai chạm có chủ ý từ trước, không phải cleanup tự động. Cần quyết định sản phẩm nếu vận hành thật với fleet có robot simulator.
- Ô tổng của trạm hiểu "1,5" là 15đ. Nút hiện "Chuẩn bị phiếu · 15đ" trước khi gửi, và tổng khác tổng tham khảo bắt buộc ghi chú (minor đã ghi ở Task 8).
