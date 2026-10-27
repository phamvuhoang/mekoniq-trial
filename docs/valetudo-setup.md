# Robot Valetudo — cấu hình & chạy thử

Dành cho buổi thử từ xa với đối tác (RustDesk → Termux trên điện thoại chạy Node-RED).
Thiết kế: `docs/superpowers/specs/2026-10-27-valetudo-mqtt-adapter-design.md`.

> An toàn: luôn có một người đứng cạnh robot, sẵn sàng bấm nút vật lý trên robot. Màn hình trạm chỉ là điều khiển, không phải hệ an toàn.

## 0. Cài / cập nhật trên điện thoại

```sh
curl -L -o robot-nodered.tar.gz <link> && rm -rf ~/bundle && mkdir ~/bundle \
  && tar xzf robot-nodered.tar.gz -C ~/bundle && bash ~/bundle/termux/install.sh
```

Script cài thêm Mosquitto (broker MQTT, cổng 1883) và in ra `MQTT broker cho Valetudo : <IP>:1883`.
Đặt **IP cố định** cho điện thoại trên router (DHCP reservation) trước bước 1 — Valetudo lưu IP này, đổi IP là robot mất kết nối.
Cài lại sẽ ghi đè `~/robot/site.json`; bản cũ (nếu đã cấu hình Valetudo) được lưu ở `~/robot/site.json.bak.<ngày-giờ>`.

## 1. Valetudo → MQTT

Mở Valetudo của robot (`http://192.168.0.105`) → **Connectivity → MQTT**:

| Mục | Giá trị |
|---|---|
| Enabled | bật |
| Host | IP điện thoại (dòng `MQTT broker cho Valetudo`) |
| Port | `1883` |
| Username / Password | để trống |
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
  { "id": "R1", "dock": "D1", "driver": "valetudo", "valetudo": { "topic": "valetudo/InsecureYellowishGoldfish", "arriveCm": 40 } }
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
- `arriveCm`: robot dừng cách điểm ≤ bấy nhiêu cm thì coi là đã tới (mặc định 40).
- Bản đồ trên màn hình được căn theo ≥ 2 điểm có trong `valetudo.points` — vị trí robot trên UI chỉ để xem, sai vài chục cm là bình thường.

Khởi động lại Node-RED (vòng boot tự chạy lại sau 5 s):

```sh
pkill -f node-red
```

## 4. Kiểm tra theo bậc — hỏng bậc nào dừng ở bậc đó

a. **MQTT thông** — trên Termux:
```sh
mosquitto_sub -t 'valetudo/+/StatusStateAttribute/#' -t 'valetudo/+/BatteryStateAttribute/#' -t 'valetudo/+/$state' -v
```
Phải thấy `status docked`/`idle`, `level 87`, `$state ready`. Không thấy gì → xem lại bước 1 (IP, cùng Wi-Fi, Wi-Fi khách có cách ly thiết bị không).

b. **Adapter nhận đúng** — mở `http://<IP>:1880/station.html?role=ql`: R1 có pin, không báo "mất kết nối".

c. **Lệnh tay** (người đứng cạnh robot):
```sh
T=valetudo/InsecureYellowishGoldfish
mosquitto_pub -t $T/GoToLocationCapability/go/set -m '{"coordinates":{"x":2351,"y":2544}}'
mosquitto_pub -t $T/BasicControlCapability/operation/set -m STOP
mosquitto_pub -t $T/BasicControlCapability/operation/set -m HOME
```
Robot phải tới đúng chỗ đã chấm ở bước 2.

d. **Trọn vòng** — `http://<IP>:1880/station.html?role=bep`, giao 1 bàn cho R1: robot tới bếp → xác nhận → tới bàn → xác nhận → tự về dock. Quay video.

e. **Dừng / chạy tiếp / dừng khẩn** khi robot đang chạy: robot phải dừng (adapter gửi `STOP`), chạy tiếp thì robot đi tiếp tới điểm cũ.

## 5. Sự cố thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| "R1 mất kết nối" | Robot báo `$state lost` hoặc chưa gửi gì: kiểm tra bậc 4a, IP điện thoại, robot còn bật Wi-Fi. |
| "R1 không có lộ trình tới …" | Điểm đó chưa có trong `valetudo.points` (hoặc sai tên id). Thêm toạ độ, `pkill -f node-red`. |
| "R1 bị chặn … cần nhân viên" | Robot dừng xa điểm đích hơn `arriveCm`, hoặc Valetudo báo lỗi (kẹt bánh, nhấc lên…). Dọn lối rồi bấm **Đã dọn lối đi** (màn trạm hoặc màn robot) → adapter gửi lại lệnh tới điểm cũ. Lỗi Valetudo (kẹt bánh…) phải xử lý tại robot; hết lỗi là tự hết cảnh báo. |
| Robot dừng gần nhưng hay báo bị chặn | Tăng `arriveCm` (vd. 60) hoặc lấy lại toạ độ. |
| Robot đi sai chỗ | Bản đồ Valetudo đã tạo lại → lấy lại toạ độ (bước 2), khoá bản đồ. |
| Robot đổi hướng chậm ~2 s | Bình thường: adapter dừng robot rồi mới gửi đích mới, để chạy được trên mọi model. |
