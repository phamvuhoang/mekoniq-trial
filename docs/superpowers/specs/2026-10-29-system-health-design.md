# Tab "Hệ thống" — báo cáo cấu hình mạng, cảnh báo sự cố kết nối

Ngày: 2026-10-29. Liên quan: `2026-10-27-valetudo-mqtt-adapter-design.md` (adapter), `2026-10-29-ui-redesign-design.md` (giao diện trang Cấu hình).

## 1. Vấn đề

Hệ thống chạy trên một điện thoại Android (Node-RED cổng 1880, Mosquitto cổng 1883 cho robot và 1884 nội bộ). Địa chỉ IP của điện thoại nằm ở ba chỗ ngoài tầm kiểm soát của phần mềm: cấu hình MQTT trong robot Valetudo, URL trên tablet trạm, và mã QR in trên bàn. Khi router cấp IP mới, robot "mất kết nối", tablet không tải được trang, QR chết, và màn trạm chỉ báo "kiểm tra Wi-Fi / nguồn robot", sai nguyên nhân. Các thông số cần điền lại (host, cổng, user MQTT, topic, IP robot) không nằm ở đâu để tra.

Phần mềm không tự sửa được cấu hình đã nằm trong robot, tablet hay tờ giấy. Việc nó làm được: **phát hiện sớm, chỉ đúng nguyên nhân, và gom mọi thông số vào một chỗ**. Biện pháp gốc vẫn là đặt IP cố định trên router; tab này nhắc và kiểm tra điều đó.

## 2. Phạm vi

Làm:

- Tab thứ năm **Hệ thống** trong `setup.html`, chỉ đọc, tự làm mới mỗi 3 giây.
- Endpoint `GET /api/health` trả thông tin máy chủ, broker, từng robot thật.
- Phát hiện IP đổi so với lần trước, với nút xác nhận "Đã cập nhật robot và QR".
- Hai cảnh báo mới lên màn trạm qua cơ chế alert sẵn có: broker MQTT trong máy không chạy; IP điện thoại đã đổi.
- Adapter Valetudo ghi nhận IP, SSID, cường độ Wi-Fi của robot từ MQTT, kèm thời điểm nhận tin cuối và bản đồ cuối.

Không làm (lý do ở §7):

- Sinh mã QR trong trang Cấu hình.
- Tên miền mDNS / hostname thay IP.
- Sửa cấu hình MQTT của robot từ trang Cấu hình.
- Hiện mật khẩu MQTT.

## 3. Kiến trúc

```
tick 0.5s ─┬─> Robot Adapter (Valetudo)  ── events ──> Orchestrator ──> UI (WS)
           └─> Health ── global 'health' ── events(alert/resolve) ──> Orchestrator
mqtt in '$SYS/broker/clients/connected' ──> Health (ghi global 'mqttClients')
http in GET /api/health  ──> trả global 'health'
http in POST /api/health/ack ──> lastIp := health.ip
setup.html tab Hệ thống: fetch /api/health mỗi 3 s + App.site + App.state → bảng + danh sách kiểm tra
```

Nguyên tắc giữ như hai spec trước: lô-gic trong `data/lib/*.js` thuần CommonJS có unit test; node function trong `flows.json` chỉ nối dây. Orchestrator không biết MQTT hay IP; nó nhận thêm hai sự kiện adapter tổng quát `alert` và `resolve`.

### 3.1 `lib/health.js` (mới)

```js
localIp(cb)                 // cb(ip|null). UDP socket connect tới 10.255.255.255:9 rồi đọc socket.address().address; không gửi gói nào.
                            // Không dùng os.networkInterfaces(): Android 11+ chặn netlink với tiến trình không root nên Termux trả rỗng.
build({ ip, lastIp, link, clients, robots, now, port })   // thuần: trả đối tượng health (§4) kể cả ipChanged
```

`lastIp` nằm trong global context store `default` (localfilesystem, sống qua khởi động lại). Lần đầu chạy `lastIp` rỗng → ghi luôn IP hiện tại, không cảnh báo.

### 3.2 `lib/valetudo.js` (sửa nhỏ)

- `ingest`: thêm ba key `WifiConfigurationCapability/ips`, `.../ssid`, `.../signal` → `b.wifi = { ips: string[], ssid, signal: number dBm }`. Mọi tin từ topic của robot cập nhật `b.seenAt = now`; tin `MapData/map-data` có bản đồ cập nhật `b.mapAt = now`. Ba trường thêm vào `INGESTED` để sống qua rebuild.
- `handle` case `link`: ngoài việc đánh offline, phát `{ event: 'alert', key: 'mqtt-down', level: 'error', text: 'Broker MQTT trong máy không chạy — robot thật không điều khiển được. Mở Termux, chạy lại install hoặc `mosquitto -c ~/robot/mosquitto.conf -d`' }` khi `up` false, và `{ event: 'resolve', key: 'mqtt-down' }` khi `up` true. `st.link` lưu trạng thái hiện tại để `health()` đọc.
- Hàm mới xuất ra `health(st, site, now)` → `{ link, robots: { R1: { topic, online, status, battery, seenAt, mapAt, wifi } } }`. Chỉ robot `ours`.

Tên topic Wi-Fi lấy theo mã nguồn Valetudo (`WifiConfigurationCapabilityMqttHandle`). Chưa kiểm chứng trên firmware thật: nếu không nhận được, `wifi` là `null` và giao diện ghi "không rõ", không lỗi.

### 3.3 `lib/orchestrator.js` (2 dòng)

Trong `handle`, nhánh `source === 'adapter'`:

```js
else if (d.event === 'alert' && typeof d.key === 'string') alert(c, d.key, d.level === 'error' ? 'error' : 'warn', String(d.text).slice(0, 200));
else if (d.event === 'resolve' && typeof d.key === 'string') resolve(c, d.key);
```

Alert không gắn robot nên hiện ở mọi trạm. `ack` từ trạm xoá alert như hiện nay; alert quay lại nếu adapter phát lại (link vẫn down thì adapter chỉ phát khi đổi trạng thái, nên không spam).

### 3.4 `flows.json`

- Node function **Health** (tick → Health → orch): đọc `flow.get('val')`, `global.get('lastIp')`, `global.get('mqttClients')`; gọi `H.localIp` (cache 10 s, không gọi mỗi tick) rồi `H.build(...)`; `global.set('health', h)`; khi `h.ipChanged` xuất hiện lần đầu gửi `{topic:'adapter', payload:{event:'alert', key:'ip-changed', level:'error', text}}`, khi hết gửi `resolve`.
- Node `mqtt in` topic `$SYS/broker/clients/connected` → function ghi `global.set('mqttClients', Number(msg.payload))`. Mosquitto phát `$SYS` mỗi 10 s mặc định; `#` không khớp `$SYS` nên cần node riêng.
- `http in GET /api/health` → function trả `global.get('health') || { error: 'not ready' }` với `Cache-Control: no-store`.
- `http in POST /api/health/ack` → function: `global.set('lastIp', global.get('health').ip)`; trả `{ ok: true }`.
- `settings.js`: `functionGlobalContext.mekoniq.health = require('./lib/health')`.

## 4. Dữ liệu `GET /api/health`

```json
{
  "t": 1761700000000,
  "server": { "ip": "192.168.1.23", "port": 1880, "lastIp": "192.168.1.23", "ipChanged": null, "uptimeSec": 3600 },
  "mqtt": { "link": true, "clients": 2, "host": "192.168.1.23", "port": 1883, "user": "valetudo" },
  "robots": {
    "R1": { "topic": "valetudo/InsecureYellowishGoldfish", "online": true, "status": "docked", "battery": 87,
            "seenAt": 1761699999000, "mapAt": 1761699990000, "wifi": { "ips": ["192.168.1.40"], "ssid": "MeKoniq", "signal": -58 } }
  }
}
```

`ipChanged` là `{ from, to }` khi `ip` khác `lastIp`, ngược lại `null`. `ip` là `null` khi không xác định được (máy không có đường mạng); khi đó không so sánh, không cảnh báo. `user` lấy từ biến môi trường `MQTT_USER` nếu có, mặc định `valetudo` (khớp `termux/install.sh`). Không bao giờ trả mật khẩu.

Bản web demo (Vercel) không có endpoint: `fetch` lỗi → tab hiện một dải "Chỉ có khi chạy trên máy nhà hàng" và danh sách kiểm tra chỉ gồm các mục tính được từ `App.site` (bàn chưa định vị, cấu hình chưa lưu).

## 5. Giao diện tab Hệ thống

Thêm `system: 'Hệ thống'` vào `TABS` của `setup.html`; thanh trên cùng đủ chỗ cho 5 tab ở 1280 (kiểm tra ở 800 dọc: nhãn ngắn `Hệ thống` không xuống dòng). Bố cục một màn, không cuộn ở 1280×800; ở dọc cuộn được.

Bốn khối, thứ tự từ trên xuống:

**(a) Kiểm tra** — danh sách giống khối "Kiểm tra" của Thiết kế lộ trình, mỗi dòng một biểu tượng trạng thái, chữ, và gợi ý sửa. Khi tất cả đạt: một dòng xanh "Mọi thứ bình thường". Quy tắc, theo mức nặng giảm dần:

| # | Điều kiện | Mức | Chữ (VI) |
|---|---|---|---|
| 1 | `server.ipChanged` | error | IP điện thoại đã đổi từ {from} sang {to}. Robot và mã QR vẫn trỏ về {from}. → 1. Valetudo → Connectivity → MQTT → Host = {to}. 2. Mở lại trang trên tablet. 3. In lại QR. Rồi bấm **Đã cập nhật robot và QR**. |
| 2 | `mqtt.link === false` | error | Broker MQTT trong máy không chạy. Robot thật không điều khiển được. → Termux: `mosquitto -c ~/robot/mosquitto.conf -d` |
| 3 | robot thật có trong `App.state.robots` với `offline` | error | {R} mất kết nối {X} phút. Robot còn bật? Cùng Wi-Fi? Host MQTT trong Valetudo = {server.ip}? |
| 4 | robot online nhưng chưa từng nhận bản đồ (`mapAt` = 0) | warn | {R} chưa gửi bản đồ. Valetudo → Connectivity → MQTT → bật "Provide map data". |
| 5 | bàn `kind:'table'` không có trong `robots[R].valetudo.points` | warn | {R} chưa định vị {n} bàn: {T05, T07…}. Tab Điểm & bản đồ → định vị. |
| 6 | `wifi.signal < -70` | warn | {R} sóng Wi-Fi yếu ({signal} dBm). Robot dễ rớt khi đi xa router. |
| 7 | `mqtt.clients < 1 + số robot thật online` | info | Số kết nối tới broker thấp hơn dự kiến ({clients}). Chỉ để tham khảo. |
| 8 | `dirty` (cấu hình đang sửa chưa lưu) | info | Có thay đổi chưa lưu. |
| 9 | `server.lastIp` vừa được ghi lần đầu (chưa có `lastIp` trước đó) | info | Chưa thể biết IP có cố định không. Đặt IP cố định cho máy này trên router (DHCP reservation). |

Mục 3 dùng `App.state`; mục 5, 8 dùng `App.site`/trạng thái trang; còn lại dùng `/api/health`. Mục 7 ẩn khi `clients` không có (`$SYS` chưa về).

**(b) Máy chủ** — hai cột thẻ: IP hiện tại và cổng (mono, cỡ lớn), địa chỉ tablet này đang dùng (`location.host`, để so), IP lần trước, chạy liên tục (uptime). Nút **Đã cập nhật robot và QR** chỉ hiện khi có `ipChanged`; bấm → `POST /api/health/ack` → dòng 1 biến mất ở lần làm mới sau, alert `ip-changed` trên trạm được adapter resolve.

**(c) Điền vào Valetudo** — khối mono 4 dòng: Host, Port, Username, và "Password: xem `cat ~/robot/.mqtt-pass` trên điện thoại". Nút **Chép** sao chép 3 dòng đầu. Trang chạy qua `http://` nên `navigator.clipboard` không có; dùng `document.execCommand('copy')` trên vùng text đã chọn, thất bại thì toast "Chọn chữ rồi chép tay".

**(d) Robot thật** — mỗi robot một thẻ: tên + pill online/offline, topic MQTT, trạng thái Valetudo + pin, nhận tin cuối (giây trước), bản đồ cuối, IP robot + SSID + dBm (hoặc "không rõ"), số bàn đã định vị / tổng bàn, nút **Mở Valetudo ↗** (`http://{wifi.ips[0]}`, mở tab mới; ẩn khi không rõ IP). Không có robot thật → một dòng "Site này chỉ có robot mô phỏng".

Màn Giám sát (station.html) không thêm gì: hai alert mới đi qua dải cảnh báo sẵn có với nút Đã biết.

## 6. Nghiệm thu

1. Node-RED chạy trên Mac, Mosquitto 1884 chạy: `/api/health` trả `mqtt.link true`, `server.ip` là IP LAN của Mac, `ipChanged null`. Tab Hệ thống: "Mọi thứ bình thường" khi site demo không có robot thật.
2. Tắt Mosquitto: trong 10 s trạm hiện dải đỏ "Broker MQTT trong máy không chạy"; tab Hệ thống dòng 2 đỏ. Bật lại: dải tự biến mất, không cần Đã biết.
3. Ghi `global lastIp` khác IP thật (hoặc đổi Wi-Fi): tab hiện dòng 1 đỏ với đúng hai IP, trạm có alert `ip-changed`. Bấm **Đã cập nhật robot và QR**: hết cả hai.
4. `fake-valetudo.js` chạy: thẻ R1 hiện topic, docked, pin, nhận tin cuối tăng từng giây; tắt fake: sau 3 s R1 offline, dòng 3 đỏ với gợi ý có `server.ip`.
5. Fake publish `.../WifiConfigurationCapability/signal` = `-75`: dòng 6 vàng; `ips` = `["192.168.1.40"]`: nút Mở Valetudo trỏ đúng.
6. Site có 12 bàn, R1 định vị 10: dòng 5 vàng liệt kê 2 bàn thiếu.
7. Web demo trên Vercel: tab mở được, có dải "Chỉ có khi chạy trên máy nhà hàng", không lỗi console.
8. `npm test` xanh; `grep -o "type: *'[a-zA-Z]*'" data/public/*.html | sort -u` không đổi (không thêm thông điệp WS).

## 7. Quyết định và lý do

1. **HTTP polling thay cho WebSocket** cho `/api/health`: giữ bộ thông điệp WS và snapshot orchestrator nguyên vẹn; chỉ một trang dùng dữ liệu này; 3 s là đủ.
2. **Sự kiện adapter `alert`/`resolve` tổng quát** thay cho alert riêng từng loại trong orchestrator: 2 dòng, dùng lại được cho adapter khác.
3. **IP máy chủ bằng UDP connect**, không dùng `os.networkInterfaces()`: Android 11+ chặn liệt kê card mạng với tiến trình thường (chính `install.sh` cũng phải fallback). Cách UDP không gửi gói, chỉ hỏi bảng định tuyến.
4. **Không hiện mật khẩu**: trang Cấu hình không có đăng nhập, ai trong Wi-Fi cũng mở được.
5. **Không sinh QR**: cần thêm mã hoá QR ~300 dòng; IP cố định giải quyết gốc. Thêm sau nếu thực tế vẫn hay đổi IP.
6. **Không mDNS/hostname**: Termux không phát mDNS ổn định; Valetudo và tablet Android cũ phân giải không đều. Tailscale ổn hơn nhưng bắt mọi tablet cài thêm.
7. **Không sửa host MQTT của robot từ xa**: Valetudo không có API làm việc này qua MQTT.
8. **Alert `off-R1` vẫn nói "kiểm tra Wi-Fi / nguồn robot"** khi broker down: chấp nhận, vì alert `mqtt-down` đứng trên cùng và nói đúng nguyên nhân; sửa chữ alert cũ cần orchestrator biết trạng thái link, trái nguyên tắc.
