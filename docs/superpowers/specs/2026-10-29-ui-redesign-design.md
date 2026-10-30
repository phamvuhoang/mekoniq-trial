# Làm lại giao diện theo thiết kế Claude Design (lượt 3) — 2 giai đoạn

Ngày: 2026-10-29 · Trạng thái: **bản nháp chờ duyệt** · Phạm vi: `trial/data/public/*` (UI Node-RED), `web/` (site tĩnh Vercel), `trial/data/lib/*` chỉ ở giai đoạn 2.
Nguồn thiết kế: dự án Claude Design `9c8adb32-42d2-458e-a423-f86bb8e8ea4f` (14 file, sync 2026-10-29T00:48Z, `github.md` trong dự án ghi ánh xạ màn → file).
Nối tiếp: `2026-10-28-site-config-valetudo-map-design.md` (đã làm: cấu hình sống, `setup.html`, `vmap.js`, tự xử lý chặn).

## 1. Ý định

Bộ UI hiện tại (station/robot/table/map/setup/index + `web/`) làm việc đúng nhưng mỗi trang một kiểu: trạm dùng thanh xanh dương kiểu công nghiệp, robot dùng kiosk dọc cuộn được, trang cấu hình kiểu web form. Thiết kế mới thống nhất:

- **Một ngôn ngữ hình ảnh** cho mọi màn: thanh đầu tối (`#071d21`) có logo, tiêu đề + dòng phụ, tab dạng segmented (tab chọn = mint `#b9fb75`), đồng hồ, chấm kết nối; chữ Be Vietnam Pro; nút chính mint có bóng trong đáy; thẻ trắng viền `#d9e5de` bo 18px; toast viên thuốc tối giữa đáy.
- **Không cuộn trên tablet**: mỗi màn vừa khít 1280×800 (ngang) và 800×1280 (dọc); xoay máy là bố cục tự xếp lại (ngang chia cột, dọc xếp tầng, vùng lệnh luôn ở dưới/tay phải).
- **Nút xác nhận luôn ở cùng một chỗ**: màn robot có vùng lệnh cố định (rail phải khi ngang, dock dưới khi dọc); trạm có cột "Lệnh sẽ gửi" cố định bên phải.
- **Song ngữ VI/EN** trên mọi chữ khách nhìn thấy (màn robot, trang QR).

Thiết kế cũng vẽ **tính năng chưa có**: gọi món trên robot, dẫn khách tới bàn, thanh toán VietQR, gọi nhân viên / xin hoá đơn từ QR, ghi chú nhanh, màn "pin yếu". Để không trộn rủi ro, chia 2 giai đoạn:

| | Giai đoạn 1 — chỉ đổi giao diện | Giai đoạn 2 — tính năng mới / mở rộng |
|---|---|---|
| Đổi gì | HTML/CSS/JS trong `data/public` và `web/`; **không** đổi `lib/*`, `flows.json`, hợp đồng WS | `lib/orchestrator.js`, `lib/site.js`, `site.json` schema, thông điệp WS mới, UI cho tính năng |
| Hành vi | Mọi nút hiện có vẫn gửi đúng thông điệp cũ; `npm test` không đổi | Thêm test cho từng thông điệp mới |
| Nghiệm thu | Mở từng màn ở 1280×800 và 800×1280: không có thanh cuộn trang; chạy lại kịch bản demo 2 phút ở `web/demo/index.html` không hụt bước | Kịch bản mới (§8) chạy trọn vòng trên demo trình duyệt và fake robot |

**Phản mục tiêu**
- Giai đoạn 1 làm "đẹp hơn" nhưng mất một nút đang dùng (VD "Đã nhận lại đồ", "Khôi phục mặc định", xoá điểm). → §4 liệt kê từng mục thiết kế **không vẽ** nhưng phải giữ.
- Tablet trong nhà hàng không có Internet → mất font, UI nhảy layout. → Font tự host (§2).
- Mất chế độ demo (sàn vẽ tay, vật cản, simulator) vì thiết kế vẽ theo demo. → Giữ `hasSim()` để ẩn/hiện như hiện nay.

## 2. Hệ thống thiết kế dùng chung (`brand.css`, `common.js`)

Thiết kế dùng inline style; ta trích ra token + lớp dùng chung. Giữ tên biến cũ của `brand.css`, bổ sung:

```css
:root { /* đã có: --deep --ink --gray --paper --light --mint --iq --accent --green --line --danger --warn */
  --pill-ok: #e3f6d0; --pill-go: #d9f3ee; --pill-warn: #ffe4cc; --pill-danger: #fbd9da;
  --warn-ink: #b5541a; --alert-ink: #3d1c05; --bg-app: #eef3f0;        /* nền màn tablet */
  --font: 'Be Vietnam Pro', system-ui, -apple-system, Roboto, sans-serif; --mono: 'JetBrains Mono', ui-monospace, monospace; }
```

- **Font**: `public/fonts/BeVietnamPro-{400,700,900}.woff2` + `JetBrainsMono-500.woff2` (OFL), `@font-face` với `font-display: swap`. Không dùng link Google Fonts (LAN nội bộ không có Internet). `web/` (Vercel, có Internet) dùng cùng file để một nguồn.
- **Thanh đầu `.appbar`** (64px; robot 76px): `logo | .title (tên + .sub chữ hoa cách chữ .18em #9bb6b0) | .seg.dark (tab) | spacer | link pill viền #3c5f5c | đồng hồ | .dot`. Hàm `APPBAR({title, sub, tabs, right})` trong `common.js` thay `BRAND()` cho các trang trạm/cấu hình/lộ trình; `BRAND()` vẫn dùng cho trang sáng (QR, hub, web).
- **Nút**: `.btn` bo 999px giữ; thêm `.act` (nút lệnh vùng cố định: bo 22px, `min-height` 72/92px, 2 dòng VI lớn + EN nhỏ mờ .65) với biến thể `.act.primary` (mint, `box-shadow: inset 0 -6px 0 rgba(7,29,33,.14)`), `.act.outline` (trắng viền 2px line), `.act.danger` (viền `--danger`, chữ đỏ; `.armed` → nền đỏ chữ trắng), `.act.warn` (viền `--accent`; armed → nền accent). `.act.dark` (nền deep, chữ trắng, 60px). Nhãn 2 dòng: `<b>VI</b><small>EN</small>`.
- **Segmented `.seg`**: nền `rgba(255,255,255,.08)` trên nền tối / trắng viền trên nền sáng, nút bo 10px, chọn = deep/trắng (sáng) hoặc mint/deep (tối).
- **Ô bàn `.tt`**: nhãn nhỏ "BÀN" cách chữ .12em mờ .65, số 40–44px đậm 900, dòng phụ 13px; chọn = nền deep chữ mint, tag "✓ K1" góc phải; bận = nền `#fff6ee` viền `#ffc9a3`; ngang 4 cột (trạm) / 6 cột (robot), dọc 3 cột; lưới `grid-auto-rows: minmax(0,1fr)` để vừa khung.
- **Pill `.pill.{ok,go,warn,danger}`** đổi nền sang `--pill-*`.
- **Dải cảnh báo `.strip`** ngay dưới appbar: nền `--accent` chữ `--alert-ink` (hoặc `--danger`/trắng với `error`), `KIND` chữ hoa + text + giờ + nút tối "Đã biết"/"Đã dọn lối đi". Thay cho khối `.alerts` hiện tại.
- **Toast**: một viên thuốc ở `bottom: 24px; left: 50%` nền deep chữ mint 16px đậm 800, 2.4 s; `.error` nền `--danger` chữ trắng, `.warn` nền `--accent` chữ `--alert-ink`. Bỏ cột toast góc phải.
- **Thẻ `.card`** bo 18px, padding 14–16px, không bóng trên nền tablet.
- **Khung tablet `.screen`**: `height: 100dvh; display: flex; flex-direction: column; overflow: hidden`; vùng chính `flex: 1; min-height: 0; display: grid`. Quy tắc dọc/ngang bằng `@media (orientation: portrait)` **và** `@media (max-width: 900px)` (điện thoại dọc cũng là "dọc"). Dưới 600px rộng (QR trên điện thoại) cho phép cuộn.
- **Màu trạng thái robot** (chấm, viền): `TONE = {ok: mint, go: iq, warn: accent, danger: danger}` đã có trong `station.html` → chuyển sang `common.js`.
- Dark mode: thiết kế không có; bỏ các khối `prefers-color-scheme` trong `brand.css` (3 trang đã `data-theme="light"`; QR và hub giữ sáng).

## 3. Ánh xạ màn ↔ file ↔ trạng thái thiết kế

| Thiết kế | File | Ghi chú |
|---|---|---|
| Robot App (rail/dock, landscape/portrait) | `robot.html` | 10 trạng thái vẽ; §4.1 liệt kê 9 trạng thái hiện có **không vẽ** |
| Station Dashboard | `station.html` view `desk` | bảng một màn 3 cột |
| Station Monitor | `station.html` view `mon` (`?view=mon`) | giữ 1 file, appbar có segmented "Điều phối · Giám sát" như thiết kế Monitor |
| Route Designer | `map.html` | giữ 3 công cụ (thiết kế vẽ 2) |
| Setup | `setup.html` | 4 tab lên appbar |
| Table QR | `table.html` | khung điện thoại; VI/EN ở giai đoạn 2 |
| Demo Hub | `index.html` (trial) và `web/demo/index.html` | cùng cấu trúc nhóm thẻ; bản web thêm "Chế độ trình diễn" + kịch bản |
| Website (Home · Serve S1 · Demo · Contact) | `web/index.html`, `web/serve.html`, `web/demo.html`, `web/contact.html`, `web/site.css` | 4 trang tĩnh (thiết kế là SPA 4 tab; site tĩnh không cần JS router); giữ form pilot hiện có |
| `floor.js` | — | chỉ phục vụ bản vẽ; ta vẫn vẽ sàn bằng `floorSVG()`/`netSVG()` và `vmap.js` |
| `logo.svg` | `public/logo.svg` | giống hệt (chỉ thêm metadata C2PA) → không đổi |
| Screens Overview / Robot App Options | — | khung so sánh, không có mã |

## 4. Từng màn — giai đoạn 1

### 4.1 `robot.html` — tablet trên robot

**Khung**: `header.appbar` 76px: logo (nền trắng bo 11px) · `barTitle` 24px + `barSub` 14px (EN) · pin (khung 40×20 + %) · chấm xanh + id · giờ · nút **DỪNG · STOP** (viên thuốc đỏ viền vàng 4px, cao 54px) trong header — thay nút tròn cố định góc dưới. Màu header theo tone: thường `--deep`; cảnh báo (`blocked`, pin yếu, chờ, tạm dừng, mất kết nối) `--accent` chữ deep; e-stop `--danger`. Nền vùng nội dung `#f6f8f4` / cảnh báo `#fff4ec` / e-stop `#fbe8e6`.

**Lưới thân**: ngang `grid-template: minmax(0,1fr) / minmax(0,1fr) 380px` (nội dung | rail trắng viền trái); dọc `minmax(0,1fr) auto / minmax(0,1fr)` (nội dung trên, dock dưới, nút xếp `flex-wrap`). Chọn theo `@media (orientation: portrait)`; không có nút đổi hướng (đó là công cụ xem bản vẽ).

**Mặt robot**: giữ hàm `face(mood, move)` SVG, đổi hình theo thiết kế: thân `#dbe6e8` viền `#b7c9cc` bo 60px, màn `#12333a` bo 40px, hai mắt tròn mint có `box-shadow` phát sáng, miệng cung mint; `sad/wait` → mắt bầu dục `--accent`; bỏ ăng-ten và hai bánh cam.

**Trạng thái theo thiết kế → điều kiện hiện có:**

| Thiết kế | Điều kiện (`view(r, m)`) | Nội dung | Rail |
|---|---|---|---|
| idle | rảnh, không sạc | eyebrow "MEKONIQ Serve · R1", `h1` 84px "Xin chào!", EN, chip "n khay trống · n trays free", chip "Sẵn sàng · Ready" | **GĐ1:** chỉ `Nhân viên · Staff` (nút tối) — mở lưới chọn bàn như "load" nhưng robot đang ở dock thì gửi `summon` tới trạm? **Không**: khi rảnh ở dock nút này chỉ hiện hướng dẫn "Gọi robot từ máy trạm". Ba nút Gọi món / Dẫn tôi tới bàn / Thanh toán là GĐ2 (ẩn bằng cờ `site.features`). |
| load | `atStop` + `standby` tại trạm (hiện là màn "Chọn bàn cần giao") | bước 1 chọn việc (Giao món / Thu dọn bàn — **mới trong UI**: hiện chỉ có giao; "thu dọn" = gửi `dispatch` với `toDish`? Không: `bus` từ robot = chọn 1 bàn rồi `dispatch {tables:[t], bus:true}` **chưa có** → GĐ2; GĐ1 chỉ hiện nút "Giao món" được chọn sẵn và nút "Mang chén về khu rửa" hiện có đưa vào rail), bước 2 lưới bàn 6/3 cột với trạng thái bận (`tableState` chuyển từ station sang `common.js`) | ô khay K1–K4 (chọn bàn thứ i → "Bàn nn"), `Đi giao n bàn · Go deliver` (primary), `Bỏ chọn · Clear`, `Về trạm sạc · Dock` (= `release`), `Mang chén về khu rửa` (= `toDish`) |
| moving | `toStop` | eyebrow "Đang giao · On the way" (đổi theo `s.a`: Tới lấy đồ / Tới thu dọn / Mang chén đĩa / Mang đồ về / Đang tới), tên đích 150px (dọc 96px), "Còn khoảng N giây · ~N s" (`etaSec`; Valetudo không có `rem` → ẩn), hộp cam "Xin quý khách nhường lối"; thẻ **Lộ trình**: các stop còn lại từ `m.stops` (`K1 Bàn 05 · Đang tới`, `K2 … · Tiếp theo`, `↩ Về Bếp · Cuối`), dòng nav khi `yield/queue/wait` | hộp tối "Đang di chuyển / Robot tự dừng khi có người hoặc vật cản", `Tạm dừng · Pause` (gửi `pause` — **mới trên robot**, orchestrator đã có), `Huỷ chuyến · Cancel trip` (armed → `cancel`) |
| handoff | `atStop` + `handoff` | trái: hộp khay `#dbe6e8` 4 ô, khay đang giao sáng mint + `box-shadow` trắng/mint, ô khác ghi bàn hoặc "trống"; phải: eyebrow "Bàn 05 · Đã tới", `h1` 58px "Mời quý khách lấy món ở Khay N", EN, thẻ món: chỉ có `m.note` (chưa có danh sách món → GĐ2), "Robot tự quay về sau N giây · Returns in N s" (`#timer`) | `Đã nhận món · Got it, thanks` (primary), `Trả lại bếp · Not mine, send back` (armed, warn), `Gọi nhân viên · Call staff` (**GĐ2**, ẩn) |
| blocked (alert) | `halt === 'blocked'` | mặt buồn, eyebrow "Lối đi bị chặn", `h1` "Xin nhường đường.", EN, đoạn giải thích | `Nhân viên: đã dọn lối · Path cleared` (primary tối) → `clear`; `Xử lý thủ công · Manual handling` (armed → `manual`, **mới trên robot**, orchestrator đã có) |
| estop (alert) | `halt === 'estop'` | header đỏ, nền hồng, eyebrow đỏ "An toàn · Safety", `h1` "Robot đã dừng hẳn.", EN, hướng dẫn | `Nhả dừng · Chạy tiếp` (đỏ; armed → đỏ đậm "Chạm lần nữa — đã kiểm tra an toàn") → `resume {atRobot:true}`; `Gọi quản lý ca` → **GĐ2** (ẩn) |
| battery (alert) | `charging === true` (hiện là màn "Đang sạc") | eyebrow "Pin 18% · Battery 18%", `h1` "Tôi cần đi sạc.", EN, "Robot đang về/đang ở Sạc 1. Việc mới sẽ chuyển cho robot khác tới khi pin đạt {chargedBattery}%" | `Đã hiểu · OK` (chỉ đóng nhấn mạnh, không gửi gì — bỏ: không cần nút; rail hiện chip pin) ; `Gọi nhân viên` → GĐ2 |

**Trạng thái hiện có, thiết kế không vẽ → dựng bằng cùng bộ phận:**

| Hiện có | Khung | Nội dung | Rail |
|---|---|---|---|
| `nav:'wait'` (xin nhường đường, tự thử lại) | alert cam, mặt `wait` | "Xin nhường đường." + dòng theo driver (giữ chữ hiện tại) | `Nhân viên: đã dọn lối` (outline) |
| `blocked` + `why:'noroute'` | alert cam | "Không có đường tới {đích}." + hướng dẫn hiện tại | `Xử lý thủ công` (armed) |
| `paused` | alert cam | "Robot tạm dừng." / "Một trạm đã tạm dừng robot này." | `Chạy tiếp · Resume` (primary) |
| `offline` | header đỏ | "Mất kết nối robot." | (không nút) |
| `atStop` + `load` (bếp xếp món) | như "load" nhưng bước 1 ẩn | tiêu đề "Xếp món lên khay", danh sách khay → bàn (`trayList`) + ghi chú | `Đã xếp xong · Đi giao` (primary), `Huỷ nhiệm vụ` (armed danger) |
| `atStop` + `return` | như handoff, khay sáng = các khay trả | "Trả lại đồ bị huỷ" + danh sách khay/bàn | `Đã nhận lại đồ` (primary) |
| `atStop` + `collect` | idle-split | "Mời đặt chén đĩa lên khay." + "Robot sẽ mang về {dish}" | `Xong · Mang về khu rửa` (primary), `Không có gì để thu` (armed, outline) |
| `atStop` + `unload` | idle-split | "Dỡ chén đĩa." | `Đã dỡ xong` (primary) |
| `atStop` + `standby` không ở trạm | idle-split, mặt `wait` | "Robot đang chờ." + "Gọi bởi …" | `Mang chén về khu rửa`, `Xong · Cho robot về` |
| `toDock` | idle-split, mặt vui, `bob` | "Về trạm sạc." + "Sẵn sàng nhận nhiệm vụ mới trên đường về" | (không nút) |
| Lớp "Chạm để khởi động" (mở âm thanh) | overlay toàn màn nền deep | mặt + "Chạm để khởi động · Tap to start" + "Bật âm thanh thông báo" | — |
| Không có robot `ID` trong cấu hình | header đỏ | giữ chữ | — |

Toast trên robot: viên thuốc **trên cùng giữa** vùng nội dung (thiết kế), dùng cho phản hồi nút ("Đã tạm dừng · Paused", "Robot chỉ có 4 khay").

### 4.2 `station.html` view Điều phối (Station Dashboard)

Appbar: logo · "MEKONIQ Serve / ĐIỀU PHỐI · DISPATCH" · **segmented vai trò** (Bếp · Pha chế · Dọn bàn · Quản lý — từ `site.roles`; chọn = mint) · spacer · segmented "Điều phối | Giám sát" · "Âm thanh bật/🔇" (chữ, ẩn khi dọc) · giờ · chấm. Dọc: ẩn khối tên thương hiệu.
- Vai trò: chạm segmented đổi `me.role`, lưu `localStorage` (thay nút "📍 …"). Hộp thoại thiết lập chỉ còn hỏi **tên máy** ở lần đầu (giữ `dialog#setup`, bỏ lưới vai trò trong đó); đổi tên: chạm giữ 1 s lên segmented hoặc nút nhỏ "…" cuối segmented. Quyết định: nút "…" (đơn giản, chạm giữ không rõ với người dùng).
- Dải cảnh báo (`.strip`) cho **mỗi** `App.state.alerts` (thiết kế vẽ 1); nút phải: `Đã biết` (`ack`); khi alert là chặn đường (`key` bắt đầu `blk-`) thêm nút tối `Đã dọn lối đi` → `clear {robot}`.

Thân `grid-template-columns: 270px minmax(0,1fr) 330px` (dọc: 1 cột, 3 hàng `auto minmax(0,1fr) auto`):
1. **Cột trái** "ROBOT · CHỌN ĐỂ CHỈ ĐỊNH": nút thẻ `Bất kỳ · gần nhất` (chấm iq, dòng phụ "n/N sẵn sàng") + mỗi robot (chấm tone, id, pin %, dòng phụ `robotStatus`); chọn = deep. Dưới: thẻ **Hàng chờ · n** cuộn nội bộ, mỗi dòng: nhãn đậm + dòng phụ `missionStatus`; phải: nút ✕ viền `#f0c2c3` (armed → đỏ "Huỷ?") → `cancel`; **giữ** 🔒 khi `locked(m)` và nút primary `✓ Đã nhận lại đồ / Đã dỡ chén đĩa` khi `arrived(m)` (thiết kế không vẽ). Dọc: robot 2 cột, hàng chờ cột 3.
2. **Giữa**: hàng 3 nút việc (`Giao món · Deliver`, `Thu dọn bàn · Bus table`, `Gọi robot tới · Summon`, 62px, chọn = deep); hàng chọn nguồn ("LẤY TẠI" + chip trạm, chọn = `--green`; bus: chữ "Mang chén về Khu rửa"; summon: "Chọn khu hoặc bàn") + gợi ý phải "n / 4 khay" / "Chọn 1"; lưới bàn **4 cột cố định**, `grid-auto-rows: minmax(0,1fr)`, ô `.tt` (summon: ô khu trước, chữ "Gọi robot tới"); bỏ `banner` lớn (thông tin đã nằm ở thẻ robot).
3. **Cột phải** thẻ "LỆNH SẼ GỬI · ORDER PREVIEW": tiêu đề 22px (`Bếp → 05, 07` / `Thu dọn Bàn 10` / `Gọi robot tới Bếp` / `Chưa chọn bàn`), "Robot: R1 · Gấp"; 4 ô khay K1–K4; "GHI CHÚ NHANH": chip bật/tắt (`Không hành`, `Ít cay`, `Món nóng`, `Thêm chén` — hằng trong UI, **GĐ2** cho vào `site.notes`) ghép thành `F.note` + ô text nhỏ "Khác…" (giữ ghi chú tự do hiện có, chỉ hiện tab giao món); nút ô vuông "Ưu tiên gấp · lên đầu hàng chờ" (toggle `F.urgent`); nút **primary 104px** `Gọi robot · giao n bàn` / `Gọi robot thu dọn` / `Gọi robot tới` (mờ .4 khi chưa chọn) → `create` như hiện nay; `Bỏ chọn` outline. Dọc: thẻ chia 2 cột, nút gửi chiếm cột phải.
- **Giữ nút thu hồi lớn** (đã duyệt 2026-10-29): khi **chưa chọn bàn**, thẻ "Lệnh sẽ gửi" không hiện "Chưa chọn bàn" trống mà đổi thành thẻ **"Lệnh gần nhất của trạm này"**: nhãn lệnh, robot, trạng thái (`cancelTarget()` hiện có: lệnh của robot đang chọn, hoặc lệnh mới nhất do trạm này tạo), nút lớn `Thu hồi robot · Recall` (2 chạm → `cancel`; khi `arrived(m)` → nút `✓ Đã nhận lại đồ / Đã dỡ chén đĩa`; khi `locked(m)` → chữ giải thích, không nút). Chọn bàn → thẻ chuyển về chế độ gửi lệnh như thiết kế. `✕` ở từng dòng hàng chờ vẫn có. GĐ2 thêm `Đổi bàn` (§6.9).
- Footer 1 dòng: "Hôm nay: **n lượt giao** · Hoàn thành x% · TB gọi → nhận m' · Can thiệp k" (thêm `interventions`).

### 4.3 `station.html` view Giám sát (Station Monitor)

Appbar như trên, segmented "Điều phối | Giám sát" đang chọn Giám sát; phải: link pill `Thiết kế lộ trình ↗` (chỉ `hasSim()`), `Cấu hình ↗`, giờ, chấm. Dải cảnh báo như 4.2.
Thân `minmax(0,1fr) 420px` (dọc: 1 cột `auto minmax(0,1fr)`):
- **Trái**: hàng công cụ: segmented chế độ (Chọn bàn · Đặt vật cản · Người đi qua; chỉ `hasSim()`) + gợi ý + nút `Gỡ vật cản (n)`; thẻ trắng chứa sơ đồ (`svg#map` sàn vẽ tay **hoặc** `canvas#vmap`), tỉ lệ giữ, `max-height: 100%`; chú giải 1 dòng (Lối đi · Lối hẹp · Đi chậm · Rảnh · Đang chạy · Cần xử lý — gộp `LEGEND` + tone robot); hàng **6 ô KPI** (24px số + nhãn 12px; dọc 3 cột).
- **Phải** thẻ có 4 tab gạch chân: `Đội robot` · `Nhiệm vụ · n` · `Nhật ký` · `Mô phỏng` (tab Mô phỏng chỉ `hasSim()`); thân cuộn nội bộ.
  - Đội robot: `robotHTML` giữ nút (Tạm dừng/Chạy tiếp, Đã dọn lối đi, Xử lý thủ công armed, "Nhả dừng tại màn hình robot", `Màn robot ↗`), thanh pin, viền cam khi `halt`.
  - Nhiệm vụ: `missionHTML` giữ (stops chip done/active/pending/cancelled/manual, huỷ từng bàn, huỷ nhiệm vụ armed, nút nhận lại đồ).
  - Nhật ký: 52px giờ + chữ, màu theo level.
  - Mô phỏng: dòng chú thích, segmented chọn robot, lưới 2 cột 6 nút: `Vật cản trước robot` (`sim block`), `Gỡ vật cản quanh robot` (`sim clear`), `Mất kết nối`, `Kết nối lại`, `Pin yếu`, `Dừng khẩn cấp` (gửi `estop` — thông điệp đã có; nền hồng chữ đỏ); dưới: `↺ Khởi động lại demo` armed (giữ).
- Sơ đồ sàn SVG: đổi màu theo thiết kế (`zones` `#e3f6d0`/`#d9f3ee`, bàn trắng viền `#a9bcb5`, bận viền `--green` 3px, chọn deep/mint; robot tròn 40px viền deep 3px nền tone, vòng đỏ khi chặn; vật cản tròn `N`/`G` cam/đỏ). `vmap.js`: đổi palette `COL` sang token (sàn `#f3f7f4`, tường `#143034`, phòng pastel giữ), robot như trên.

### 4.4 `map.html` — Thiết kế lộ trình

Appbar: logo (link về `station.html?view=mon`) · "Thiết kế lộ trình / ROUTE DESIGNER · SERVE S1" · spacer · pill "Đang chạy: bản n" · "● Có thay đổi chưa áp dụng" (cam, ẩn khi dọc) · `Huỷ thay đổi` (viền) · `Khôi phục mặc định` (viền, armed — **giữ**, thiết kế không vẽ) · `Áp dụng cho đội robot` (mint). Mờ .4 khi không dirty.
Thân `minmax(0,1fr) 360px` (dọc: sơ đồ trên, aside 2 cột `1fr 1.3fr`):
- Trái: thẻ sơ đồ (SVG như hiện nay, bàn mờ `#7d959b`, lối đi dày 3px/6px, lối chọn deep + `box-shadow` mờ, điểm dừng tròn 16px `--green`, điểm uốn 12px trắng viền `#7d959b`, điểm `from` cam) + chú giải 6 mục.
- Phải: thẻ **Công cụ** segmented 3 (`Chọn & kéo` · `Thêm điểm` · `Nối lối đi` — giữ 3) + gợi ý; thẻ **Đang chọn**: tiêu đề `A → B` 18px + "Dài x,y m"; 4 hàng **công tắc** (track 44×26, bật = green/`closed` = đỏ) `Một chiều`/`Lối hẹp`/`Đi chậm`/`Đóng lối` với mô tả 12px; hàng nút `⇄ Đảo chiều` + `Xoá lối đi`; chọn điểm: giữ panel hiện có; thẻ **Kiểm tra** (✓ xanh / ⚠ đỏ + "n lối đang đóng"). Thẻ "Nguyên tắc thiết kế lộ trình" → `<details>` gấp dưới Kiểm tra (ngắn gọn giữ nội dung).

### 4.5 `setup.html` — Cấu hình

Appbar (dọc: `flex-wrap`, tab xuống hàng riêng): logo (link `station.html?view=mon`) · "Cấu hình / SETUP · {site.name}" · segmented 4 tab (`Điểm & bản đồ` · `Robot` · `Vai trò & thời gian` · `Sao lưu`) · spacer · pill "Bản n" · `Huỷ thay đổi` · `Lưu`/`Đã lưu`/`Đang lưu…` (mint; mờ .4 khi không dirty). Dải `.strip` cam cho "Máy khác vừa lưu…" (+ nút `Tải lại bản mới`) và lỗi lưu (đỏ) thay `#saveMsg`/`#stale`.
- **Điểm & bản đồ** `minmax(0,1fr) 400px` (dọc 2 hàng): trái thẻ: dòng "BẢN ĐỒ ROBOT {id} · CHẠM ĐỂ ĐẶT ĐIỂM ĐANG CHỌN" + segmented robot (nếu >1) + nút `Phóng n×`; canvas `vmap` `flex:1; min-height:0` (canvas co theo khung: đặt `width/height` theo `getBoundingClientRect` khi resize); cảnh báo `mapRef` lệch = dải cam nổi trên bản đồ (giữ); hàng **điểm đang chọn** dưới bản đồ: tên 17px + toạ độ mono 12px ("x 1400 · y 1680 cm" / "chưa định vị — chạm lên bản đồ"), 4 mũi tên 44px một hàng, `Dùng vị trí robot` (tối), `Chạy thử tới đây`, `Xoá vị trí` (viền cam), **`Xoá điểm`** (armed, viền đỏ — thay nút xoá từng dòng; `dish` không xoá). Phải thẻ: "ĐIỂM DỪNG · n", danh sách cuộn, mỗi dòng: nhãn loại 11px hoa (Trạm/Rửa/Sạc/Bàn) · ô tên · pill (`● đã định vị` xanh / `○ chưa định vị` cam / `lấy từ robot` xám) · id mono nhỏ (giữ); chọn = nền `--pill-ok`; chân: `+ Thêm bàn` (mint) · `+ Thêm trạm`.
- **Robot** `repeat(3,minmax(0,1fr)) 300px` (dọc 2×2): một thẻ/robot: vòng tròn id deep/mint, "Robot R1", pill `Đã kết nối`/`Giả lập`/`Mất kết nối` (từ `App.state`); `Trạm sạc` select; `Loại` segmented `Robot thật` / `Giả lập` (= driver `valetudo`/`sim`); nếu thật: `Topic MQTT` (mono), nút gấp `▸ Nâng cao · n thông số` → danh sách núm (tên mono + mô tả `HINT` + ô số phải); đáy: `Xoá robot` (armed). Cột phải: thẻ **Pin** (`Pin yếu`/`Pin đủ` với stepper −/+ 5 %, = `timing.lowBattery/chargedBattery`), nút `+ Thêm robot` viền đứt. Quá 3 robot: cột robot cuộn ngang? → lưới `auto-fill minmax(280px,1fr)` cuộn dọc nội bộ.
- **Vai trò & thời gian** `1.2fr 1fr`: trái thẻ vai trò: mỗi vai trò khung viền: ô tên + id mono; "Màn mặc định" segmented 3 (`Giao món`/`Thu dọn`/`Gọi robot`) + "Vị trí: {home}" (select như hiện nay, gọn phải). Phải thẻ **Thời gian & khay**: mỗi dòng nhãn + stepper −/+ (`loadSec` ±10, `handoffSec` ±10, `remindSec` ±5, `standbySec` ±30, `trays` ±1) hiện giá trị kèm "s"; vẫn cho gõ số trực tiếp (chạm số → `input type=number`).
- **Sao lưu**: thẻ 640px giữa: "Đang chạy bản n", "Lưu lần cuối bởi … lúc …" (`site.by`, `site.savedAt` nếu có; không có → ẩn), 2 nút lớn `Tải xuống JSON` (tối) / `Nhập JSON`, `Khôi phục mặc định` (armed, viền cam), chú thích.

### 4.6 `table.html` — trang QR của khách

Khung điện thoại (max 480px giữa, nền `#f6f8f4`, cho phép cuộn danh sách): header logo + wordmark + (GĐ2: VI/EN); eyebrow "Theo dõi món của bạn", **"Bàn 05"** 52px; mỗi món = thẻ bo 22px: "Món ăn #412 · khay 1" + giờ; dòng món (`m.note`); 4 vạch tiến độ; dòng trạng thái 17px đậm (xanh khi đã tới, cam khi huỷ); nút `Huỷ món này` viền cam armed → `cancelStop` như hiện nay. Chú thích. Footer cố định 2 nút `Gọi nhân viên` / `Xin hoá đơn` → **GĐ2** (GĐ1 ẩn footer). Toast viên thuốc `bottom: 120px`.

### 4.7 `index.html` (trial) và `web/demo/index.html` — Demo Hub

Hero deep: logo + wordmark, eyebrow mint "Serve S1 · Demo vận hành", `h1` "Mọi màn hình, một chỗ.", dòng mô tả. Nhóm thẻ `auto-fill minmax(240px,1fr)`: thẻ = tag xanh 12px hoa · tiêu đề 18px "… ↗" · mô tả 14px:
1. **Máy trạm nhân viên** — một thẻ/vai trò (`station.html?role=`) + thẻ "Giám sát & sơ đồ" (`station.html?role=ql&view=mon`).
2. **Màn hình trên robot** — một thẻ/robot (`robot.html?robot=`), tag "Khách & nhân viên".
3. **Khách hàng** — lưới số bàn nhỏ như hiện nay (thiết kế vẽ 1 thẻ Bàn 05; demo 12 bàn cần đủ link) → thẻ đầu "Bàn 05 · Theo dõi món" + lưới số bàn.
4. **Cấu hình** — `Cấu hình`, `Thiết kế lộ trình` (chỉ `hasSim()`).
Bản `trial` giữ nút `⚙️ Node-RED` ở góc hero; bản `web/demo` thêm thẻ nổi "▶ Chế độ trình diễn (3 màn hình)" trong hero, thẻ "Kịch bản 2 phút" + "Về bản demo này" + nút xoá dữ liệu demo như hiện nay (bọc trong thẻ cùng kiểu). `showcase.html` chỉ đổi appbar.

### 4.8 `web/` — Website

4 trang tĩnh dùng `web/site.css` (token §2 + lớp trang web) và `web/demo/logo.svg`, font từ `web/demo/fonts/` (export copy):
- `index.html` (Home): header dính (logo + "Intelligence in Motion", nav 4 pill, nút mint "Đặt lịch demo"); hero deep 2 cột (`h1` "Ít đi lại. / Phục vụ nhiều hơn." mint, "Less walking. More serving." iq, đoạn, 2 nút, khung ảnh robot placeholder — **giữ** hình robot CSS hiện có thay placeholder); 3 cột điểm nhấn; "Cách hoạt động" 3 thẻ; khối "Màn hình robot mới" (mock màn giao món bằng CSS như thiết kế + 2 link mở demo); "Khi có sự cố" 5 hàng + hộp an toàn; "Pilot · Đo bằng dữ liệu" + CTA mint lớn; footer.
- `serve.html`: hero sản phẩm + lưới 6 tính năng + 3 thẻ ứng dụng (deep).
- `demo.html`: hero + nút "Mở toàn bộ demo ↗" (`demo/`) + 2 thẻ (robot `demo/robot.html?robot=R1`, trạm `demo/station.html?role=bep`) + "Kịch bản nên thử" 4 dòng; thêm nút "▶ Chế độ trình diễn" (`demo/showcase.html`).
- `contact.html`: 2 cột: 3 bước tiếp theo + form (giữ cơ chế gửi hiện tại của `web/index.html`; trạng thái "Đã nhận yêu cầu" như thiết kế).
Nội dung chữ lấy từ bản vẽ (đã viết sẵn tiếng Việt). Meta/OG giữ. Vercel: không cần `vercel.json`; link trong demo về `../` → `../index.html` vẫn đúng.

## 5. Quyết định kỹ thuật giai đoạn 1

- Không thêm thư viện, không build step. Mỗi trang vẫn là một file HTML tự chứa + `brand.css` + `common.js`.
- Thiết kế hiển thị nút xoay hướng để xem bản vẽ; sản phẩm dựa vào `@media (orientation: portrait)`. Có thể ép bằng `?orient=portrait` để chụp ảnh kiểm tra (đặt `data-orient` lên `<html>`, CSS dùng `:root[data-orient=portrait]` tương đương media query).
- Kích thước chữ cố định theo thiết kế (px) ở tablet; dưới 900px rộng giảm bằng `clamp()` ở vài chỗ (`h1` robot 84→56px, đích 150→96px).
- `setHTML()` giữ nguyên để nút không bị tạo lại mỗi tick; thời gian chạy (`#timer`) vẫn ngoài diff.
- Mọi nhãn song ngữ viết một chỗ: hằng `L = (vi, en) => \`<b>${vi}</b><small>${en}</small>\`` trong `common.js`.
- `export-web.sh` đồng bộ thêm `fonts/`; `web/demo/index.html` vẫn là bản web riêng (không bị ghi đè).
- Kiểm thử GĐ1: không có test tự động cho HTML; kiểm bằng `scripts/smoke-test.js` (giữ) + checklist chụp màn ở 1280×800 và 800×1280 bằng Chrome device toolbar cho 6 trang × trạng thái chính (danh sách trong plan). `npm test` phải xanh (không đổi lib).

## 6. Giai đoạn 2 — tính năng mới từ thiết kế

Tất cả gắn sau cờ `site.features = { order, guide, pay, call }` (mặc định `false` trong seed, `true` trong `site.demo.json`) để nhà hàng thật bật dần. Thông điệp WS mới đi qua `orchestrator.fromUI`, có test trong `scripts/test.js`.

### 6.1 Gọi nhân viên / Xin hoá đơn / Đã chuyển khoản (`features.call`) — nền cho các mục khác
- Thông điệp `{type:'call', point, what:'staff'|'bill'|'paid', by}` (point = bàn). Orchestrator: `alert(c, 'call-'+what+'-'+point, 'warn', text)` với text `Bàn 05 gọi nhân viên` / `Bàn 05 xin hoá đơn` / `Bàn 05 báo đã chuyển khoản {tổng}`; `stationSound: 'ding'`, không lọc theo `point` của trạm (mọi trạm nghe; QL xử lý); ack như alert thường. Chống spam: cùng key trong 60 s không tạo thêm (`alert()` đã gộp theo key).
- UI: robot (handoff/guide/pay/alert) nút `Gọi nhân viên`; QR footer 2 nút; trạm hiện ở dải cảnh báo (đã có).

### 6.2 Dẫn khách tới bàn (`features.guide`)
- Mission kind `guide`: `create {kind:'guide', to: table, guests?, by}` từ robot (khách chạm "Dẫn tôi tới bàn" → lưới bàn chọn 1 → gửi) hoặc từ trạm (tab Gọi robot tới có thêm chế độ "Dẫn khách"? → **không** ở GĐ2, chỉ từ robot). Stops: `[{p: to, a:'guide'}]`. Robot tới → `atStop` màn "Mời quý khách đi theo tôi" đã hết, hiện "Đã tới Bàn 07" → nút `Đã tới bàn · We're here` = `confirm` → mission done, robot về dock (hoặc nhận việc kế). Khi đang đi: màn guide (tiêu đề, "Bàn 07", thanh tiến độ từ `rem`), nút `Đi chậm hơn`/`Đi bình thường` → `{type:'speed', robot, slow:true|false}` → cmd adapter `{cmd:'speed', robot, factor: .5|1}`; simulator nhân tốc độ, Valetudo bỏ qua (ghi log). `standbySec` không áp dụng cho guide; `handoffSec` áp dụng (quá giờ → tự về, log).
- Điều kiện: robot phải đang **rảnh tại điểm có khách** — tức idle ở dock không hợp lý về vật lý (khách không đứng ở dock). Quyết định: nút "Dẫn tôi tới bàn" chỉ hiện khi robot `atStop` tại `station`/`standby` hoặc đứng ở điểm `kind:'table'`/điểm đón (`site.points` thêm `kind:'entrance'` cho "cửa đón khách" — robot được trạm `summon` tới cửa, chờ `standbySec`). Thêm `entrance` vào `kind` hợp lệ trong `lib/site.js`.

### 6.3 Gọi món trên robot (`features.order`)
- Schema `site.menu = { cats: [{id, vi, en}], items: [{id, cat, vi, en, price}] }` (seed rỗng; demo = 12 món trong bản vẽ). `lib/site.js` kiểm tra: id duy nhất, `price` số ≥ 0, `cat` tồn tại.
- Thông điệp `{type:'order', table, items:[{id, qty}], by}` → `st.orders.push({id, table, items, total, t, status:'new'})`, `alert` cho bếp/bar: `Bàn 05 gọi món: Phở bò ×2, Trà đá ×2` (sound `ding`, `point` = `kitchen` hoặc `bar` theo `cat` của món: `site.menu.cats[].station` chỉ trạm nhận; mặc định `kitchen`). Bếp tạo lệnh giao như thường (không tự tạo mission — bếp cần nấu trước). Order lưu trong `st.orders` 24 h (dọn trong `timers`).
- Robot: màn Thực đơn 2 tab danh mục, lưới 3/2 cột, ảnh placeholder (chưa có ảnh; `item.img` tuỳ chọn sau), nút +/− góc, rail: giỏ "n món · tổng", `Gửi bếp n món` (gửi `order`), `Quay lại`. Bàn của khách = bàn robot đang đứng (`r.at` kind table) hoặc chọn bàn trước khi gửi (lưới bàn như load) nếu robot ở nơi khác.
- Trang QR: liệt kê order của bàn (status mới/đã giao) ngoài missions.

### 6.4 Thanh toán tại robot (`features.pay`)
- `site.payment = { bank, account, name, vietqrTemplate }`; hoá đơn = `st.orders` của bàn trong ca chưa `paid` (hoặc chưa có order → ẩn nút). Màn Pay: thẻ hoá đơn (món, ×n, tiền, tổng), QR: ảnh `https://img.vietqr.io/image/{bank}-{account}-compact2.png?amount={total}&addInfo=Ban05` khi có Internet; không có → vẽ QR tĩnh của tài khoản (ảnh `site.payment.qr` tải lên ở Setup → data URL) + số tiền chữ to. Rail: `Tôi đã chuyển khoản` → `call what:'paid'` (6.1) và đánh dấu orders `status:'paid-claimed'`; `Tiền mặt / thẻ · call staff` → `call what:'staff'`.
- Setup tab mới? → ~~không~~ **có (đã quyết khi review GĐ2)**: tab Vai trò đã kín màn 1280×800 mà không được cuộn trang, nên thêm tab **"Khách hàng"** chứa bật/tắt tính năng, thẻ "Thanh toán" (bank/account/name, ảnh QR tĩnh) và thẻ "Thực đơn" (nhập JSON menu hoặc bảng đơn giản) — bảng đơn giản: dòng = id · tên VI · EN · giá · danh mục; `+ Thêm món`.

### 6.5 Trang QR song ngữ
- `table.html` toggle VI/EN lưu `localStorage`, từ điển `T` như bản vẽ; các chuỗi trạng thái hiện tại chuyển vào từ điển. Không đụng server.

### 6.6 Thu dọn bàn từ màn robot
- Màn load (standby tại trạm) có bước "Việc cần làm": `Giao món` / `Thu dọn bàn`. Thu dọn = chọn 1 bàn → `dispatch {mission, tables:[t], bus:true}` → orchestrator tạo stops `collect → unload` (như `create kind:'bus'`) nối vào mission standby hiện tại. Sửa `dispatch()` trong orchestrator + test.

### 6.7 Ghi chú nhanh cấu hình được
- `site.notes = ['Không hành','Ít cay','Món nóng','Thêm chén']` (seed và demo), sửa trong Setup thẻ Vai trò (danh sách chuỗi, `+`/xoá). UI GĐ1 đọc hằng → GĐ2 đọc `site.notes || mặc định`.

### 6.8 Màn robot "Pin yếu" chủ động
- GĐ1 đã hiện khi `charging`. GĐ2: khi `battery < lowBattery` **và còn việc** (robot sẽ về sạc sau việc), header cam + chip "Pin 18% · về sạc sau việc này" — chỉ UI, dữ liệu đã có (`r.battery`, `timing.lowBattery`). (Thuộc GĐ1 thực ra, ghi ở đây để không quên; đưa vào plan GĐ1.)

### 6.9 Đổi bàn khi robot đang đi (`retarget`)
- Tình huống: bếp xếp món, robot đã rời bếp, bếp nhận ra nhầm bàn. Hiện chỉ có cách huỷ → robot về bếp trả đồ → gửi lại.
- Thông điệp `{type:'retarget', mission, stop, to, by}`: stop phải là `handoff` đang `pending` **hoặc** `active` khi robot còn `toStop` (chưa `atStop`); `to` là bàn chưa có trong các stop mở của chuyến. Orchestrator đổi `s.p = to`, cập nhật `m.label`, nếu stop đang `active` thì `goTo(c, r, to, 'toStop')` để adapter tính lại đường; log `Bếp đổi Bàn 05 → Bàn 07 của #41`; `ev` cho trang QR cả hai bàn (`table` cũ nhận `cancelled` nhẹ không âm, bàn mới nhận state). Không tính vào `kpi.cancelled*`. Robot đã `atStop` tại bàn sai → từ chối ("robot đã tới, dùng Trả lại bếp hoặc Đã nhận món").
- UI trạm: dòng hàng chờ và thẻ "Lệnh gần nhất" có nút `Đổi bàn`; chạm → trạng thái `F.retarget = {mission, stop}`, lưới bàn nổi gợi ý "Chạm bàn mới cho Bàn 05", chạm bàn → gửi `retarget`, thoát chế độ. Chuyến nhiều bàn: chọn bàn cần đổi qua chip stop trong tab Nhiệm vụ (giám sát) hoặc dòng hàng chờ liệt kê từng bàn có nút nhỏ `Đổi`.
- Robot: màn moving cập nhật đích ngay (đã theo `m.stops`), toast "Đổi đích → Bàn 07".
- Không cho feature flag (là sửa lỗi vận hành, luôn bật).

Thứ tự GĐ2: 6.1 → 6.9 → 6.5 → 6.7 → 6.6 → 6.2 → 6.3 → 6.4 (mỗi bước chạy được, commit).

## 7. Thay đổi file

**Giai đoạn 1** (`trial/data/public/` trừ khi ghi khác)

| File | Việc |
|---|---|
| `fonts/*.woff2` (mới, 4 file) | Be Vietnam Pro 400/700/900, JetBrains Mono 500 |
| `brand.css` | token §2, `@font-face`, `.appbar .seg .act .tt .pill .strip .toast .screen .card`, bỏ dark mode, màu sơ đồ |
| `common.js` | `APPBAR()`, `L()`, `TONE`, `tableState()` (chuyển từ station), `toast()` giữa đáy, `strip()` render cảnh báo |
| `robot.html` | viết lại theo §4.1 (giữ toàn bộ `send`) |
| `station.html` | viết lại bố cục §4.2–4.3 (giữ toàn bộ logic `F`, `choose`, `send`, `render*`) |
| `map.html` | appbar, công tắc, `<details>` nguyên tắc |
| `setup.html` | appbar + tab, bố cục 4 tab, stepper, canvas co giãn, "Xoá điểm" ở hàng điểm chọn |
| `vmap.js` | palette; `resize()` theo khung |
| `table.html` | khung điện thoại §4.6 (footer ẩn) |
| `index.html` | hub §4.7 |
| `showcase.html`, `web/demo/index.html` (web-only) | appbar / hub |
| `web/index.html`, `web/serve.html`, `web/demo.html`, `web/contact.html`, `web/site.css` | §4.8 |
| `scripts/export-web.sh` | copy `fonts/` |
| `README` (`web/README.md`) | cập nhật danh sách trang |

**Giai đoạn 2**: `lib/orchestrator.js` (`call`, `order`, `guide`, `speed`, `dispatch bus`), `lib/site.js` (`menu`, `payment`, `notes`, `features`, `kind:'entrance'`), `lib/simulator.js` (`speed`), `lib/valetudo.js` (`speed` no-op + log), `site.json`/`site.demo.json`, `robot.html`, `table.html`, `station.html` (orders trong hàng chờ), `setup.html` (thực đơn, thanh toán, ghi chú), `scripts/test.js`, `docs/valetudo-setup.md`.

## 8. Kịch bản nghiệm thu

**GĐ1** (demo trình duyệt `web/demo/`, Chrome device toolbar 1280×800 rồi 800×1280):
1. Hub → trạm bếp: chọn Giao món, Bếp, Bàn 05 + 07, chip "Không hành", gửi → hàng chờ có lệnh, toast giữa đáy; không có thanh cuộn.
2. Robot R1: màn load (xếp món) → `Đã xếp xong` → moving (đích to, lộ trình 2 bàn + về bếp) → handoff (khay 1 sáng) → `Đã nhận món` → tiếp bàn 07 → `Trả lại bếp` (2 chạm) → return tại bếp → `Đã nhận lại đồ` ở trạm (hàng chờ) hoặc robot.
3. Giám sát: đặt vật cản trước R2 → dải cảnh báo cam + robot vòng đỏ → `Đã dọn lối đi` trên dải. Tab Mô phỏng → `Dừng khẩn cấp` → màn robot đỏ → nhả 2 chạm tại robot.
4. Thiết kế lộ trình: chọn lối, bật `Đóng lối`, Áp dụng → kiểm tra báo "1 lối đang đóng".
5. Cấu hình: Robot tab stepper pin; Điểm tab chọn Bàn 12 → `Xoá điểm` 2 chạm → Lưu → bản tăng.
6. QR Bàn 05: thẻ món, vạch tiến độ, huỷ 2 chạm.
7. `web/`: 4 trang mở được, nav đúng, form gửi như cũ.
8. `npm test` xanh; `npm run web` xuất đủ `fonts/`.

**GĐ2**: thêm (a) QR `Gọi nhân viên` → mọi trạm ding + dải "Bàn 05 gọi nhân viên" → Đã biết; (b) robot tại bàn → `Gọi món` 2 món → bếp nhận cảnh báo kèm món → bếp tạo lệnh giao; (c) robot standby ở cửa → `Dẫn tôi tới bàn` 07 → đi chậm → `Đã tới bàn`; (d) `Thanh toán` tại bàn 05 → hoá đơn 2 món → `Tôi đã chuyển khoản` → QL nhận cảnh báo; (e) QR EN hiển thị đúng; (f) bếp gửi Bàn 05, robot đang đi → `Đổi bàn` → Bàn 07, robot đổi hướng không về bếp; (g) `npm test` có test cho `call/retarget/order/guide/speed/dispatch bus`.

## 9. Câu hỏi còn mở (tôi tạm quyết, có thể bác)

1. **Vai trò ở trạm**: thiết kế đặt segmented vai trò trên appbar (đổi nhanh), hiện nay là hộp thoại một lần/máy. Tôi theo thiết kế, giữ hộp thoại chỉ cho tên máy.
2. ~~Bỏ nút đỏ lớn~~ **Đã quyết 2026-10-29: giữ** dưới dạng thẻ "Lệnh gần nhất của trạm này" trong cột phải khi chưa chọn bàn (§4.2); GĐ2 thêm `Đổi bàn` (§6.9) để không phải gọi robot về bếp khi nhầm bàn.
3. **Website 4 trang tĩnh** thay SPA như bản vẽ.
4. **Font tự host** (~120 KB) thay link Google Fonts.
5. **GĐ2 thứ tự**: gọi nhân viên trước (nền cho các màn), gọi món/thanh toán cuối (cần thực đơn + tài khoản ngân hàng thật).
6. **Ảnh món**: chưa có; placeholder sọc như bản vẽ, trường `img` để sau.
7. Rail robot khi **không có nút nào** (toDock, offline): rail vẫn hiện, chứa hộp tối thông tin trạng thái để bố cục không nhảy.
