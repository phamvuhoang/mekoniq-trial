# Robot Valetudo — cấu hình & chạy thử

Dành cho buổi thử từ xa với đối tác (RustDesk → Termux trên điện thoại chạy Node-RED).
Thiết kế: `docs/superpowers/specs/2026-10-27-valetudo-mqtt-adapter-design.md`.

> An toàn: luôn có một người đứng cạnh robot, sẵn sàng bấm nút vật lý trên robot. Màn hình trạm chỉ là điều khiển, không phải hệ an toàn.

## 0. Cài / cập nhật trên điện thoại

```sh
curl -L -o robot-nodered.tar.gz <link> && rm -rf ~/bundle && mkdir ~/bundle \
  && tar xzf robot-nodered.tar.gz -C ~/bundle && bash ~/bundle/termux/install.sh
```

Script cài thêm Mosquitto (broker MQTT) và in ra `MQTT broker cho Valetudo : <IP>:1883  user: valetudo  pass: …`.
Robot vào cổng 1883 **có mật khẩu** (không có thì ai cùng Wi-Fi nhà hàng cũng điều khiển được robot); Node-RED dùng cổng 1884 chỉ trong máy.
Mật khẩu tạo một lần, giữ qua các lần cài lại: `cat ~/robot/.mqtt-pass`.
Đặt **IP cố định** cho điện thoại trên router (DHCP reservation) trước bước 1 — Valetudo lưu IP này, đổi IP là robot mất kết nối.
Cài lại sẽ ghi đè `~/robot/site.json`; bản cũ (nếu đã cấu hình Valetudo) được lưu ở `~/robot/site.json.bak.<ngày-giờ>`.

## 1. Valetudo → MQTT

Mở Valetudo của robot (`http://192.168.0.105`) → **Connectivity → MQTT**:

| Mục | Giá trị |
|---|---|
| Enabled | bật |
| Host | IP điện thoại (dòng `MQTT broker cho Valetudo`) |
| Port | `1883` |
| Username / Password | `valetudo` / mật khẩu in ra lúc cài (`cat ~/robot/.mqtt-pass`) |
| TLS | tắt |
| **Provide map data** | **bật** (để biết robot đang ở đâu; không bật thì chỉ tin trạng thái robot) |

Lưu, rồi ghi lại **Topic prefix** (mặc định `valetudo`) và **Identifier** (vd. `InsecureYellowishGoldfish`).
Topic của robot = `<prefix>/<identifier>`, vd. `valetudo/InsecureYellowishGoldfish`.

Nên bật **persistent map** (khoá bản đồ): robot tạo lại bản đồ thì mọi toạ độ ở bước 2 mất hiệu lực.

## 2. Lấy toạ độ cho từng điểm

Cho bếp và 1–2 bàn (dock không cần — robot tự về sạc):

1. Valetudo → **Home** (màn bản đồ).
2. Bấm biểu tượng **ghim** (Go to location).
3. Chấm vào đúng vị trí robot cần dừng trên bản đồ.
4. **Giữ** nút **Go to location** → Valetudo copy lệnh dạng `{"coordinates":{"x":2351,"y":2544}}`.
5. Dán ra đâu đó, ghi `x`, `y` (đơn vị cm) kèm tên điểm.

Tên điểm phải trùng id trong `site.json`: `kitchen` (Bếp), `bar`, `dish`, `T01`…`T12`.

## 3. Sửa `~/robot/site.json`

```sh
pkg install -y nano   # nếu chưa có
nano ~/robot/site.json
```

Đổi dòng R1 và khối `valetudo` (giữ nguyên phần còn lại):

```json
"robots": [
  { "id": "R1", "dock": "D1", "driver": "valetudo", "valetudo": { "topic": "valetudo/InsecureYellowishGoldfish", "arriveCm": 40, "nomoveSec": 10, "tripSec": 180 } }
],
"valetudo": {
  "points": {
    "kitchen": { "x": 2351, "y": 2544 },
    "T01": { "x": 1890, "y": 1420 },
    "T02": { "x": 2210, "y": 1420 }
  }
},
```

- Bỏ R2/R3 (robot giả lập) trong buổi thử, nếu không chúng sẽ "cướp" lệnh giao `robot: any`. Muốn giữ thì trên màn trạm chọn đích danh R1.
- Các núm chỉnh (sửa số trên máy rồi `pkill -f node-red`, không cần đóng gói lại):
  - `arriveCm`: robot dừng cách điểm ≤ bấy nhiêu cm thì coi là đã tới (mặc định 40).
  - `nomoveSec`: sau lệnh mà chừng ấy giây robot chưa báo `moving` → xét theo vị trí, thường là "bị chặn" (mặc định 10). Robot quay đầu lâu khi rời dock → tăng lên 20–30.
  - `tripSec`: một chuyến chạy quá chừng ấy giây → "bị chặn" (mặc định 180).
- Bản đồ trên màn hình được căn theo ≥ 2 điểm có trong `valetudo.points` — vị trí robot trên UI chỉ để xem, sai vài chục cm là bình thường.
- Với **2 điểm**, sơ đồ sàn trong `site.json` phải **cùng chiều** với bản đồ Valetudo (không lật gương); nếu chấm robot trên UI chạy ngược chiều, khai thêm điểm thứ 3 — adapter sẽ tự nhận ra bản đồ bị lật. Việc robot chạy tới đúng điểm không phụ thuộc vào chuyện này.
- Thiếu khối `"valetudo": { "topic": … }` ở robot có `"driver": "valetudo"` → robot bị bỏ qua (UI báo mất kết nối), log Node-RED có dòng `[valetudo] R1: thiếu …`.

Khởi động lại Node-RED (vòng boot tự chạy lại sau 5 s):

```sh
pkill -f node-red
```

## 4. Kiểm tra theo bậc — hỏng bậc nào dừng ở bậc đó

a0. **Broker trong máy chạy** (Termux chưa được thử trước — làm bậc này đầu tiên):
```sh
mosquitto_sub -p 1884 -t '#' -C 1 -W 5 -v; echo "exit=$?"
```
`Timed out` / `exit=27` (hết 5 s, không có tin) là broker **đang chạy** nhưng chưa có robot. Lỗi kết nối (`Connection refused`, `Bad file descriptor`…) là broker không lên → `tail -30 ~/robot/mosquitto.log`.

a. **MQTT thông** — trên Termux:
```sh
mosquitto_sub -p 1884 -t 'valetudo/+/StatusStateAttribute/#' -t 'valetudo/+/BatteryStateAttribute/#' -t 'valetudo/+/$state' -v
```
Phải thấy `status docked`/`idle`, `level 87`, `$state ready`. Không thấy gì → xem lại bước 1 (IP, user/pass, cùng Wi-Fi, Wi-Fi khách có cách ly thiết bị không). Log broker: Valetudo → Connectivity → MQTT hiện lỗi kết nối nếu sai mật khẩu.

b. **Adapter nhận đúng** — mở `http://<IP>:1880/station.html?role=ql`: R1 có pin, không báo "mất kết nối".

c. **Lệnh tay** (người đứng cạnh robot):
```sh
T=valetudo/InsecureYellowishGoldfish
mosquitto_pub -p 1884 -t $T/GoToLocationCapability/go/set -m '{"coordinates":{"x":2351,"y":2544}}'
mosquitto_pub -p 1884 -t $T/BasicControlCapability/operation/set -m STOP
mosquitto_pub -p 1884 -t $T/BasicControlCapability/operation/set -m HOME
```
Robot phải tới đúng chỗ đã chấm ở bước 2.

d. **Trọn vòng** — `http://<IP>:1880/station.html?role=bep`, giao 1 bàn cho R1: robot tới bếp → xác nhận → tới bàn → xác nhận → tự về dock. Quay video.

e. **Dừng / chạy tiếp / dừng khẩn** khi robot đang chạy: robot phải dừng (adapter gửi `STOP`), chạy tiếp thì robot đi tiếp tới điểm cũ.

## 5. Sự cố thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| "R1 mất kết nối" | Robot báo `$state lost` hoặc chưa gửi gì: kiểm tra bậc 4a, IP điện thoại, robot còn bật Wi-Fi. |
| "R1 không có lộ trình tới …" | Điểm đó chưa có trong `valetudo.points` (hoặc sai tên id). Thêm toạ độ, `pkill -f node-red`. |
| "R1 bị chặn … cần nhân viên" | Robot dừng xa điểm đích hơn `arriveCm`, Valetudo báo lỗi (kẹt bánh, nhấc lên…), robot không nhúc nhích 10 s sau lệnh (từ chối lệnh), hoặc một chuyến chạy quá 3 phút. Đã bị chặn thì robot tự đứng yên/hết lỗi cũng **không** tính là đã tới. Dọn lối rồi bấm **Đã dọn lối đi** (màn trạm hoặc màn robot) → adapter gửi lại lệnh tới điểm cũ. Lỗi Valetudo (kẹt bánh…) phải xử lý tại robot; hết lỗi là tự hết cảnh báo. |
| "R1 bị chặn" khi robot đang ở dock, chưa giao việc | Valetudo báo lỗi không liên quan di chuyển (hộp rác chưa lắp, cảm biến bẩn…) — xem lỗi trên Valetudo, xử lý tại robot; hết lỗi là hết cảnh báo. |
| Robot rời dock bị báo chặn sau ~10 s | Robot quay đầu/khởi động lâu: tăng `nomoveSec`. |
| Robot dừng gần nhưng hay báo bị chặn | Tăng `arriveCm` (vd. 60) hoặc lấy lại toạ độ. |
| Robot đi sai chỗ | Bản đồ Valetudo đã tạo lại → lấy lại toạ độ (bước 2), khoá bản đồ. |
| Robot đổi hướng chậm ~2 s | Bình thường: adapter dừng robot rồi mới gửi đích mới, để chạy được trên mọi model. |
