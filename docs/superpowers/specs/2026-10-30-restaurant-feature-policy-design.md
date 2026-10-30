# Chính sách tính năng theo mô hình nhà hàng và xác nhận tính tiền

Ngày: 2026-10-30. Trạng thái: **spec đề xuất để review; chưa triển khai**.
Baseline: branch `feat/ui-redesign-phase2`, trial merge `5eda9b7`, web merge `5c495a5`.
Tiếp nối: [UI redesign phase 2](../plans/2026-10-29-ui-redesign-phase2.md).
Plan thực hiện: [Implementation plan](../plans/2026-10-30-restaurant-feature-policy.md).

## 1. Mục tiêu và ranh giới

Cho quản lý chọn những nghiệp vụ thực sự phù hợp với nhà hàng mà không sửa JSON; nhân viên và khách chỉ thấy thao tác có thể thực hiện. Giữ các công cụ sửa sai của nhân viên. Tách nhận yêu cầu, khách báo thanh toán, nhân viên xác nhận thanh toán và đóng đơn.

Tài liệu này bao phủ toàn bộ đề xuất trong phiên phân tích: đổi bàn giao món, VI/EN, ghi chú rỗng, thu dọn từ robot, khách yêu cầu trả món, tách gọi nhân viên/tính tiền, dẫn khách và khả năng chỉnh tốc độ, gọi món, VietQR, bố trí cấu hình, preset, điều kiện bật và tắt khi đang có công việc.

Không làm trong đợt này: tích hợp POS/ngân hàng, tự động xác minh tiền vào, phát hành hóa đơn điện tử, quản lý đặt bàn/bàn trống, robot tự gắp chén, xác thực tài khoản/RBAC mới. Các nhận định phù hợp nhà hàng là giả thuyết sản phẩm theo mô hình vận hành, không phải kết quả khảo sát mọi nhà hàng Việt Nam.

Quyền thao tác nhân viên tiếp tục theo mô hình LAN tin cậy hiện tại. Nhãn `by`, vai trò chọn trong localStorage và việc ẩn nút **không phải xác thực danh tính**. Không mô tả các thay đổi này như một ranh giới bảo mật. Tính tiền thủ công chỉ nên pilot có người giám sát; triển khai có khách không tin cậy trên cùng mạng cần dự án xác thực riêng.

## 2. Hiện trạng đã xác minh

- `setup.html?tab=guest` đã có bốn checkbox `call`, `guide`, `order`, `pay`, thực đơn và ngân hàng. Không phải tính năng chỉ chỉnh được qua JSON.
- `call` đang gộp `staff`, `bill`, `paid`; `canPay()` đòi cả `pay` và `call`.
- `ack` cảnh báo `call-bill-*` hoặc `call-paid-*` đang xóa mọi đơn của bàn. Phải bỏ hành vi này.
- `bill()` hiện cộng đơn `status:new` của hệ thống robot, chưa phải tổng hóa đơn từ POS.
- `notes:[]` bị thay bằng bộ mặc định. Cần phân biệt thiếu trường với danh sách rỗng chủ ý.
- Valetudo bỏ qua `speed`; UI vẫn có thể báo đang đi chậm. Khả năng driver phải quyết định nút và xử lý server.
- Artifact `https://claude.ai/artifact/SkUvDBDsvYPKSFtFa1UPU9` chưa đọc được do xác minh truy cập. Nguồn đặc tả là code, plan và trao đổi; không coi nội dung artifact đã được đối chiếu.

## 3. Quyết định về tính năng

| ID | Tính năng | Chính sách |
|---|---|---|
| F01 | Đổi bàn giao món | Luôn có cho nhân viên trong trạng thái hợp lệ; nhãn rõ đây là đổi điểm giao của chuyến, không chuyển bàn/hóa đơn POS. Giữ log, chống retarget sau khi đã tới và chống huỷ nhầm từ QR cũ. |
| F02 | VI/EN | Luôn có; mặc định VI, nhớ lựa chọn của khách. Không thêm flag ngôn ngữ. |
| F03 | Ghi chú nhanh | Luôn có khả năng cấu hình; `[]` ẩn chip, vẫn cho nhập ghi chú tự do. Thiếu trường dùng bộ mặc định. Không tự diễn giải ghi chú chuyến giao thành chỉ dẫn đã được bếp tiếp nhận; thêm mô tả tại nơi cấu hình. |
| F04 | Thu dọn từ robot | Flag `busRobot`, mặc định tắt ở site mới. Chỉ chi phối tạo nhiệm vụ thu dọn từ màn robot (`dispatch bus`, nhánh `toDish` tạo chuyến mới); không tắt chức năng thu dọn tại trạm đã có từ phase 1. Nhận/dỡ đồ của chuyến đang chạy luôn còn. |
| F05 | Khách trả/huỷ món | Chính sách `customerCancel` = `request` hoặc `direct`. Site mới dùng `request`: báo nhân viên, không đổi chuyến. Nhân viên vẫn được thu hồi. Đây không phải tự động hủy đơn thương mại/hoàn tiền. |
| F06 | Gọi nhân viên | Flag `callStaff`; khuyến nghị bật cho phục vụ tại bàn sau khi chọn trạm nhận yêu cầu. Không bắt buộc toàn hệ thống. |
| F07 | Yêu cầu tính tiền | Flag `requestBill`, độc lập với `callStaff`; bật cho trả sau. Không dùng nhãn “Xin hoá đơn”. |
| F08 | Dẫn khách | Flag `guide`, mặc định tắt. Nhân viên phải chọn bàn và xác nhận trước khi robot chạy; danh sách điểm không chứng minh bàn trống. Chỉ hiện điều khiển tốc độ nếu driver hỗ trợ. |
| F09 | Gọi món trên robot | Flag `order`, mặc định tắt; cần thực đơn hợp lệ và trạm làm cho từng danh mục. Đơn là yêu cầu tới bếp/quầy; nhân viên vẫn tạo chuyến giao. Không hứa đồng bộ POS. |
| F10 | Thanh toán QR trên robot | Flag `pay`, mặc định tắt, độc lập với `callStaff`/`order`. Chỉ mở QR có số tiền khi có phiếu tính tiền được nhân viên xác nhận. Khách báo đã chuyển khoản không tự chốt đơn. |

Không tạo flag cho dừng khẩn cấp, mất kết nối, ngưỡng pin, chống gửi nhầm, xác nhận nhận/dỡ đồ hoặc các bảo vệ dữ liệu.

## 4. Cấu hình version 2 và migration

Mẫu chuẩn cho site mới (các trường khác của site giữ nguyên):

```json
{
  "featurePolicyVersion": 2,
  "serviceProfile": "custom",
  "features": {
    "callStaff": false,
    "requestBill": false,
    "guide": false,
    "order": false,
    "pay": false,
    "busRobot": false
  },
  "customerCancel": "request",
  "service": { "requestStation": null },
  "notes": ["Không hành", "Ít cay", "Món nóng", "Thêm chén"],
  "payment": { "bank": "", "account": "", "name": "", "verification": "staff" }
}
```

### 4.1 Migration không tự bật thêm nghiệp vụ

- Config thiếu `featurePolicyVersion:2`: `callStaff` và `requestBill` kế thừa boolean của `features.call`; `guide/order/pay` giữ nguyên; `busRobot:true` và `customerCancel:'direct'` để giữ hành vi site đang dùng. Trường mới đã có giá trị hợp lệ được ưu tiên.
- `requestStation`: giữ giá trị hợp lệ; nếu chưa có, dùng trạm đầu tiên theo thứ tự `Object.keys(points)`, hoặc `null`. UI hiện thông báo đã chuyển cấu hình cũ và yêu cầu quản lý kiểm tra trạm nhận; không tự lưu đè file.
- Site mới dùng mẫu trên; không dùng migration để suy ra mặc định của site mới. Seed sản xuất/demo được viết rõ version 2. Site đang dùng nhưng chưa từng lưu cũng là site cũ: installer giữ seed đang chạy vào context trước khi thay file, sau khi Node-RED đã thoát hẳn. Không tự normalize hay tăng rev trong bước bảo toàn này.
- Sau normalize/import/save: xuất version 2, bỏ alias `features.call`, giữ các trường không liên quan. Boolean phải là boolean thật; không coi chuỗi `"false"` là `true`.
- `notes` thiếu/null: bộ mặc định. Mảng có chủ ý: trim, bỏ rỗng, giới hạn 8 mục × 24 ký tự; kết quả rỗng được giữ `[]`. Giá trị không phải mảng và không null bị từ chối.
- Config cũ trên đĩa phải được hiểu đúng ngay khi boot/hello, không đợi người dùng bấm Lưu. Dùng hàm migration không đổi `rev`, `by`, `savedAt`, `saveRequestId`; migration runtime không tự persist.
- Backup tải xuống là config canonical version 2. Mở UI cũ được cache: chặn siteSave payload version cũ khi live site đã v2, báo tải lại; không suy đoán lại policy và ghi đè các flag tách mới.

### 4.2 Preset là thao tác có chủ ý

| Preset | callStaff | requestBill | guide | order | pay | busRobot | customerCancel |
|---|---:|---:|---:|---:|---:|---:|---|
| `table-service` – Phục vụ tại bàn, trả sau | true | true | false | false | false | false | request |
| `counter-prepaid` – Đặt/trả trước tại quầy | false | false | false | false | false | false | request |
| `buffet` – Buffet, gọi hỗ trợ tại bàn | true | false | false | false | false | false | request |
| `custom` – Tự cấu hình/site mới | false | false | false | false | false | false | request |

Quản lý bấm “Áp dụng gợi ý” mới thay các flag/chính sách trong bản nháp, xem chênh lệch rồi Lưu. Preset không đổi menu, ngân hàng, robot, trạm, nhiệm vụ, ghi chú hay đơn. Sửa riêng một flag sau preset chuyển profile thành `custom`. Site đang dùng không tự bị áp preset khi nâng cấp.

## 5. Điều kiện bật và khả năng robot

Hàm chính sách thuần dùng chung trả `{enabled, ready, effective, reasons}`. `enabled` là lựa chọn đã lưu, `effective = enabled && ready`. Lưu flag bật khi thiếu điều kiện được phép để chuẩn bị cấu hình, nhưng tính năng hiện **Chưa đủ điều kiện**, không nhận nghiệp vụ mới. Server kiểm tra cùng một policy, không chỉ ẩn nút.

| Chức năng | Điều kiện ready |
|---|---|
| callStaff/requestBill | Có bàn và `service.requestStation` trỏ tới điểm `station` còn tồn tại. |
| guide | Có bàn, điểm xuất phát `station/entrance`, ít nhất một robot có thể đi tới điểm đích. Kiểm tra đích và trạng thái chính xác khi tạo chuyến. |
| order | Có ít nhất một món, giá nguyên không âm, danh mục hợp lệ và trạm làm hợp lệ. |
| pay | Có `requestStation`, bank/account/name không rỗng và `verification:'staff'`. Có thể chưa có phiếu lúc bật; nút trả tiền chỉ hiện khi có phiếu cụ thể hợp lệ. QR tĩnh là fallback, không chứng minh thanh toán. |
| busRobot | Có bàn và điểm dish hợp lệ; điều kiện vị trí/robot hiện tại tiếp tục áp dụng khi gửi lệnh. |

`capabilities(robotConfig)` trả `{speedControl:boolean}`: simulator `true`, Valetudo `false`; driver chưa biết mặc định `false`. Không cho cấu hình boolean tự nhận hỗ trợ tốc độ. Nút đi chậm ẩn trên robot không hỗ trợ; server từ chối `speed`, không đổi `r.slow`, không gửi lệnh và không toast thành công. Giữ log adapter hiện tại làm phòng vệ.

Trong fleet trộn driver: flag guide có thể bật nhưng nút đi chậm tính riêng từng robot. UI dẫn khách yêu cầu nhân viên chọn/xác nhận bàn; không hiển thị trạng thái “bàn trống” nếu chưa có nguồn dữ liệu đó.

## 6. Yêu cầu hỗ trợ, tính tiền và trả món

- `call {point, what:'staff'|'bill', requestId, by}`: kiểm tra flag tương ứng và trạm nhận. `staff` → “Gọi nhân viên”; `bill` → “Yêu cầu tính tiền”. Hai flag độc lập.
- Định tuyến âm báo về `service.requestStation`. Các trạm vẫn xem được danh sách cảnh báo, nhưng UI chỉ rõ trạm phụ trách. Một cảnh báo cho mỗi bàn/loại tới khi ack; giữ debounce 30 s của khách.
- `ack {alert, by}` chỉ xác nhận đã nhận yêu cầu/ẩn cảnh báo; không xóa đơn, không đổi trạng thái trả tiền hoặc kết thúc chuyến.
- `returnRequest {mission, stop, table, reason:'wrong-item'|'need-help', requestId, by}` áp dụng cho policy request. Server xác minh đúng stop/bàn chưa kết thúc và chưa retarget; tạo cảnh báo khóa theo mission+stop+table. Request này không phụ thuộc `callStaff`, vì đây là đường xử lý sự cố giao món.
- Request trả món ưu tiên trạm xuất phát của chuyến; fallback `requestStation`, rồi trạm đầu tiên. Không có trạm thì từ chối rõ ràng, không báo đã gửi.
- Guest UI request: “Báo nhầm món / Cần hỗ trợ”; nút không trực tiếp gọi `cancelStop`. Nhân viên xem yêu cầu rồi dùng thu hồi/trả lại hiện tại.
- Policy direct: nhãn “Yêu cầu mang món về”, xác nhận hai lần; giải thích đây là xử lý chuyến giao, không phải xác nhận hoàn tiền. `cancelStop` với `why:'customer'` bị server từ chối khi policy request, kể cả client cũ. Các nút khách trên QR và robot phải gửi đúng `why:'customer'` + table; thao tác nhân viên giữ đường điều khiển hiện tại.
- Client cũ `call what:'paid'` không còn được dùng để đổi trạng thái đơn: server trả event yêu cầu tải lại màn thanh toán. Không chấp nhận `amount` do khách tự khai như tổng phải thu.
- Trả thành công/thất bại bằng event theo session và `requestId`; chỉ toast “Đã gửi” khi có xác nhận. Receipt call/returnRequest giữ 24 h qua restart; retry cùng requestId trong cửa sổ này không tạo yêu cầu mới kể cả sau ack. Gọi có chủ ý lần nữa sinh requestId mới. Cùng requestId khác payload bị từ chối. Receipt billing dùng thời hạn riêng theo §7.

## 7. Phiếu tính tiền và đóng đơn

### 7.1 Giới hạn sản phẩm

Chưa có POS tích hợp. Nhân viên phải kiểm tra toàn bộ khoản phải thu ở nguồn quản lý của nhà hàng rồi chuẩn bị phiếu. Tổng đơn robot chỉ là số gợi ý. Nhãn màn khách: **“Phiếu tính tiền do nhân viên xác nhận”**, không gọi là hóa đơn điện tử. Không tự suy ra số tiền phải thu từ các delivery mission.

### 7.2 State và thao tác

Thêm `st.billSeq`, `st.bills` và metadata `st.billingVersion:1`. Một bàn tối đa một phiếu chưa đóng; số phiếu tăng đơn điệu, không tái dùng sau restart.

```text
prepared ── billClaim ──> claimed ── billSettle ──> settled ── billClose ──> closed
    └──────────────────── billSettle ────────────────┘
prepared/claimed ── billVoid (lý do bắt buộc) ──> void
```

- `billPrepare {table, orderIds, total, note, requestId, by}`: thao tác tại trạm nhân viên. Chụp snapshot chính xác các đơn chưa đóng của bàn (id, tên món VI/EN, số lượng, đơn giá), tổng gợi ý và tổng nhân viên xác nhận. `total` là số nguyên VND ≥0; nếu khác tổng gợi ý hoặc không có đơn robot thì `note` bắt buộc. Cho phép phiếu cho bàn chỉ gọi món ở POS ngoài, bằng tổng + mô tả đã kiểm tra.
- `orderIds` phải đúng tập đơn đang mở của bàn lúc nhận lệnh; nếu khác trả conflict để nhân viên xem lại. Không có phiếu đang mở khác. Lưu `id`, `rev:1`, `status:'prepared'`, `preparedBy/At`, `source:'staff-verified'`, `total`, `note`, snapshot, `requestId`.
- `billClaim {bill, rev, requestId, by}`: khách báo đã trả cho đúng phiếu; không nhận amount. Chỉ `prepared` → `claimed`; tạo cảnh báo riêng tham chiếu bill ID. Không kết thúc đơn. Nếu phiếu bị void/closed/revision sai, từ chối và tải lại. Giá trị 0 không mở QR, nhân viên chốt tại trạm.
- `billSettle {bill, rev, method:'transfer'|'cash'|'card'|'zero', requestId, by}`: nhân viên kiểm tra ngân hàng/thu tiền/thẻ rồi xác nhận hai bước. Chuyển `prepared|claimed` → `settled`; giữ lịch sử, lưu người/thời điểm/phương thức. `zero` chỉ khi total=0; phương thức khác chỉ khi total>0. Không tin `by` như bằng chứng xác thực.
- `billClose {bill, rev, requestId, by}`: chỉ cho phiếu settled. Đánh dấu closed và chỉ đóng các orderIds trong snapshot; không xóa theo table. Từ chối nếu còn đơn mới không thuộc snapshot hoặc còn stop pending/active tới bàn trong mission queued/active, để tránh giao món/đơn sót bị lẫn sang lượt khách tiếp theo. Đây là đóng lượt thanh toán trong app, không quản lý đặt bàn/bàn trống.
- `billVoid {bill, rev, reason, requestId, by}`: nhân viên xác nhận vô hiệu hóa phiếu prepared/claimed; không đóng/xóa đơn. Nếu khách đã báo trả, hiển thị cảnh báo phải kiểm tra giao dịch trước khi tạo phiếu mới. Settled/closed không được void trong đợt này; điều chỉnh/hoàn tiền xử lý ngoài app.
- Mỗi transition tăng rev; requestId trùng cùng payload trả lại kết quả trước, không chạy lại. Cùng requestId khác payload từ chối. Lưu receipt cho bill transitions trong bill để chống double tap/retry qua reconnect/restart; giới hạn 20 receipt/bill, đủ cho lifecycle cố định, không loại receipt khi bill chưa kết thúc.
- Khi có phiếu prepared/claimed/settled, từ chối order mới của bàn trong app, giải thích “Bàn đang tính tiền”; nhân viên void phiếu chưa settled trước khi gọi thêm. Không âm thầm sửa tổng QR đã hiển thị. Giao món đang có vẫn tiếp tục.
- Menu/giá sửa sau khi chuẩn bị phiếu không đổi snapshot. Không đổi/xóa điểm bàn đang có đơn/phiếu mở; mở rộng `Site.inUse` cho chúng.

### 7.3 Lưu trữ, nâng cấp và hiển thị

- `ack` không còn đóng đơn, kể cả cảnh báo bill/paid cũ. Đơn legacy `paid-claimed` là chưa xác minh: giữ nguyên và đưa vào danh sách cần xử lý; nhân viên có thể đưa vào phiếu mới, không tự đánh dấu settled.
- Bỏ cleanup xóa đơn chưa thanh toán sau 24 h. Đơn/phiếu đang mở sống qua restart và qua ngày. Phiếu closed/void và đơn đã đóng giữ 30 ngày theo thời điểm đóng, sau đó mới dọn. Không áp giới hạn history nhiệm vụ 30 mục lên dữ liệu tính tiền.
- Snapshot `state` gửi các phiếu chưa closed/void và đơn chưa đóng; dữ liệu lịch sử vẫn ở persisted state, không gửi toàn bộ mỗi tick. Lịch sử tài chính trong phạm vi này là dữ liệu vận hành, không cam kết thay thế sổ kế toán.
- Station thêm vùng “Yêu cầu & tính tiền”: danh sách bàn có yêu cầu/đơn/phiếu; các thao tác chuẩn bị, xác nhận đã thu, đóng, vô hiệu hóa không nằm chung nút “Đã biết”. Không tự chuyển view mỗi tick.
- Robot chỉ mở pay khi đứng yên ở đúng bàn, có prepared/claimed bill tương ứng và policy pay effective; khi claimed hiển thị “Đang chờ nhân viên xác nhận”, không yêu cầu chuyển khoản lần nữa. Sau settled hiển thị đã được nhân viên xác nhận, không cho claim tiếp. QR và số tiền lấy từ bill snapshot.
- QR tĩnh/hiển thị số tài khoản khi mất Internet tiếp tục có; vẫn hiển thị đúng tổng phải thu và chỉ dẫn khách kiểm tra người nhận. Không coi ảnh QR tĩnh là đã mã hóa đúng amount.
- Nếu payment.bank/account/name/qr thay đổi trong khi có bill prepared/claimed: từ chối save cấu hình và nêu các bàn bị ảnh hưởng. Nhân viên hoàn tất/void phiếu trước. Tắt pay thì được phép; không xóa cấu hình thanh toán.

## 8. Màn cấu hình

- Đổi nhãn tab `Khách hàng` thành **Tính năng**, URL chuẩn `setup.html?tab=features`; alias `tab=guest` tiếp tục dẫn đúng tab.
- Ba nhóm: **Nhân viên** (busRobot, ghi chú + link vai trò), **Khách tại bàn** (callStaff, requestBill, customerCancel, order, pay), **Đón khách** (guide, danh sách robot hỗ trợ tốc độ).
- Thực đơn và ngân hàng giữ trong tab Tính năng, thẻ riêng có liên kết từ lý do chưa đủ điều kiện. Hệ thống thêm thẻ **Tính năng đang sử dụng** + nút **Quản lý tính năng**; không có bản sao checkbox ở Hệ thống.
- Từng chức năng có lựa chọn Bật/Tắt và trạng thái thực tế: Đang bật / Đã tắt / Chưa đủ điều kiện, nêu lý do bằng tiếng Việt, không phơi tên key JSON trong luồng chính.
- Danh sách trạm nhận yêu cầu là setting rõ ràng. Preset chỉ gợi ý sau khi quản lý bấm; không tự bật call chỉ vì nhà hàng chọn profile.
- “Lưu” dùng rev + requestId hiện tại; giữ bản nháp khi reconnect/xung đột, cảnh báo chưa lưu. Không tạo đường save riêng cho flag.
- Thay đổi server mới broadcast tới mọi trang. Phần Hệ thống hiển thị config đã lưu, còn editor hiển thị bản nháp và ghi rõ chưa áp dụng.
- Tablet 1280×800/800×1280 không tràn trang; dùng vùng cuộn bên trong thực đơn/danh sách tính tiền. Website/QR 390px không cuộn ngang. Copy khách VI/EN.

## 9. Tắt tính năng trong lúc vận hành

| Thay đổi | Yêu cầu mới | Công việc đang có |
|---|---|---|
| callStaff/requestBill off | Ẩn nút, server từ chối call mới | Giữ cảnh báo tới khi ack; giữ đơn/phiếu, vẫn cho nhân viên xử lý. |
| order off hoặc mất ready | Từ chối order mới; giỏ chưa gửi giữ tại client và cho quay lại, không báo đã gửi | Giữ mọi đơn đã nhận và chuyến giao. |
| guide off | Không tạo chuyến mới | Chuyến đã nhận tiếp tục; confirm/pause/stop/cancel và speed nếu hỗ trợ vẫn dùng. |
| pay off hoặc mất ready | Không mở màn/QR thanh toán mới | Phiếu đã chuẩn bị, claim đã gửi và thao tác staff vẫn được xử lý. Màn đang mở giữ bill ID, cho báo giao dịch đã thực hiện và quay lại, không tự refresh QR mới. Bill claim hợp lệ của phiếu còn prepared/claimed không phụ thuộc flag hiện tại. |
| busRobot off | Chặn tạo chuyến thu dọn mới từ robot | Vẫn thu/dỡ đồ và hoàn tất chuyến đang có; trạm tạo bus không bị chặn. |
| direct → request | Client mới đổi nút; server chặn cancelStop customer từ client cũ | Không đảo ngược chuyến đã bị huỷ; request cũ không tự biến thành huỷ. |

Mỗi refusal có event theo session, nêu lý do, client bỏ trạng thái “đang gửi” và giữ dữ liệu có thể sửa. Không dựa vào `localStorage` của một tablet để quyết định policy toàn site.

## 10. Triển khai và nghiệm thu

Thứ tự: sửa ack trước → schema/migration và policy → lifecycle tính tiền → gate nghiệp vụ/capability → giao diện → export/demo → smoke. Không dùng production 1880/1884 để smoke; giữ integration test tạm 1891/1886 và static web 1892.

| AC | Tiêu chí bắt buộc |
|---|---|
| A01 | Ack staff/bill/paid không đổi đơn hoặc trạng thái thanh toán, kể cả legacy. |
| A02 | Legacy config/state migrate không tăng revision, không tự bật mới; version 2 không bị UI cũ ghi đè; `notes:[]` giữ rỗng. |
| A03 | Preset chỉ đổi draft theo bảng; lưu/reconnect/conflict có cùng bảo vệ hiện tại. |
| A04 | Bật thiếu điều kiện hiển thị reasons và server chặn yêu cầu mới, client không toast thành công. |
| A05 | callStaff/requestBill/pay độc lập; routing đúng trạm, không tạo cảnh báo trùng; request trả món hoạt động cả khi callStaff off. |
| A06 | Retarget, VI/EN, ghi chú tuỳ chỉnh và thu dọn tại trạm vẫn hoạt động; busRobot off chặn tạo mới từ robot. |
| A07 | Valetudo không có nút slow, speed message không đổi state; simulator đổi tốc độ đúng; guide cần nhân viên chọn bàn. |
| A08 | Bill theo snapshot/revision/requestId; amount khách giả không được dùng; chỉ staff settle; close chỉ đóng đúng đơn và không nuốt đơn/chuyến còn chạy. |
| A09 | Khách đã báo trả không bị yêu cầu trả lại; đổi menu không đổi bill; thay ngân hàng khi bill mở bị chặn; lỗi tải QR có fallback. |
| A10 | Tắt từng tính năng giữa nhiệm vụ/đơn/phiếu không làm mất công việc; retry/restart giữ idempotency. |
| A11 | Tab guest cũ còn dùng được; Hệ thống dẫn tới editor duy nhất; UI VI/EN, layout và thao tác chạm đạt. |
| A12 | Trial/web dùng cùng policy và core; demo ghi rõ robot mô phỏng, không mô tả slow như khả năng Valetudo hay claim như xác nhận ngân hàng. |

## 11. Nguồn tham khảo và quyết định chưa được suy diễn

- Code và plan phase 2 là nguồn hành vi hiện tại. Các checkbox trong plan cũ chưa tick không được coi là tính năng chưa làm.
- [PosApp: QR tại bàn/quầy, trả trước/trả sau/buffet](https://posapp.vn/qr-code-order-tai-ban): căn cứ cho việc phân biệt mô hình vận hành, không suy ra thị phần hay sở thích mọi khách Việt Nam.
- [NAPAS: Hội nghị thành viên 2025](https://napas.com.vn/napas-to-chuc-thanh-cong-hoi-nghi-to-chuc-thanh-vien-nam-2025-182251124111300617.htm): QR phổ biến không đồng nghĩa mọi nhà hàng nên tính tiền trên robot.

Các lựa chọn cụ thể trong spec (version 2, preset, phiếu staff-verified, retention 30 ngày, trạm nhận duy nhất) là quyết định thiết kế đề xuất để review. Không có thay đổi runtime nào được thực hiện bởi việc viết tài liệu này.
