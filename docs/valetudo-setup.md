# Robot Valetudo — cấu hình & chạy thử

Dành cho buổi thử từ xa với đối tác (RustDesk → Termux trên điện thoại chạy Node-RED).
Thiết kế: `docs/superpowers/specs/2026-10-27-valetudo-mqtt-adapter-design.md` (adapter) và `2026-10-28-site-config-valetudo-map-design.md` (cấu hình trên màn hình, bản đồ, tự xử lý khi bị chặn).

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
Cấu hình (bàn, trạm, điểm dừng, topic, núm chỉnh) nằm trong `~/robot/context/` của Node-RED, **cài lại không mất**.
Nâng cấp từ bản cũ (cấu hình trong `site.json`): script giữ lại `~/robot/site.json.old`; chép sang Downloads (`termux-setup-storage` rồi `cp ~/robot/site.json.old ~/storage/downloads/`) → setup.html → Sao lưu → **Nhập JSON** → Lưu. Toạ độ cũ tự chuyển vào robot R1. Trước khi cài lại nên bấm **Tải xuống JSON** trong trang Cấu hình để có bản sao.

## 1. Valetudo → MQTT

Mở Valetudo của robot (`http://<IP robot>`, xem IP trong danh sách thiết bị của router; nên đặt IP cố định cho cả robot) → **Connectivity → MQTT**:

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

## 2. Khai robot và bàn trong trang Cấu hình

Mở `http://<IP điện thoại>:1880/setup.html` (hoặc từ trang chủ → thẻ **Cấu hình**; màn trạm → **Giám sát** cũng có liên kết **Cấu hình ↗** trên thanh trên). Các tab nằm trên thanh trên cùng: **Điểm & bản đồ · Robot · Vai trò & thời gian · Khách hàng · Sao lưu · Hệ thống**; nút **Lưu** / **Huỷ thay đổi** ở góc phải. Ai có link cũng vào được.

1. Tab **Robot**: R1 chọn **Robot thật** (không phải *Giả lập*) → ô *Topic MQTT* = `<prefix>/<identifier>` ghi ở bước 1 (vd. `valetudo/InsecureYellowishGoldfish`). Các núm khác để mặc định. Bấm **Lưu**.
   Sau vài giây, màn trạm `station.html?role=ql` phải thấy R1 có pin. Chưa thấy → bước 4a.
2. Tab **Điểm & bản đồ**: bản đồ robot tự quét hiện lên (cần *Provide map data* ở bước 1; robot phải đã chạy một vòng để có bản đồ). Bấm **+ Thêm bàn** cho từng bàn, sửa tên nếu cần. Bếp, bar, rửa chén, sạc đã có sẵn.
3. Định vị từng điểm (bếp, rồi từng bàn), chọn một trong hai cách:
   - **Dùng vị trí robot** (chính xác nhất): lái robot tới đúng chỗ cần dừng bằng app Valetudo (hoặc bê robot tới), đợi chấm robot trên bản đồ nhảy tới đó, chọn điểm trong danh sách → bấm **Dùng vị trí robot**.
   - Chấm lên bản đồ: chọn điểm trong danh sách → chạm lên bản đồ. Chỉnh ±10 cm bằng các mũi tên.
   Bấm **Chạy thử tới đây** (robot đang rảnh) để xem robot có tới đúng chỗ không. Dock không cần định vị — robot tự về sạc (`HOME`).
4. **Lưu**. Có hiệu lực ngay, không cần khởi động lại. Trang nào mở sẵn cũng tự cập nhật. Node-RED đăng ký topic mới để nhận ngay trạng thái, Wi-Fi và bản đồ retained (nếu robot đã gửi). Khi đổi topic, bản đồ cũ bị loại bỏ; chờ bản đồ mới rồi định vị lại các điểm cho robot này.

Điểm dừng tốt: nằm trên lối đi, cạnh mép bàn 30–50 cm về phía khách dễ lấy; không chấm vào giữa bàn hay chỗ ghế kéo ra.
Robot **vẽ lại bản đồ** (reset map) thì mọi toạ độ sai → bật *persistent map* trong Valetudo. Trang Cấu hình cảnh báo vàng khi thấy kích thước bản đồ đổi.

## 2b. Tính năng cho khách (tuỳ chọn, mặc định tắt)

Tab **Khách hàng** → thẻ *Tính năng cho khách*: bật từng mục rồi **Lưu**. Tắt thì nút ẩn khỏi trang QR / màn robot và hệ thống cũng từ chối lệnh đó (ghi nhật ký cảnh báo).

| Tính năng | Cần gì | Khách thấy | Nhân viên thấy |
|---|---|---|---|
| **Gọi nhân viên / hoá đơn** | không | Trang QR: 2 nút dưới cùng (nghỉ 30 s sau mỗi lần chạm). Màn robot: *Gọi nhân viên* khi giao món / dẫn khách | Mọi trạm: tiếng *ding* + dải cảnh báo "Bàn 05 gọi nhân viên". Chạm thêm không tạo cảnh báo mới tới khi bấm **Đã biết** |
| **Dẫn khách tới bàn** | robot đang chờ ở một trạm (gọi robot tới trạm) hoặc ở điểm loại *cửa đón khách* (`entrance`, thêm trong `site.json`) | Màn robot: *Dẫn tôi tới bàn* → chọn bàn → *Đi chậm hơn* / *Đã tới bàn* | Nhật ký. Không ai bấm *Đã tới bàn* sau *Chờ khách nhận món* giây → robot tự về |
| **Gọi món trên robot** | thực đơn (bảng bên trái tab Khách hàng: danh mục + trạm làm, món + giá) | Màn robot: *Gọi món* khi robot đứng yên → chọn bàn nếu robot không ở bàn → *Gửi bếp* | Mỗi trạm làm một cảnh báo chỉ gồm món của mình. Bếp tự gửi lệnh giao như thường |
| **Thanh toán VietQR** | bật cả *Gọi nhân viên*; mã ngân hàng + số tài khoản (thẻ Thanh toán). Không có Internet → tải ảnh QR tĩnh | Màn robot ở bàn có món đã gọi: *Thanh toán* → hoá đơn + QR → *Tôi đã chuyển khoản* / *Tiền mặt / thẻ* | "Bàn 05 báo đã chuyển khoản · 140.000đ" — **kiểm tra app ngân hàng** trước khi xác nhận với khách |

Robot Valetudo không chỉnh được tốc độ: *Đi chậm hơn* chỉ ghi nhật ký "không hỗ trợ, bỏ qua".
**Đổi bàn** (luôn bật): bếp gửi nhầm bàn mà robot đã đi → hàng chờ / thẻ *Lệnh gần nhất* → **Đổi bàn** → chạm bàn đúng. Robot đã tới bàn thì không đổi được (dùng *Trả lại bếp*).

## 3. Núm chỉnh robot (tab Robot → **Nâng cao · 9 thông số**, chỉ khi cần)

| Núm | Mặc định | Ý nghĩa |
|---|---|---|
| `arriveCm` | 40 | Dừng cách điểm ≤ bấy nhiêu cm là đã tới. |
| `nomoveSec` | 10 | Sau lệnh mà chừng ấy giây robot chưa chạy → xét theo vị trí (rời dock chậm: 20–30). |
| `retrySec` / `retryMax` | 15 / 4 | Bị chắn: robot nói "xin nhường đường", tự gửi lại lệnh mỗi 15 s; sau 4 lần mới báo trạm, rồi vẫn tự thử mỗi 60 s. |
| `stuckSec` / `progressCm` | 20 / 15 | Đang chạy mà không nhúc nhích quá 15 cm trong 20 s → coi là bị chắn. |
| `acceptCm` | 80 | Thử hết các lần mà robot dừng cách đích ≤ 80 cm (ghế chắn đúng chỗ) → coi là đã tới. 0 = tắt. |
| `tripSec` | 180 | Một chuyến quá 3 phút → coi là bị chắn (lưới cuối). |
| `retryErr` | `unreach\|target\|navigat\|path` | Lỗi Valetudo khớp mẫu này (không tới được đích) được thử lại; lỗi khác (kẹt bánh, nhấc lên…) cần người. |

Mọi chuyến kết thúc bất thường được ghi vào **Nhật ký** trên màn trạm (`R1: chuyến tới Bàn 05 dừng ở 1234,567 (cách 180 cm), status=idle, lỗi=-`) — đọc dòng này để biết robot thật báo gì khi bị chắn rồi chỉnh núm.

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

c. **Lệnh tay** — nút **Chạy thử tới đây** trong tab Điểm & bản đồ, hoặc (người đứng cạnh robot):
```sh
T=valetudo/InsecureYellowishGoldfish
mosquitto_pub -p 1884 -t $T/GoToLocationCapability/go/set -m '{"coordinates":{"x":2351,"y":2544}}'
mosquitto_pub -p 1884 -t $T/BasicControlCapability/operation/set -m STOP
mosquitto_pub -p 1884 -t $T/BasicControlCapability/operation/set -m HOME
```
Robot phải tới đúng chỗ đã định vị ở bước 2.

d. **Trọn vòng** — `http://<IP>:1880/station.html?role=bep`, giao 1 bàn cho R1: robot tới bếp → xác nhận → tới bàn → xác nhận → tự về dock. Quay video.

e. **Dừng / chạy tiếp / dừng khẩn** khi robot đang chạy: robot phải dừng (adapter gửi `STOP`), chạy tiếp thì robot đi tiếp tới điểm cũ.

## 5. Sự cố thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| "Broker MQTT trong máy không chạy" (dải đỏ trên trạm) | Chỉ cảnh báo khi cấu hình đã lưu có robot Valetudo. Mosquitto trên điện thoại đã tắt; mọi robot thật mất điều khiển. Site chỉ mô phỏng không báo lỗi broker; xoá robot thật cuối cùng sẽ xoá cảnh báo cũ. Termux: `mosquitto -c ~/robot/mosquitto.conf -d` (hoặc chạy lại install). Broker chạy lại là dải tự tắt. |
| "IP điện thoại đã đổi từ … sang …" | Router cấp IP mới: robot và mã QR vẫn trỏ IP cũ. Valetudo → Connectivity → MQTT → Host = IP mới; mở lại trang trên tablet; in lại QR; rồi trang Cấu hình → **Hệ thống** → **Đã cập nhật robot và QR**. Gốc: đặt IP cố định cho điện thoại trên router (DHCP reservation). |
| "R1 mất kết nối" | Robot báo `$state lost` hoặc chưa gửi gì: kiểm tra bậc 4a, IP điện thoại, robot còn bật Wi-Fi. |
| "R1 không có lộ trình tới …" | Điểm đó chưa được định vị cho R1. Trang Cấu hình → Điểm & bản đồ → định vị → Lưu (không cần khởi động lại). |
| "R1 gặp vật cản — dừng chờ" (màn robot: Xin nhường đường) | Bình thường: robot dừng giữa đường / không nhúc nhích / Valetudo báo không tới được đích. Robot tự gửi lại lệnh sau `retrySec`. Không cần làm gì; muốn đi ngay thì bấm **Đã dọn lối đi**. |
| "R1 bị chặn … cần nhân viên" | Đã thử `retryMax` lần vẫn không tới, hoặc Valetudo báo lỗi cần người (kẹt bánh, nhấc lên, hộp rác…). Dọn lối: robot tự đi tiếp trong ≤ 60 s, hoặc bấm **Đã dọn lối đi** để đi ngay. Lỗi tại robot: xử lý xong, robot tự chạy tiếp. |
| "R1 bị chặn" khi robot đang ở dock, chưa giao việc | Valetudo báo lỗi không liên quan di chuyển (hộp rác chưa lắp, cảm biến bẩn…) — xem lỗi trên Valetudo, xử lý tại robot; hết lỗi là hết cảnh báo. |
| Robot rời dock bị báo chặn sau ~10 s | Robot quay đầu/khởi động lâu: tăng `nomoveSec`. |
| Robot dừng gần nhưng hay phải thử lại | Tăng `arriveCm` (vd. 60), hoặc định vị lại bằng **Dùng vị trí robot** đúng chỗ robot dừng được. |
| Robot đi sai chỗ / cảnh báo vàng "bản đồ có thể đã vẽ lại" | Bản đồ Valetudo đã tạo lại → định vị lại các điểm (bước 2), bật persistent map. |
| Robot đổi hướng chậm ~2 s | Bình thường: adapter dừng robot rồi mới gửi đích mới, để chạy được trên mọi model. |

## 6. Checklist đầu ca

- Robot online trên màn trạm, pin ≥ 80 %, không cảnh báo.
- Trang Cấu hình → **Hệ thống**: "Mọi thứ bình thường".
- Trang Cấu hình không có cảnh báo vàng về bản đồ.
- Chạy thử một chuyến: bếp giao 1 bàn gần → robot tới, về dock.
- Lối đi chính không có ghế kéo ra, thùng, dây điện; thảm/ngưỡng cửa robot qua được.
- Một người biết nút dừng vật lý trên robot và nút **DỪNG** trên màn robot.
- Sau khi đổi sơ đồ bàn: **Tải xuống JSON** để sao lưu.

## 7. Thực hành tốt với robot giao đồ ăn

- Dạy điểm bằng **vị trí robot thật**, không chấm ước lượng; điểm dừng cạnh bàn trên lối đi, không chắn lối người.
- Trong Valetudo: vẽ **no-go area / virtual wall** quanh bếp nóng, cầu thang, chỗ để thùng; đặt tên phòng (hiện trên bản đồ trạm); tắt mọi lịch dọn tự động; tháo khăn lau; IP tĩnh cho robot và điện thoại.
- Món lỏng: lót chống trượt, không đầy quá 80 %; robot hút bụi tăng/giảm tốc gắt, đây là giới hạn phần cứng.
- Giờ cao điểm: ưu tiên **GẤP** cho món nóng; orchestrator xếp hàng robot tại bếp.
- Bị chắn: để robot tự xin đường và thử lại; chỉ can thiệp khi có cảnh báo trạm. Xem KPI "can thiệp" cuối ca: lối nào hay kẹt thì dời điểm dừng hoặc bàn.
- Phần mềm không phải hệ an toàn: luôn có người bấm được nút dừng vật lý.
