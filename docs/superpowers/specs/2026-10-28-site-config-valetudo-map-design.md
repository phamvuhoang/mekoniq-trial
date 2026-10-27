# Cấu hình trên màn hình, bản đồ Valetudo, tự xử lý khi bị chặn

Ngày: 2026-10-28 · Trạng thái: **chờ duyệt** · Phạm vi: `trial/` (Node-RED trên Android/Termux + robot Valetudo)
Nối tiếp: `2026-10-27-valetudo-mqtt-adapter-design.md`.

## 1. Ý định

Buổi chạy thử từ xa (RustDesk → Termux, Android ⇄ robot qua MQTT) đã cho robot thật chạy trọn vòng. Bốn điều làm việc vận hành khó:

1. **Toạ độ điểm** phải lấy trong Valetudo UI rồi gõ tay vào `site.json` bằng `nano` qua RustDesk, `pkill` để nạp lại. Sai một dấu phẩy là Node-RED không lên.
2. **Robot bị chặn** → luôn cần người bấm "Đã dọn lối đi", kể cả khi lối đã thông hoặc robot chỉ dừng tạm vì có người đứng.
3. **Bàn, trạm, sạc, vai trò** chỉ sửa được trong `site.json`; không có khái niệm "dữ liệu mặc định" tách khỏi "dữ liệu nhà hàng này".
4. **Sơ đồ** trên màn trạm là sàn vẽ tay (m) không khớp bản đồ robot (cm); vị trí robot hiện lên nhờ phép căn (fit) từ ≥ 2 điểm, sai vài chục cm và lật gương nếu khai thiếu.

Nguyên nhân gốc chung của 1, 3, 4: **hai hệ toạ độ và hai nguồn cấu hình** (sàn vẽ tay theo m + `site.map` lộ trình, và bản đồ Valetudo theo cm) phải khớp nhau bằng tay. Cách sửa triệt để: **với robot Valetudo, bản đồ của robot là bản đồ duy nhất**; điểm được chấm *trên chính bản đồ đó* trong UI của mình, hoặc "dạy" bằng cách đưa robot tới đứng rồi bấm "lấy vị trí robot". Cấu hình sống trong Node-RED context (persist), `site.json` trong gói chỉ còn là **dữ liệu mặc định**.

Nghiệm thu:
- Quản lý mở `setup.html` trên tablet, thấy bản đồ robot, chấm "Bàn 05" lên bản đồ (hoặc đưa robot tới bàn 05, bấm "Dùng vị trí robot"), bấm Lưu → bếp giao Bàn 05 ngay, không `nano`, không khởi động lại.
- Robot đang chạy gặp người đứng chắn: robot dừng, nói "xin nhường đường", người đi khỏi → robot tự đi tiếp trong ≤ 15 s, không ai bấm gì. Chắn lâu (≥ ~1 phút) → cảnh báo trạm như hiện nay; dọn xong robot tự đi tiếp, nút "Đã dọn lối đi" vẫn còn để đi ngay.
- Màn trạm tab "Giám sát" vẽ bản đồ Valetudo thật (tường, sàn, phòng, dock) với robot, hướng mũi, các điểm đã khai.
- Cài lại gói (`install.sh`) **không** mất cấu hình đã nhập.

## 2. Mục tiêu / không mục tiêu / phản mục tiêu

**Mục tiêu**
- Mọi cấu hình vận hành (điểm, bàn, trạm, vai trò, thời gian, núm chỉnh robot, topic MQTT) sửa được trên trình duyệt, có hiệu lực ngay, lưu bền, có xuất/nhập JSON và "khôi phục mặc định".
- Toạ độ điểm lấy trực tiếp trên bản đồ Valetudo trong UI của mình, hoặc từ vị trí robot hiện tại.
- Adapter tự thử lại khi bị chặn, leo thang cảnh báo theo thời gian, tự đi tiếp khi lối thông.
- Bản đồ Valetudo hiển thị trên trạm với vị trí robot thật.

**Không mục tiêu** (giữ nguyên như spec trước)
- Nhiều robot thật, tránh nhau, vẽ đường đi dự kiến, sửa bản đồ/phòng của Valetudo từ UI mình, zoom/pinch bản đồ (chỉ "vừa khung" + nút phóng 2×).
- Thay thế simulator: robot không có `driver` vẫn chạy simulator trên sàn vẽ tay như cũ (cho demo không có robot).

**Phản mục tiêu** (thành công kỹ thuật nhưng vẫn hỏng)
- Robot "tự đi tiếp" khi nhân viên đang xử lý tại robot (đã dừng khẩn / tạm dừng). → Tự thử lại **chỉ** khi không `paused`, không e-stop.
- Lưu cấu hình hỏng làm Node-RED không lên. → Cấu hình đi qua `lib/site.js` kiểm tra; không bao giờ ghi file `site.json`.
- Xoá bàn đang có lệnh. → Từ chối xoá điểm đang nằm trong lệnh mở.

## 3. Sự thật về Valetudo đã kiểm tra (bổ sung spec trước)

Nguồn: mã nguồn Valetudo (`ValetudoMap.js`, `MapLayer.js`, `MapNodeMqttHandle.js`).

- `MapData/map-data` = `zlib.deflate(JSON.stringify(map))`, QoS 0, **retain** (mặc định của `PropertyMqttHandle`; kiểm tra lại trên broker thật: `mosquitto_sub -p 1884 -t 'valetudo/+/MapData/map-data' -C 1 | wc -c`), publish mỗi lần robot cập nhật bản đồ (di chuyển: vài giây một lần; đứng yên: thưa). Nhờ retain, Node-RED khởi động lại là có bản đồ ngay. Adapter hiện đã inflate để lấy `robot_position`.
- `map`: `{ size:{x,y} (cm), pixelSize (cm, thường 5), layers:[…], entities:[…], metaData:{version:2, nonce, totalLayerArea} }`. Mọi toạ độ là **số nguyên cm, gốc góc trên-trái, y xuống** — cùng hệ với `go/set`. Chấm điểm trên bản đồ này = toạ độ gửi robot, **không cần phép căn**.
- `layers[]`: `type: floor | wall | segment`, `compressedPixels: [xStart, y, count, …]` (đơn vị **pixel**, nhân `pixelSize` ra cm), `dimensions.{x,y}.{min,max}`, `metaData.{segmentId, name, area}`.
- `entities[]`: `robot_position` (`points:[x,y]`, `metaData.angle` độ), `charger_location`, `go_to_target`, `path`, `predicted_path`, `virtual_wall`, `no_go_area`, `active_zone`.
- `nonce` đổi theo từng bản đồ sinh ra, **không** dùng được để phát hiện "robot đã vẽ lại bản đồ". Dấu hiệu vẽ lại: `size` hoặc vị trí `charger_location` đổi. `charger_location` **chỉ có sau khi robot đã về dock một lần** trên bản đồ hiện tại → `mapRef` phải chấp nhận thiếu charger (chỉ so `size`).

## 4. Kiến trúc

```
                 ┌─ setup.html (quản lý: điểm, bàn, trạm, vai trò, thời gian, robot)
tablet ──ws──▶ [Orchestrator] ── site (global ctx, persist) ──▶ [Adapter Valetudo] ⇄ mqtt ⇄ robot
   ▲              │  cmds                                          │ map (memory ctx)
   │ state/event  ▼                                                ▼
   └──────── [Simulator] (robot không driver)         GET /api/map/:robot ◀── station.html / setup.html (canvas)
```

- **`site` sống trong global context** (`localfilesystem`, đã có): `global.get('site') || seed` ở cả 3 function node; `seed = require('./site.json')` chỉ dùng lần đầu / khi "khôi phục mặc định". Context không nằm trong gói cài → cài lại giữ cấu hình. `install.sh` bỏ phần backup `site.json`.
- **`lib/site.js`** (thuần, có test): `normalize(input, seed) -> {site, errors[]}`; `canDelete(site, orchState, pointId)`; `diff` không cần.
- **Bản đồ Valetudo**: `valetudo.handle()` trả bản đồ rút gọn **bên cạnh** state (`{events, mqtt, maps:{R1: …}}`), **không** để trong `st` (vì `st` được `flow.set` xuống đĩa 5 s một lần). Function node ghi vào **memory context** (`contextStorage.memory`, thêm vào `settings.js`). `http in GET /api/map/:robot` → function trả JSON rút gọn: `{size, pixelSize, layers:[{type, segmentId, name, px:[…compressedPixels]}], charger:{x,y}, robot:{x,y,angle}, t}`. UI poll 10 s, vẽ lại chỉ khi `size`/`layers` đổi (so sánh `t`).
- **Vị trí robot theo cm tới UI ở nhịp 0.5 s**: telemetry thêm trường `pos:{x,y,angle}` (cm, bản đồ robot; `null` với simulator); orchestrator `telemetry()` chép `t.pos` vào `r.pos`, `snapshot()` đưa ra `robots[].pos`. Đây là **mở rộng hợp đồng adapter** (thêm trường, không đổi trường cũ) và là một sửa nhỏ trong `orchestrator.js`. `x,y` m vẫn gửi như cũ cho sàn vẽ tay/simulator.
- **`public/vmap.js`**: vẽ canvas chung cho station (xem) và setup (chấm điểm). Vào: `{map, points (cm), robots:[{id,x,y,angle,tone}], sel}`; ra: sự kiện `tap(x,y cm)`. Toạ độ sàn m **không còn xuất hiện** ở màn Valetudo.

## 5. Mô hình cấu hình (`site`)

Giữ nguyên schema hiện tại, thêm ít nhất có thể:

```jsonc
{
  "name": "…", "floor": {…}, "trays": 4, "dishPoint": "dish", "timing": {…}, "sim": {…},
  "roles": [ { "id": "bep", "name": "Bếp", "home": "kitchen", "tab": "deliver" }, … ],
  "robots": [ { "id": "R1", "dock": "D1", "driver": "valetudo",
                "valetudo": { "topic": "valetudo/Bot", "arriveCm": 40, "nomoveSec": 10, "tripSec": 180,
                              "retrySec": 15, "retryMax": 4, "stuckSec": 20, "acceptCm": 80 } } ],
  "points": { "T05": { "name": "Bàn 05", "kind": "table", "x": 11.5, "y": 8 }, … },   // x,y m: chỉ simulator / sàn vẽ tay
  "valetudo": {
    "points": { "T05": { "x": 1400, "y": 1680 }, … },                                 // cm, trên bản đồ robot
    "mapRef": { "size": { "x": 2500, "y": 2000 }, "charger": { "x": 120, "y": 340 } } // chụp lúc lưu điểm → phát hiện vẽ lại bản đồ
  },
  "map": { "nodes": …, "edges": … }   // lộ trình sàn vẽ tay: chỉ simulator
}
```

Quy tắc trong `lib/site.js`:
- `id` điểm: `^[A-Za-z][A-Za-z0-9_-]{0,15}$`, duy nhất; `kind ∈ table|station|dish|dock`; đúng một `dish` = `dishPoint`; mỗi robot `dock` phải là `kind:dock`.
- Thêm bàn mới: UI đề xuất id `Tnn` kế tiếp, tên "Bàn nn". Thêm điểm **chưa có toạ độ** được phép (hiện "chưa định vị" trên UI; orchestrator sẽ báo `noroute` như hiện nay nếu giao tới).
- Điểm thêm mới **không có node trong `site.map`** (và `x,y` m mặc định `0,0`). Quy tắc chung: *điểm không có node là điểm chỉ robot Valetudo tới được*:
  - `orchestrator.gotoCmd`/`assign` dùng `site.points[id]` làm dự phòng (hiện `c.st.map.nodes[r.target]` sẽ `TypeError`); `sync()` chịu được dock thiếu `x,y`.
  - `route.clean()` và `route.unreachable()` **bỏ qua** điểm không có node (hiện `clean` trả `null` → `map.html` không lưu được nữa sau khi thêm 1 bàn); `simulator.init` bỏ robot có dock không có node.
  - Simulator nhận `goto` tới điểm không có node → `stuck/noroute` như hiện nay (đúng: robot giả không có đường).
- `valetudo.points[id]`: số nguyên ≥ 0 ≤ `mapRef.size` nếu có.
- Xoá điểm/robot đang nằm trong `missions` mở hoặc `robots[].mission` → lỗi "đang có lệnh".
- Trường không biết → giữ nguyên (không mất dữ liệu khi UI cũ gặp site mới).

Thông điệp WS mới (orchestrator `fromUI`):
- `{type:'siteSave', site, by}` → normalize; lỗi → `{type:'event', text:'Không lưu: …'}` cho session đó; ok → `global.set('site')`, log "QL cập nhật cấu hình", gửi `{type:'site'}` cho **mọi** client (hiện chỉ gửi khi `hello`), orchestrator `sync()` thêm robot mới, xoá robot đã bỏ khi không có lệnh.
- `{type:'siteReset'}` → về `seed`, cùng quy tắc "đang có lệnh".
- Xuất/nhập: UI tải `JSON.stringify(App.site)` thành file; nhập = đọc file → `siteSave`. Không cần endpoint.
- Function node lấy `site` mỗi lần chạy từ global. `valetudo.js` đã có `robotsKey` để dựng lại khi robot/topic/núm đổi, **nhưng** `init()` hiện xoá `online/status/battery/pos` và broker không gửi lại retain cho subscription đang có → sau khi lưu một núm, R1 hiện "mất kết nối" tới khi robot publish tiếp. Sửa: dựng lại giữ nguyên các trường đã ingest khi `topic` không đổi. `calib()` dùng `WeakMap` theo object `site` → object mới là tính lại.
- `contextStorage.default.flushInterval` hạ xuống `1`; UI chỉ hiện "Đã lưu" khi nhận lại `{type:'site'}` từ server (round-trip), để `pkill node-red` ngay sau khi lưu không mất cấu hình.

## 6. `setup.html` — màn Cấu hình (vai trò Quản lý ca)

Một trang, 4 thẻ (tab):

1. **Điểm & bản đồ** (chính). Trái: canvas bản đồ Valetudo (robot R1; chọn robot nếu nhiều). Phải: danh sách điểm theo nhóm (Trạm · Rửa chén · Sạc · Bàn), mỗi dòng: tên, id, trạng thái "● đã định vị / ○ chưa". Chọn một điểm → chấm lên bản đồ để đặt; nút **"Dùng vị trí robot"** (lấy `robot_position` hiện tại — cách chính xác nhất: lái robot tới bằng app Valetudo hoặc bê robot tới chỗ cần dừng); 4 nút ±10 cm; "Thử: cho robot tới đây" (gửi `goto` thử qua lệnh summon có sẵn? — **không**: dùng cmd thẳng `{type:'test', robot, to}` → orchestrator tạo summon rồi release? Quá vòng. Quyết định: nút thử publish `go/set` qua adapter bằng cmd mới `{cmd:'probe', robot, x, y}` chỉ khi robot `idle` không có lệnh; không vào state machine). Thêm bàn / thêm trạm / xoá. Dock: hiện `charger_location` của robot, không cần chấm.
   Bản đồ: sàn xám nhạt, tường đậm, phòng tô nhạt khác màu + tên phòng, dock ⚡, robot chấm + mũi hướng, điểm = viên thuốc có nhãn; điểm đang chọn nổi bật. Cảnh báo vàng trên bản đồ khi `mapRef` lệch với bản đồ hiện tại: "Bản đồ robot có thể đã vẽ lại — kiểm tra lại các điểm".
2. **Robot**: id, dock, driver (simulator / Valetudo), topic MQTT, các núm với mô tả một dòng (lấy từ `valetudo-setup.md`), pin thấp/đủ.
3. **Vai trò & thời gian**: roles (tên, điểm nhà, tab mặc định), `timing.*`, `trays`.
4. **Sao lưu**: Tải xuống JSON · Nhập JSON · Khôi phục mặc định (2 chạm) · hiện "đang chạy từ: mặc định / đã chỉnh lúc …".

Nút **Lưu** chung, sticky, disabled khi chưa đổi; lưu thất bại hiện lý do cạnh dòng lỗi. Trang dùng `common.js`/`transport.js` như các trang khác; `index.html` thêm ô "Cấu hình". Link "✏️ Thiết kế lộ trình" (`map.html`) chỉ hiện khi có robot simulator.

## 7. Màn trạm & màn robot

- `station.html` tab "Giám sát & sơ đồ": nếu site có robot Valetudo **và** đã nhận bản đồ → vẽ `vmap` (xem, chạm bàn vẫn chọn bàn cho form); không thì sàn vẽ tay như cũ. Chế độ "đặt vật cản" (demo simulator) ẩn ở bản đồ Valetudo.
- Trạng thái mới `nav:'wait'` từ adapter Valetudo hiện "Gặp vật cản · đang chờ" (chuỗi đã có trong `robotStatus`), vòng đỏ nhấp nháy đã có.
- `robot.html` khi `nav:'wait'`: màn "Xin nhường đường" + âm `excuse` (orchestrator `navChanged` đã phát). Chữ phụ hiện nay là "chờ … giây rồi tìm đường vòng" (simulator) → với robot Valetudo đổi thành "thử đi tiếp sau N giây" (UI biết theo `site.robots[].driver`). Không đổi gì ở màn `blocked`.

## 8. Tự xử lý khi bị chặn (`lib/valetudo.js`)

Núm mới mỗi robot: `retrySec` 15, `retryMax` 4, `stuckSec` 20, `progressCm` 15, `acceptCm` 80 (0 = tắt).

Trạng thái chuyến đi thêm: `tries` (số lần gửi lại), `retryAt`, `lastPos`, `lastProgressAt`.

Robot thật khi bị chắn có thể báo theo **một trong ba kiểu** (chưa quan sát được kiểu nào ở buổi 27/10 → §12 câu 1); state machine phải xử lý cả ba:

| Tình huống | Hành vi mới |
|---|---|
| (A) Robot `moving` nhưng vị trí không đổi > `progressCm` trong `stuckSec` (robot đứng tìm đường tại chỗ) | Coi là **kẹt mềm**: publish `STOP`, vào `wait`. (Thay cho chờ `tripSec` 3 phút.) |
| (C) Valetudo báo `error` với `error_description` kiểu "không tới được đích / target unreachable / navigation failed" (danh sách mẫu `retryErr` trong site, mặc định `/unreach|target|navigat|path/i`) | Coi như **kẹt mềm** → `wait` + thử lại, **không** `blocked` ngay. Lỗi khác (kẹt bánh, nhấc lên, hộp rác…) → `blocked` như dòng "Lỗi Valetudo" bên dưới. |
| (B) Chuyến kết thúc (idle) xa đích, không lỗi Valetudo | `wait` thay vì `blocked`: telemetry `nav:'wait', why:'object', blocked:false` → trạm log "gặp vật cản, dừng chờ", robot nói "xin nhường đường". |
| Đang `wait`, tới `retryAt` | gửi lại `go/set` (hoặc `HOME`), `tries++`, `retryAt = now + retrySec`. Robot đi được → `moving` → về luồng bình thường, `tries = 0`. |
| `tries ≥ retryMax` | **`blocked`** (`why:'object'`): cảnh báo trạm như hiện nay. Vẫn **tiếp tục thử lại** mỗi `retrySec × 4` (60 s) để tự đi khi lối thông mà không ai bấm. |
| Lỗi Valetudo (`error_description`, status `error`) | `blocked` ngay (như cũ: kẹt bánh, nhấc lên… cần người). **Lỗi hết → tự gửi lại lệnh** (hiện nay chỉ hết cảnh báo, không chạy tiếp). |
| Nhân viên "Đã dọn lối đi" (`sim/clear`) | gửi lại ngay, `tries = 0` (như cũ). |
| `paused` / e-stop | không thử lại; `resume` mới chạy. |
| Dừng cách đích ≤ `acceptCm` sau khi `tries ≥ retryMax` | coi là **đã tới** (ghế kéo ra chắn đúng chỗ dừng; robot cách bàn < 1 m vẫn phục vụ được), log "dừng gần". `acceptCm: 0` tắt. **Quyết định của tôi — cần duyệt**, xem §12. |
| `tripSec` | giữ làm lưới cuối (mặc định 180 s), ít khi còn tới. |

Telemetry giữ hợp đồng cũ; chỉ dùng thêm `nav:'wait'` mà orchestrator đã hiểu (simulator đang dùng). **Không sửa orchestrator cho phần này.**

`scripts/fake-valetudo.js` thêm kịch bản: `go/set` tới toạ độ có `x` lẻ → "bị chặn" (moving 2 s rồi idle giữa đường); gửi lại lần 2 → tới. Dùng cho smoke test tay.

## 9. Thay đổi file

| File | Việc |
|---|---|
| `data/lib/site.js` | mới: `normalize`, `canDelete`, id/kind rules (~80 dòng) |
| `data/lib/orchestrator.js` | `siteSave`/`siteReset` trong `fromUI`; `gotoCmd`/`assign`/`sync` dự phòng khi thiếu node hoặc `x,y`; `sync()` bỏ robot không còn trong site (không có lệnh); telemetry/snapshot chép `pos` (cm) |
| `data/lib/route.js`, `data/lib/simulator.js` | `clean`/`unreachable`/`init` bỏ qua điểm không có node |
| `data/lib/valetudo.js` | §8; trả bản đồ rút gọn trong kết quả `handle()` (`maps`), không trong `st`; telemetry thêm `pos` cm; dựng lại giữ trường đã ingest; cmd `probe` |
| `data/flows.json` | 3 function node đọc `global.get('site') || seed`; node Valetudo ghi `global.set('vmap:'+id, map, 'memory')`; `http in` + function + `http response` cho `/api/map/:robot` |
| `data/settings.js` | `contextStorage.memory`, `flushInterval: 1`; `mekoniq.seed` thay `site`; `mekoniq.siteLib` |
| `data/public/vmap.js` | mới: vẽ canvas + hit-test (~150 dòng) |
| `data/public/setup.html` | mới (§6) |
| `data/public/station.html` | tab giám sát dùng `vmap` khi có; ẩn công cụ vật cản |
| `data/public/robot.html` | chữ màn `wait` theo driver |
| `data/public/index.html` | ô "Cấu hình"; ẩn "Thiết kế lộ trình" khi không có simulator |
| `data/public/common.js` | `connect()` nhận `{type:'site'}` giữa phiên → gọi lại render (hiện chỉ gán); hàm `hasValetudo()` |
| `termux/install.sh` | bỏ backup/ghi đè `site.json`; in link `setup.html` |
| `scripts/test.js`, `scripts/test-valetudo.js` | test `site.js`; test §8: wait→retry→blocked→tự thông; stuck watchdog; error clear → resend; acceptCm; probe chỉ khi idle |
| `scripts/fake-valetudo.js` | kịch bản chặn; publish layers tối thiểu (1 phòng, tường viền, charger) để UI vẽ được khi dev |
| `docs/valetudo-setup.md` | viết lại bước 2–3: làm trên `setup.html`; giữ phần MQTT, kiểm tra theo bậc; thêm checklist đầu ca (§10) |

## 10. Thực hành tốt cho robot giao đồ ăn (áp dụng được với Valetudo)

Đưa vào tài liệu vận hành và một phần vào sản phẩm:

**Điểm dừng (trong sản phẩm, §6)**
- Dạy điểm bằng **vị trí robot thật** ("Dùng vị trí robot") thay vì chấm ước lượng: đúng chỗ robot đứng được, tránh chân bàn/ghế.
- Điểm dừng nằm **trên lối đi, cạnh bàn**, cách mép bàn ~30–50 cm, phía khách dễ lấy; không chấm vào giữa bàn.
- Mỗi trạm (bếp, bar) nên có điểm dừng **không chắn lối người**; nếu bếp có cửa, điểm dừng ngoài cửa.
- Sau mỗi lần robot **vẽ lại bản đồ** phải dạy lại điểm → khoá bản đồ (persistent map) trong Valetudo; UI cảnh báo khi phát hiện (`mapRef`).

**Trong Valetudo (tài liệu)**
- Vẽ **no-go area / virtual wall** quanh khu bếp nóng, cầu thang, chỗ để thùng. Robot tự né, không cần code.
- Đặt tên **phòng (segment)** = khu vực nhà hàng; hiện lên bản đồ trạm.
- Tắt mọi lịch dọn tự động; tháo khăn lau; robot hút bụi chở đồ ăn chỉ dùng `goto`/`HOME` (không chạy chổi).
- IP tĩnh cho robot và điện thoại; broker có mật khẩu (đã có).

**Vận hành (tài liệu + checklist đầu ca trong `setup.html` thẻ Robot)**
- Đầu ca: robot online, pin ≥ 80 %, bản đồ không đổi, chạy thử 1 chuyến tới bếp và về dock.
- Luôn một người bấm nút dừng vật lý được. Phần mềm không phải hệ an toàn (giữ dòng cảnh báo hiện có).
- Món lỏng: lót chống trượt, không đầy quá 80 %; robot hút bụi tăng/giảm tốc gắt — nếu đổ nhiều, đây là giới hạn phần cứng, không chỉnh được từ phần mềm.
- Giờ cao điểm: 1 robot tại bếp một lúc (orchestrator đã xếp hàng), ưu tiên "GẤP" cho món nóng.
- Bị chặn: robot tự xin đường và thử lại (§8); nhân viên chỉ can thiệp khi có cảnh báo trạm; ghi KPI `interventions` (đã có) để xem lối nào hay kẹt → dời bàn/điểm.
- Sao lưu cấu hình JSON sau mỗi lần đổi sơ đồ bàn.

**Chưa làm, nêu để biết**: cảm biến khay (robot báo đã lấy đồ), nhận diện bàn bằng QR, nhiều robot, thống kê lối kẹt theo vị trí.

## 11. Thứ tự làm (4 bước, mỗi bước chạy được và commit)

1. **Cấu hình sống**: `lib/site.js` + test; global context + `siteSave/siteReset`; `setup.html` thẻ Robot / Vai trò / Sao lưu và danh sách điểm (tên, kind, thêm/xoá, nhập toạ độ cm bằng số); `install.sh`; orchestrator dự phòng điểm không có node. → Hết `nano`.
2. **Bản đồ Valetudo**: adapter giữ map; `/api/map/:robot`; `vmap.js`; chấm điểm + "Dùng vị trí robot" + ±10 cm + probe; `mapRef`; station tab giám sát. → Hết căn toạ độ.
3. **Tự xử lý chặn**: §8 trong `valetudo.js` + test + fake robot kịch bản chặn.
4. **Tài liệu**: `valetudo-setup.md` viết lại, checklist đầu ca.

Kiểm chứng cuối: `npm test` xanh; `mosquitto -p 1884 & node scripts/fake-valetudo.js` → mở `setup.html` chấm 2 điểm, lưu, `station.html` giao 1 bàn tới điểm "chặn", robot tự thử lại và tới; `pkill node-red` → cấu hình còn.

## 12. Quyết định đã lấy (của tôi) và câu hỏi còn lại

**Tôi quyết, có thể bác**
- Cấu hình lưu trong Node-RED global context, không ghi `site.json`. Xuất JSON là cách sao lưu.
- Với robot Valetudo, toạ độ m và `site.map` không dùng nữa; vẫn giữ cho simulator, không xoá code.
- `acceptCm` = 80 mặc định bật.
- Trạng thái chờ → cảnh báo sau `retryMax × retrySec` ≈ 60 s; sau đó vẫn tự thử mỗi 60 s.
- Bản đồ gửi UI qua HTTP poll 10 s thay vì WS push (đơn giản, bản đồ ít đổi).
- Không khoá `setup.html` bằng mật khẩu (LAN nội bộ, như các trang khác). Cần thì thêm PIN ở bước sau.

**Cần anh trả lời** (đổi câu trả lời là đổi việc làm)
1. **Robot thật báo gì khi bị người/ghế chắn?** Buổi 27/10 có thấy status `idle` giữa đường, hay vẫn `moving` đứng yên, hay `error` + dòng lỗi gì (chụp Valetudo → Robot → error)? Model robot là gì? §8 đã che cả ba kiểu, nhưng ngưỡng mặc định (`stuckSec`, mẫu `retryErr`) chỉ chỉnh đúng khi biết kiểu thật.
2. **Dữ liệu mặc định là gì?** `site.json` hiện là demo 12 bàn + 3 sạc. "Khôi phục mặc định" ở nhà hàng thật sẽ đổ lại 12 bàn demo. Đề xuất của tôi: gói cài cho đối tác dùng seed **gần trống** (vai trò, thời gian, 1 robot R1 Valetudo, bếp + rửa chén + 1 dock, 0 bàn); demo 12 bàn + simulator giữ cho bản web/demo bán hàng (`scripts/export-web.sh`). Đồng ý?
3. `acceptCm` 80 cm: chấp nhận robot "đã tới" khi dừng cách bàn < 80 cm vì chỗ dừng bị chắn, hay bắt buộc đúng điểm (0)?
4. Simulator R2/R3 và sàn vẽ tay còn cần cho demo bán hàng không? Nếu không, bước sau có thể bỏ `map.html` và toạ độ m hẳn (và câu 2 đơn giản hơn).
5. Ai được vào `setup.html`: mọi người có link, hay cần PIN quản lý?
