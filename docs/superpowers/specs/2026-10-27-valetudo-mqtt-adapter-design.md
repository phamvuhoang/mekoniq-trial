# Valetudo MQTT Adapter — điều khiển robot thật qua MQTT

> Cập nhật 2026-10-28: toạ độ điểm chuyển sang `robots[].valetudo.points` (dạy trên `setup.html`), bị chặn tự thử lại — xem `2026-10-28-site-config-valetudo-map-design.md`.

Ngày: 2026-10-27 · Trạng thái: **đã triển khai** · Phạm vi: `trial/` (Node-RED trên Android/Termux)

## 1. Ý định

Demo hiện tại (orchestrator + simulator) đã chạy trọn vòng: tạo lệnh → robot tới trạm → giao bàn → về sạc, kèm huỷ/timeout/e-stop.
Bước tiếp theo: thay simulator bằng **adapter nói chuyện với robot hút bụi chạy Valetudo** (máy ở xa của đối tác, Valetudo UI tại `192.168.0.105`) để robot **di chuyển thật** tới các điểm (bếp, bàn, sạc) theo lệnh từ màn hình trạm.

Mục tiêu nghiệm thu: từ tablet bếp bấm "Giao bàn 01" → robot thật chạy tới điểm đã khai báo cho "Bếp", chờ xác nhận, chạy tới "Bàn 01", chờ xác nhận, tự về dock. Huỷ/pause/e-stop làm robot dừng.

## 2. Nguyên tắc & giới hạn

- **Không sửa `lib/orchestrator.js`.** Hợp đồng adapter (`cmd: goto|stop|resume|map`, `event: telemetry|arrived|reroute`) giữ nguyên. Toàn bộ việc mới nằm trong adapter.
- **Không phải hệ an toàn.** Tránh vật cản / dừng khẩn cấp vật lý là việc của robot + Valetudo. Orchestrator chỉ nhận trạng thái.
- Robot hút bụi Valetudo **tự tìm đường** trên bản đồ của nó. Mạng lộ trình (`site.map`) của orchestrator **chỉ còn dùng để vẽ UI và ước lượng khoảng cách khi phân việc**; không gửi xuống robot nữa (`cmd:'map'` adapter bỏ qua).
- Giai đoạn này: **1 robot thật** (R1). R2/R3 nếu muốn giữ cho demo thì vẫn chạy simulator (xem §5 driver).
- Non-goals: nhiều robot thật, tránh nhau giữa robot, reroute/obstacle thật, vẽ đường đi dự kiến (`path`), đo pin chính xác khi sạc. Những thứ này simulator có nhưng Valetudo không cung cấp đủ → adapter trả `path: []`, `nav: 'idle'|'moving'`.

## 3. Sự thật về Valetudo (đã kiểm tra docs + ảnh đối tác)

Topic gốc: `<prefix>/<identifier>/…` (xem Connectivity → MQTT trong Valetudo UI; mặc định prefix `valetudo`, identifier là tên ngẫu nhiên kiểu `InsecureYellowishGoldfish`).

| Việc | Topic | Payload |
|---|---|---|
| Đi tới toạ độ | `…/GoToLocationCapability/go/set` | `{"coordinates":{"x":2351,"y":2544}}` (JSON y như REST; UI → giữ nút "Go to location" để copy, ảnh bước 5) |
| Về dock / dừng / tạm dừng | `…/BasicControlCapability/operation/set` | `HOME` / `STOP` / `PAUSE` / `START` |
| Trạng thái | `…/StatusStateAttribute/status` | `docked, idle, moving, returning, cleaning, paused, error, manual_control` |
| Cờ trạng thái | `…/StatusStateAttribute/flag` | `none, target, zone, segment, spot, resumable, mapping` (`target` = đang goto) |
| Lỗi | `…/StatusStateAttribute/error_description` | chuỗi, "No error" khi bình thường |
| Pin | `…/BatteryStateAttribute/level`, `…/status` | `%`, `charging/discharging/charged/none` |
| Online | `…/$state` | `ready` / `lost` (LWT) |
| Vị trí robot | `…/MapData/map-data` | JSON **đã deflate (zlib)**; trong `entities[]` có `type:"robot_position"`, `points:[x,y]`, `metaData.angle`. Cần bật *Provide map data* trong MQTT settings của Valetudo. |

Toạ độ Valetudo: **cm**, gốc góc trên-trái bản đồ, y hướng xuống. Toạ độ này **vô hiệu nếu robot tạo lại bản đồ** (cảnh báo trong ảnh 5) → phải khai báo lại điểm.

Valetudo **không có broker MQTT**; cần một broker trên mạng LAN của robot.

## 4. Kiến trúc

```
tablet ──ws──▶ [Mission Orchestrator] ──cmd──▶ [switch: driver theo robot]
                      ▲                              │              │
                      │ event                   driver=sim      driver=valetudo
                      │                              │              │
                      └──────── [Simulator] ◀────────┘      [Valetudo Adapter] ⇄ mqtt in/out ⇄ Mosquitto ⇄ robot
```

- **Mosquitto** cài trong Termux ngay trên điện thoại Android đang chạy Node-RED (`pkg install mosquitto`), tự khởi động cùng Node-RED trong script boot. Valetudo trỏ về `IP-điện-thoại:1883`, không user/pass (LAN nội bộ; đây là quyết định của tôi, đổi sang user/pass nếu đối tác yêu cầu).
- **Node-RED**: thêm config node `mqtt-broker` (127.0.0.1:1883), một `mqtt in` subscribe `<prefix>/<ident>/#` cho từng robot thật, một `mqtt out`, một function node "Robot Adapter (Valetudo)" gọi `lib/valetudo.js` (logic thuần, test được như simulator). `settings.js` thêm `zlib: require('zlib')` vào `functionGlobalContext.mekoniq` để inflate map-data.

## 5. Cấu hình `site.json`

```jsonc
"robots": [
  { "id": "R1", "dock": "D1", "driver": "valetudo",
    "valetudo": { "topic": "valetudo/InsecureYellowishGoldfish", "arriveCm": 40 } },
  { "id": "R2", "dock": "D2" }            // không có driver → simulator như cũ
],
"valetudo": {                              // toạ độ cm lấy từ bước 5 trong ảnh, cho từng điểm orchestrator có thể gửi tới
  "points": { "kitchen": {"x":2351,"y":2544}, "T01": {"x":..,"y":..}, "D1": {"x":..,"y":..} }
}
```

- Điểm `goto` là **node id** orchestrator gửi (`cmd.to`), tức là `kitchen`, `bar`, `dish`, `Txx`, `Dx`. Điểm nào chưa khai báo → adapter báo `blocked, why:'noroute'` để orchestrator hiện cảnh báo "không có lộ trình" sẵn có, thay vì im lặng.
- Dock (`to === r.dock`) → gửi `HOME` thay vì goto; coi là đã tới khi status = `docked`. Không cần toạ độ dock nếu robot tự về sạc được.
- **Đổi toạ độ robot → toạ độ sàn (m) để vẽ UI**: adapter tính phép biến đổi đồng dạng (scale + xoay + tịnh tiến) bằng bình phương tối thiểu từ các cặp (điểm `site.points[id]` theo m, `valetudo.points[id]` theo cm). Cần ≥ 2 điểm đã khai báo. Đây là cách đơn giản nhất không bắt người cấu hình đo đạc thêm; sai số vài chục cm chấp nhận được vì chỉ để hiển thị.

## 6. Hành vi adapter (`lib/valetudo.js`)

`handle(state, site, input, now) -> events[]`, input là `cmd` của orchestrator, `{cmd:'tick'}` mỗi 0.5 s, hoặc `{cmd:'mqtt', robot, topic, payload}`.

| Input | Hành động |
|---|---|
| `goto` tới điểm thường | lưu `goal={to, x, y, token}`; nếu robot đang `moving`/`returning` → publish `STOP` trước, chờ status về `idle` (tối đa 3 s) rồi mới publish `go/set` `{coordinates}`; nếu đang đứng yên → gửi ngay. `nav='moving'` |
| `goto` tới dock | như trên nhưng lệnh cuối là `HOME`; `goal.home=true` |
| `goto` điểm chưa khai | telemetry `blocked:true, why:'noroute'` cho tới khi có lệnh khác |
| `stop` | publish `STOP`; giữ `goal` nhưng `paused=true` |
| `resume` | gửi lại lệnh của `goal` (goto/HOME); `paused=false`. (Không dùng `START` vì không chắc START nối lại goto trên mọi model.) |
| `map`, `obstacle`, `sim`, `reset` | bỏ qua (`reset`: xoá goal, không ra lệnh robot) |
| mqtt `status` | cập nhật; chuyển tiếp **`moving`/`returning` → `idle`/`docked`** khi đang có `goal` = kết thúc hành trình (xem bên dưới) |
| mqtt `error_description` ≠ "No error" | telemetry `blocked:true, why:'object'` (orchestrator báo "bị chặn, cần nhân viên"); hết lỗi → `blocked:false` |
| mqtt `BatteryStateAttribute/level` | pin |
| mqtt `$state` = `lost` | ngừng đưa robot vào telemetry → orchestrator tự báo mất kết nối sau 3 s |
| mqtt `map-data` | inflate, lấy `robot_position` → `x,y` (cm) → đổi sang m |
| `tick` | emit `{event:'telemetry', robots:[…]}` từ giá trị cache (robot chỉ publish khi thay đổi, còn orchestrator cần nhịp đều) |

**Kết thúc hành trình** (`goal` tồn tại, status rời `moving`/`returning`):
- `home` và status `docked` → `arrived`.
- Có vị trí và khoảng cách tới `goal` ≤ `arriveCm` (mặc định 40) → `arrived` (token của goal).
- Không có vị trí (chưa bật map data) → tin status, `arrived`. Ghi chú là chế độ kém tin cậy.
- Ngược lại (dừng giữa đường, hoặc `error`) → `blocked:true, why:'object'`; khi nhân viên bấm "chạy tiếp" (`resume`) adapter gửi lại goto. `clear` của UI gửi `cmd:'sim'` → bỏ qua; nút này trên UI đã ghi "chỉ có trong simulator".
- Chống nhiễu: bỏ qua status đến trong 1.5 s sau khi gửi lệnh (robot có thể còn báo `idle` cũ).
- **Đổi hướng giữa đường** (huỷ → quay về bếp, nhận việc mới khi đang về dock, xong việc → HOME): orchestrator làm việc này thường xuyên. Không chắc mọi model Valetudo nhận `go/set` khi đang chạy (từ chối chỉ hiện trong log Valetudo, MQTT im lặng → adapter tưởng đã đổi mục tiêu, cuối cùng báo `blocked` sai). Vì vậy adapter **luôn STOP rồi chờ idle rồi gửi lại** (quyết định của tôi; tốn ~2 s mỗi lần đổi hướng, đổi lại không phụ thuộc model). Goal mới nhất thắng: lệnh goto đến trong lúc đang chờ idle chỉ thay `goal`, không gửi thêm STOP.

Telemetry mỗi robot: `{id, x, y, battery, moving, blocked, nav:'idle'|'moving', why, path:[], rem:0}`. `rem=0` và `path=[]` là giới hạn đã nêu ở §2.

## 7. Thay đổi file

| File | Việc |
|---|---|
| `data/lib/valetudo.js` | mới, logic thuần (~120 dòng), có `init/handle` cùng kiểu simulator |
| `scripts/test.js` | thêm test cho valetudo.js: goto → publish đúng topic/payload; status moving→idle gần điểm → arrived đúng token; xa điểm → blocked; HOME/docked; điểm chưa khai → noroute; fit toạ độ 2 điểm; $state lost → vắng mặt trong telemetry |
| `data/flows.json` | mqtt-broker config, mqtt in/out, function "Robot Adapter (Valetudo)", switch node tách cmd theo `driver`; tick nối vào cả 2 adapter |
| `data/settings.js` | thêm `zlib` vào functionGlobalContext |
| `data/site.json` | `driver`, `valetudo.topic`, `valetudo.points` (toạ độ thật điền sau khi đối tác đo) |
| `termux/install.sh` | `pkg install mosquitto`; boot script chạy `mosquitto -c` với config `listener 1883 0.0.0.0` + `allow_anonymous true` (Mosquitto 2.x mặc định chỉ nghe localhost) trước Node-RED; in ra IP:1883 để điền vào Valetudo và nhắc đặt IP cố định |
| `data/public/index.html` | sửa chữ "Robot Adapter (simulator)" → "(simulator / Valetudo)"; không sửa logic UI |
| `README`/doc vận hành | checklist cấu hình Valetudo + cách lấy toạ độ (5 bước trong ảnh) |

## 8. Triển khai & chạy thử từ xa (RustDesk)

Máy đích là điện thoại Android chạy Termux của đối tác; mình thao tác qua RustDesk trên PC của họ (hoặc trực tiếp màn hình điện thoại).

1. Mac: `npm test` xanh → `sh scripts/pack.sh` → tải `dist/robot-nodered.tar.gz` lên nơi có link tải (Vercel `web/` đang có sẵn, hoặc Drive). Không dùng `deploy.sh` vì không có SSH tới điện thoại.
2. Qua RustDesk, mở Termux trên điện thoại: `curl -L -o robot-nodered.tar.gz <link> && rm -rf ~/bundle && mkdir ~/bundle && tar xzf robot-nodered.tar.gz -C ~/bundle && bash ~/bundle/termux/install.sh`. Script giữ nguyên mật khẩu admin và state cũ, cài thêm Mosquitto.
3. Trước đó: đặt DHCP reservation cho điện thoại trên router của đối tác (install.sh in IP hiện tại ra màn hình). Valetudo (`192.168.0.105`) → Connectivity → MQTT: bật, host = IP điện thoại, port 1883, bật *Provide map data*; ghi lại prefix + identifier → điền `site.json` (sửa trực tiếp `~/robot/site.json` trên máy hoặc đóng gói lại).
4. Lấy toạ độ: với mỗi điểm (bếp, 1–2 bàn, nếu cần dock) làm 5 bước trong ảnh (Home → biểu tượng ghim → chấm vị trí → giữ "Go to location" → copy `x,y`). Điền vào `valetudo.points`. Khởi động lại Node-RED.
5. Kiểm tra theo bậc, dừng ngay nếu bậc nào hỏng:
   - a. `mosquitto_sub -t 'valetudo/#' -v` trên Termux thấy status/battery → MQTT thông.
   - b. Node-RED debug thấy telemetry R1 có pin + vị trí → adapter nhận đúng.
   - c. `mosquitto_pub` thủ công `go/set` → robot chạy → xác nhận toạ độ đúng, không dính người/vật.
   - d. Từ `station.html?role=bep` tạo lệnh giao 1 bàn → robot tới bếp → confirm → tới bàn → confirm → về dock. Quay video.
   - e. Thử `pause`/`resume` và `estop` khi robot đang chạy.
6. Người tại chỗ (đối tác) đứng cạnh robot suốt lúc thử; cần một người sẵn sàng bấm nút vật lý trên robot. Mình chỉ điều khiển qua màn hình.

## 9. Rủi ro & cách xử lý

- **Toạ độ lệch khi Valetudo tạo lại bản đồ** → khoá bản đồ (persistent map) trong Valetudo; nếu vẫn lệch, lấy lại toạ độ (5 phút). Adapter không tự phát hiện được.
- **Robot báo `idle` nhưng chưa tới** → nhờ ngưỡng `arriveCm` + vị trí; nếu đối tác chưa bật map data thì chỉ tin status (ghi rõ trong log).
- **Simulator vẫn khởi tạo R1** vì `S.init(site)` đọc toàn bộ `site.robots` → simulator phải bỏ qua robot có `driver` khác `sim` (sửa 1 dòng trong `simulator.js` `init`), nếu không orchestrator nhận telemetry R1 từ hai nguồn.
- **R2 simulator "cướp" việc `robot: any`** vì luôn gần hơn/rảnh hơn → khi thử robot thật, chọn đích danh R1 trên màn hình trạm, hoặc tạm để `site.robots` chỉ còn R1.
- **Goto tới điểm robot đang đứng sẵn** → status không đổi, không bao giờ "rời moving" → adapter kiểm tra ngay sau khi gửi: nếu có vị trí và đã trong `arriveCm` thì `arrived` luôn.
- **Điện thoại Android đồng thời là broker + server**: Termux bị kill khi tiết kiệm pin → đã có wake-lock trong boot script; nhắc đối tác tắt tối ưu pin cho Termux.
- **Độ trễ Wi-Fi/LTE**: telemetry phát từ cache mỗi 0.5 s nên UI không nhấp nháy "mất kết nối"; chỉ `$state lost` hoặc broker rớt mới báo offline.

## 10. Câu hỏi cần đối tác / anh trả lời (không chặn việc viết code, chặn việc chạy thử)

1. Đối tác **đã có broker MQTT** nào chưa (Home Assistant, Mosquitto trên NAS)? Nếu có, dùng broker đó thay vì cài trên điện thoại.
2. Prefix + identifier MQTT của robot (màn Connectivity → MQTT).
3. Robot model gì (để biết `HOME` khi đang goto có hoạt động, và tốc độ di chuyển để chỉnh `loadSec/handoffSec`).
4. Số điểm muốn khai cho buổi thử đầu: đề xuất **bếp + 2 bàn**, dock để robot tự về.
5. **Điện thoại Android chạy Node-RED có cùng Wi-Fi/subnet với robot (192.168.0.x) không, và có đặt được IP cố định (DHCP reservation trên router) không?** Valetudo lưu host broker dạng chữ; IP điện thoại đổi hoặc Wi-Fi khách có cách ly client thì robot không bao giờ kết nối được. Nếu không cố định được IP → đặt broker trên PC/NAS của đối tác thay vì điện thoại.
6. Phiên bản Valetudo (System Information). Bản cũ `go/set` nhận id preset thay vì `{coordinates}`; khi đó toạ độ phải khai trong Valetudo thay vì `site.json`. Ảnh bước 5 cho thấy bản của đối tác đã dùng `coordinates`, nên câu này chỉ để xác nhận.

## 11. Kế hoạch thực hiện (thứ tự, mỗi bước có kiểm tra)

1. `lib/valetudo.js` + test (TDD, chạy `npm test`) — không cần robot.
2. `settings.js` + `site.json` (driver, topic placeholder, points mẫu) + `flows.json` (nodes mới) — kiểm tra bằng `npm start` local với Mosquitto trên Mac và một script giả lập robot publish status/battery/map-data (10 dòng, trong `scripts/fake-valetudo.js`) → `npm run smoke` vẫn xanh với R2 simulator.
3. `termux/install.sh` thêm Mosquitto + boot — kiểm tra trên máy Android của mình nếu có, không thì đọc lại kỹ và thử qua RustDesk.
4. Pack, đưa link, làm §8 cùng đối tác.
5. Sau buổi thử: ghi lại toạ độ, thời gian thực tế, chỉnh `timing`, commit.
