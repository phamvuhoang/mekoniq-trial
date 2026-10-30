# Restaurant Feature Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start implementation merely because this document exists.

**Goal:** Cấu hình nghiệp vụ phù hợp từng nhà hàng qua giao diện, giữ công việc đang chạy và tách tiếp nhận yêu cầu khỏi xác nhận thanh toán/đóng đơn.

**Architecture:** Policy thuần dùng chung giữa Node-RED và browser; orchestrator là nơi quyết định nghiệp vụ. Billing là module thuần riêng, được orchestrator gọi và lưu cùng persisted state. Giao diện chỉ hiển thị/soạn yêu cầu, không tự xác nhận thành công hoặc số tiền. Trial là nguồn export cho web demo.

**Tech Stack:** Node.js CommonJS, Node-RED, HTML/CSS/JavaScript, node:assert/node:test, Playwright smoke, MQTT integration hiện có. Không thêm production dependency.

**Spec:** [2026-10-30-restaurant-feature-policy-design.md](../specs/2026-10-30-restaurant-feature-policy-design.md). Phải đọc cả spec trước khi thực hiện.

**Trạng thái:** Plan đề xuất, chưa thực hiện. Baseline trial `5eda9b7`, web `5c495a5`, branch `feat/ui-redesign-phase2`.

## Global Constraints

- `featurePolicyVersion:2`; flags chính xác: `callStaff`, `requestBill`, `guide`, `order`, `pay`, `busRobot`.
- `customerCancel` chỉ nhận `request|direct`; preset chỉ nhận `custom|table-service|counter-prepaid|buffet`.
- Site mới: tất cả flags false, `customerCancel:'request'`; demo viết cấu hình rõ ràng, không suy ra defaults từ demo seed.
- `notes:[]` giữ rỗng; tối đa 8 mục × 24 ký tự.
- `ack` không xóa đơn/đổi trạng thái thanh toán; mọi transition bill dùng bill ID + rev + requestId.
- Bill total là số nguyên VND ≥0; chỉ staff xác nhận; claim không nhận amount làm nguồn phải thu.
- Giữ đơn/phiếu chưa đóng qua ngày; closed/void và đơn đã đóng giữ 30 ngày; tối đa 20 receipt/bill.
- Không tích hợp POS/ngân hàng, không phát hành hóa đơn điện tử, không thêm hệ xác thực/RBAC. Nhãn vai trò/by không phải quyền được xác thực.
- Tắt feature chỉ chặn nghiệp vụ mới; giữ confirm/release/claim của phiếu đã có/settle/close theo spec §9.
- Tablet 1280×800 và 800×1280 không tràn trang; QR/web 390px không cuộn ngang; copy khách VI/EN.
- Smoke dùng riêng 1891/1886/1892; không reset hoặc gửi lệnh tới production 1880/1884.
- Giữ save requestId/rev, map identity ID+topic, MQTT retained/redeploy, giới hạn pin, và bảo vệ retarget/cancel đã merge từ main.
- Chỉ commit/push/deploy khi nằm trong yêu cầu thực thi được duyệt; tài liệu này không tự cấp quyền deploy.

## Workstreams và điểm bàn giao

1. **Policy/config**: Tasks 1–2, 5–7. Task 1 là sửa lỗi có thể review riêng.
2. **Tính tiền**: Tasks 3–4, 8. Lifecycle độc lập với flags để không bỏ đơn khi tắt.
3. **Tích hợp/phát hành**: Tasks 9–10. Không export dở dang sang site đang dùng.

Thực hiện theo thứ tự số để mỗi bước có đủ dependency. Có thể review từng task riêng; không đổi hợp đồng giữa tasks mà không cập nhật spec/plan và test sử dụng nó.

## Bản đồ file và interfaces

| File | Vai trò |
|---|---|
| Create `data/lib/feature-policy.js` | Module UMD thuần, Node `require` và browser `globalThis.FeaturePolicy`; không khai báo const toàn cục gây trùng `ID` ở robot.html. |
| Modify `data/lib/site.js` | Canonical migration, validate v2, giữ notes rỗng, inUse gồm order/bill đang mở. |
| Create `data/lib/billing.js` | Lifecycle phiếu, snapshot, receipt/idempotency, cleanup; không MQTT/DOM. |
| Modify `data/lib/orchestrator.js` | Call riêng, request trả món, route billing commands, policy gates, snapshot và log. |
| Modify `data/public/common.js` | Nạp policy dùng chung, gửi yêu cầu có receipt, thông báo VI/EN theo trang. |
| Modify `data/public/setup.html` | Tab Tính năng, preset, ready reasons, routing, summary tại Hệ thống. |
| Modify `data/public/station.html` | Yêu cầu & tính tiền, actions nhân viên, giữ retarget/thu hồi. |
| Modify `data/public/robot.html`, `table.html` | Feature surfaces, trả món, readiness, capability, phiếu tính tiền. |
| Modify `data/site.json`, `data/site.demo.json` | Seed v2 sản xuất/demo. Không ghi đè site live trong context. |
| Modify `scripts/export-web.sh`, `../web/demo/transport.js` | Export/nạp modules mới, migration demo persisted state. |
| Create `scripts/test-feature-policy.js`, `test-billing.js`, `test-guest-policy.js` | node:test regression suites; chạy trong npm test. |
| Create `scripts/helpers/orchestrator-harness.js` | Harness độc lập clock/site/state cho các test nghiệp vụ mới. |
| Modify `scripts/test.js`, `test-site.js`, `test-review.js` | Thay assertions cũ xung đột policy mới, giữ coverage cũ. |
| Create `scripts/smoke-feature-policy.js` | Playwright cho flags/billing/capability; dùng env Playwright đã có như smoke-browser.js. |
| Modify `docs/testing.md`, `docs/valetudo-setup.md`, `../web/README.md`, `../web/demo.html` | Hướng dẫn, giới hạn phần cứng, kịch bản demo và bước xác nhận tiền thật. |

Hợp đồng policy (module không phụ thuộc site.js để tránh circular require):

```js
migrate(site) // -> deep clone canonical v2; giữ metadata rev/by/savedAt/saveRequestId
preset(name) // -> {serviceProfile, features, customerCancel}; không mutate site
capabilities(robotConfig) // -> {speedControl:boolean}
readiness(site, key) // -> {enabled, ready, effective, reasons:[{code, text}]}
```

`migrate` không tự validation toàn bộ site; `Site.normalize` gọi migrate rồi validate. Policy dùng trong runtime cũng phải hoạt động với legacy config. Browser export `FeaturePolicy` nằm trong IIFE; Node export cùng object.

Billing API:

```js
init(st) // thêm billingVersion/billSeq/bills nếu thiếu; không auto-settle legacy orders
handle(st, site, command, now)
// -> {ok:true, bill, duplicate:boolean} | {ok:false, code, text}
// command.type: billPrepare|billClaim|billSettle|billClose|billVoid
// mutate st chỉ khi validation toàn bộ đã pass; trả errors không mutate
cleanup(st, now) // chỉ dọn terminal records đủ 30 ngày
```

`handle` quyết định nghiệp vụ và trả bill; orchestrator tạo session event, broadcast, log và cảnh báo. `billClose` kiểm tra missions đang chạm tới bàn trong `st`; `billPrepare` kiểm tra đúng tập open orderIds của bàn. Không đưa UI state vào billing module.

## Task 1: Ack chỉ nhận yêu cầu, không đóng đơn

**Files:** Modify `data/lib/orchestrator.js`, `scripts/test.js`.
**Interfaces:** Giữ `ack {alert, by}`; bỏ side effect xóa orders. Đây là sửa có thể ship độc lập trước feature schema.

- [ ] Thêm regression trong scenario harness hiện có; seed đơn trực tiếp để test chỉ tập trung ack:

```js
scenario('ack bill/paid never settles or deletes orders', () => {
  for (const what of ['bill', 'paid']) {
    st.orders = [{id:900, table:'T05', status:'paid-claimed', items:[], total:1000, t:now}];
    st.alerts = [{id:901, key:`call-${what}-T05`, level:'warn', text:'test'}];
    const before = JSON.stringify(st.orders);
    send({type:'ack', alert:901});
    assert.strictEqual(JSON.stringify(st.orders), before);
    assert.strictEqual(st.alerts.length, 0);
  }
});
```

- [ ] Chạy `node scripts/test.js`; xác nhận fail ở orders bị xóa. Đổi test cũ “Đã biết ... đóng đơn” thành kỳ vọng giữ đơn; không bỏ test retarget-safe cancel/safety alerts.
- [ ] Sửa case ack thành chỉ filter alert, giữ lifecycle task sau chịu trách nhiệm đóng:

```js
case 'ack':
  st.alerts = st.alerts.filter(a => a.id !== d.alert);
  return;
```

- [ ] Chạy `npm test`; nếu thực thi có quyền commit, commit `fix: acknowledge requests without settling orders`.

## Task 2: Canonical policy, migration và presets

**Files:** Create `data/lib/feature-policy.js`, `scripts/test-feature-policy.js`; modify `data/lib/site.js`, `data/lib/orchestrator.js`, `package.json`, `scripts/test-site.js`.
**Interfaces:** Sản xuất bốn hàm policy ở bảng interface; Site.normalize trả schema v2.

- [ ] Tạo test node:test với ví dụ runnable:

```js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../data/lib/feature-policy');
const Site = require('../data/lib/site');
const seed = require('../data/site.demo.json');
test('legacy call splits without losing other flags', () => {
  const old = structuredClone(seed);
  delete old.featurePolicyVersion;
  old.features = {call:true, guide:false, order:true, pay:false};
  const next = Policy.migrate(old);
  assert.equal(next.featurePolicyVersion, 2);
  assert.equal(next.features.callStaff, true);
  assert.equal(next.features.requestBill, true);
  assert.equal(next.features.busRobot, true);
  assert.equal(next.customerCancel, 'direct');
  assert.equal(next.rev, old.rev);
  assert.equal('call' in next.features, false);
  assert.equal('call' in old.features, true);
});
test('explicit empty notes stay empty', () => {
  const input = {...structuredClone(seed), notes:[]};
  assert.deepEqual(Site.normalize(input, seed).site.notes, []);
});
test('preset does not enable ordering or payment', () => {
  const p = Policy.preset('table-service');
  assert.equal(p.features.callStaff, true);
  assert.equal(p.features.requestBill, true);
  assert.equal(p.features.order, false);
  assert.equal(p.features.pay, false);
});
```

- [ ] Chạy `node --test scripts/test-feature-policy.js`; thêm trường hợp v2 idempotent, từng preset, thiếu notes, `"false"` bị validate từ chối, alias call bị bỏ, custom unknown fields giữ.
- [ ] Implement UMD bằng IIFE, mọi hàm pure. Migration legacy chỉ diễn ra nếu version !=2; v2 không bơm lại legacy defaults. Validate `requestStation` null hoặc station tồn tại; feature thiếu điều kiện trả reasons qua readiness, không biến thành lỗi cấu trúc làm không lưu được draft.

```js
function capabilities(r) {
  return {speedControl: !!r && (!r.driver || r.driver === 'simulator')};
}
function normalizeNotes(notes) {
  if (notes == null) return ['Không hành','Ít cay','Món nóng','Thêm chén'];
  if (!Array.isArray(notes)) throw new Error('notes phải là danh sách');
  return notes.map(n=>String(n ?? '').trim().slice(0,24)).filter(Boolean).slice(0,8);
}
```

Bốn hàm public nằm trong factory IIFE: trả `{migrate,preset,capabilities,readiness}`; nhánh CommonJS gán `module.exports`, nhánh browser gán duy nhất `globalThis.FeaturePolicy`. `normalizeNotes` là helper nội bộ, lỗi được Site.normalize đưa vào errors. Với robot không có config, capabilities trả false; driver mới chưa hỗ trợ cũng false.


- [ ] Trong Site.normalize dùng clone từ `Policy.migrate(input)`. Resolve Policy qua `require('./feature-policy')` ở Node hoặc `globalThis.FeaturePolicy` ở browser; không tạo require dependency ngược. Update `Site.inUse` đưa table của open orders/open bills vào used.points.
- [ ] Chưa đổi seed/runtime canonical trong task này. Để code cũ nhận config đã normalize trong các siteSave tests, cập nhật helper `feature` ở orchestrator đọc Policy.migrate(c.site).features; tạm ánh xạ key `call` cũ sang callStaff. Không xuất alias `call` vào config canonical. Mapping tạm bị gỡ ở Task 5 khi mỗi call.what có gate riêng. Các seed v2 chỉ được đổi ở Task 9 sau khi mọi consumer đã cập nhật.
- [ ] Thêm script test mới vào `npm test`; chạy suite, commit `feat: add versioned restaurant feature policy` nếu được phép.

## Task 3: Billing lifecycle độc lập và idempotency

**Files:** Create `data/lib/billing.js`, `scripts/test-billing.js`; modify `package.json`.
**Interfaces:** `Billing.init/handle/cleanup` như trên; statuses và fields đúng spec §7.

- [ ] Test thực tế transitions trước khi viết module:

```js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Billing = require('../data/lib/billing');
const site = require('../data/site.demo.json');
function fixture() {
  const st={orders:[{id:1,table:'T01',status:'new',total:1000,
    items:[{id:'test',qty:1,price:1000}],t:100}],missions:[]};
  Billing.init(st); return st;
}
test('claim is not settlement; closing uses the prepared snapshot', () => {
  const st=fixture();
  const prepared=Billing.handle(st,site,{type:'billPrepare',table:'T01',
    orderIds:[1],total:1000,note:'Đã kiểm tra',by:'Thu ngân',requestId:'p1'},1000);
  assert.equal(prepared.ok,true);
  const b=prepared.bill;
  const claim=Billing.handle(st,site,{type:'billClaim',bill:b.id,rev:b.rev,requestId:'c1'},2000);
  assert.equal(claim.bill.status,'claimed');
  assert.notEqual(st.orders[0].status,'closed');
  const settled=Billing.handle(st,site,{type:'billSettle',bill:b.id,rev:claim.bill.rev,
    method:'transfer',by:'Thu ngân',requestId:'s1'},3000);
  assert.equal(settled.bill.status,'settled');
  assert.notEqual(st.orders[0].status,'closed');
  const closed=Billing.handle(st,site,{type:'billClose',bill:b.id,rev:settled.bill.rev,
    by:'Thu ngân',requestId:'x1'},4000);
  assert.equal(closed.bill.status,'closed');
  assert.equal(st.orders[0].status,'closed');
});
test('retry after serialize/restart does not prepare a second bill', () => {
  let st=fixture();
  const cmd={type:'billPrepare',table:'T01',orderIds:[1],total:1000,note:'',by:'Staff',requestId:'p2'};
  Billing.handle(st,site,cmd,1000);
  st=JSON.parse(JSON.stringify(st)); Billing.init(st);
  assert.equal(Billing.handle(st,site,cmd,2000).duplicate,true);
  assert.equal(st.bills.length,1);
});
```

- [ ] Chạy fail; bổ sung tests: rev cũ, requestId cùng/khác payload, total âm/thập phân, zero method, snapshot không đổi theo menu, void không đóng orders, close có mission/đơn mới bị từ chối, legacy paid-claimed không tự settled, terminal 30 ngày mới cleanup, open 31 ngày vẫn giữ.
- [ ] Implement transitions bằng bảng allowed status; validate tất cả trước mutate. Fingerprint command bỏ trường rev khi so receipt retry? **Không**: giữ toàn bộ payload business kể cả rev/by; chỉ bỏ transport/session. Kiểm tra receipt trước current revision để replay đúng lệnh cũ được trả duplicate.

```js
const allowed = {
  billClaim: ['prepared'],
  billSettle: ['prepared','claimed'],
  billClose: ['settled'],
  billVoid: ['prepared','claimed']
};
// Validation order: receipt -> bill exists -> rev -> allowed status ->
// type-specific invariants -> mutate once -> rev++ -> persist receipt.
```

- [ ] Bill.prepare lưu snapshot tên món VI/EN; nếu đơn legacy chỉ có id và item đã bị xóa khỏi menu thì dùng id làm nhãn, không crash. Không dùng menu price để tính lại đơn đã nhận.
- [ ] `cleanup` dùng closedAt/voidAt, không t hoặc preparedAt; kiểm thử clock boundary. Đăng ký test trong npm test; commit `feat: add staff-verified billing lifecycle` nếu được phép.

## Task 4: Orchestrator tích hợp billing, runtime migration và receipts

**Files:** Modify `data/lib/orchestrator.js`, `data/flows.json`, `data/lib/site.js`, `scripts/test.js`, `scripts/test-review.js`; create `scripts/helpers/orchestrator-harness.js`, `scripts/test-guest-policy.js`.
**Consumes:** Tasks 1–3. **Produces:** Các WS commands của spec §7; event session `{type:'event', requestId, ok, code?, text, bill?}` và state.bills.

- [ ] Tạo harness dùng module thực, không mock orchestrator:

```js
const O=require('../../data/lib/orchestrator');
const seed=require('../../data/site.demo.json');
module.exports=function harness(site=structuredClone(seed)) {
  let now=1e12;
  const st=O.init(site,now);
  return {st, get site(){return site;},
    send(data){const r=O.handle(st,site,{source:'ui',data:{by:'test',...data},session:'test',seed},now);
      if(r.site)site=r.site;return r;},
    tick(ms){now+=ms;return O.handle(st,site,{source:'adapter',data:{event:'telemetry',robots:[]}},now);}
  };
};
```

- [ ] Viết node:test: prepare qua WS, claim amount giả không ảnh hưởng bill.total, ack không đổi bill, tắt pay rồi claim/settle/close phiếu cũ vẫn được; order mới khi bill mở bị từ chối; siteSave thay ngân hàng khi prepared/claimed bị từ chối; xóa bàn có open order/bill bị từ chối.

```js
const h=harness();
h.st.orders=[{id:1,table:'T01',status:'new',items:[],total:1000,t:1e12}];
h.send({type:'billPrepare',table:'T01',orderIds:[1],total:1000,note:'POS đã kiểm tra',requestId:'p'});
const b=h.st.bills[0];
h.send({type:'billClaim',bill:b.id,rev:b.rev,requestId:'c',amount:1});
assert.equal(h.st.bills[0].total,1000);
assert.equal(h.st.bills[0].status,'claimed');
```

- [ ] Route five billing command types tới Billing.handle; success tạo receipt event theo session và c.force, duplicate không log/alert lần nữa. Server tự lấy amount cho text từ bill. `call paid` cũ trả lỗi tải lại thay vì thay orders.
- [ ] Init/sync gọi Billing.init; timers gọi cleanup và bỏ xóa open orders theo tuổi 24h. Snapshot chỉ open bills/orders. `reset` demo xóa bills/billSeq/receipts cùng orders; không dùng reset để migrate production.
- [ ] Node-RED flow nhận site qua Policy.migrate khi đọc `global.site || seed`; đảm bảo mọi node core/health/adapter nhất quán, không tự tăng rev/persist. Có thể canonical hóa một lần tại node core với cache RAM theo object/rev để tránh clone mỗi telemetry tick; không thay đổi bản live được quản lý ngoài save.
- [ ] siteSave live v2 + payload version cũ từ chối với event hiện có; import file cũ vẫn được bởi setup normalize trước send. Test hello config cũ, import cũ và stale UI là ba đường riêng.
- [ ] Chạy npm test; cập nhật tests kỳ vọng cleanup/paid-claimed cũ theo contract mới, commit `feat: wire billing receipts and preserve open orders` nếu được phép.

## Task 5: Gates cho requests, cancellation, bus và capability

**Files:** Modify `data/lib/orchestrator.js`, `data/lib/valetudo.js` (chỉ nếu cần bổ sung reason log), `scripts/test-guest-policy.js`, `scripts/test-valetudo.js`.
**Consumes:** Policy + billing integration. **Produces:** call staff/bill độc lập, returnRequest, runtime gate theo spec §§5–6,9.

- [ ] Viết test: callStaff off/requestBill on chỉ nhận bill; pay on không đòi callStaff; request routing/dedupe; request trả món không đổi mission; customer cancel bị chặn trong request policy; stale table sau retarget bị từ chối; busRobot off chặn dispatch bus/toDish tạo mới nhưng trạm create bus vẫn được.

```js
const h=harness();
h.site.features.callStaff=false;
h.site.features.requestBill=true;
h.send({type:'call',point:'T01',what:'staff',requestId:'a'});
assert.equal(h.st.alerts.some(a=>a.key==='call-staff-T01'),false);
h.send({type:'call',point:'T01',what:'bill',requestId:'b'});
assert.equal(h.st.alerts.some(a=>a.key==='call-bill-T01'),true);
```

- [ ] Gate `call` bằng mapping `{staff:'callStaff', bill:'requestBill'}` + readiness. Thêm returnRequest với key chứa mission/stop/table; snapshot request details vào alert để station có thể mở đúng chuyến, không suy luận id từ text.
- [ ] Tạo session receipt cho lệnh mới/gate refusal; lưu requestId của yêu cầu tới khi hoàn tất và trong log receipt RAM/persisted map có TTL 24h cho call/returnRequest (không áp TTL này cho bill receipts). Retry sau ack trong cửa sổ 24h không tạo alert lại. Khách chủ ý gọi mới sinh requestId mới.
- [ ] Gate speed trước khi đổi r.slow bằng `Policy.capabilities(cfg).speedControl`; giữ điều kiện nhiệm vụ/online. Guide active không bị flag tắt chặn confirm/speed/cancel. Gate ready điểm tới: simulator có route node, Valetudo có taught point; điều kiện vị trí canGuide và trạng thái robot kiểm tra lại ở server.
- [ ] Thêm test simulator/Valetudo cạnh nhau, malformed config capability fail-closed; task được nhận trước toggle vẫn confirm/receive/unload/release được. Chạy npm test; commit `feat: enforce restaurant policies on incoming actions` nếu được phép.

## Task 6: Tính năng editor, preset và Hệ thống summary

**Files:** Modify `data/public/setup.html`, `data/public/common.js`; create `scripts/smoke-feature-policy.js` (khung browser tests).
**Consumes:** Policy.readiness/migrate/preset; giữ cơ chế save hiện tại.

- [ ] Nạp `feature-policy.js` trước `site.js` trên setup. Đổi DOM/tab key thành features; alias query guest → features; unknown query → points. Đặt labels và 3 nhóm theo spec §8.
- [ ] Preset button cập nhật duy nhất draft, không gọi send; hiển thị diff bằng danh sách nhãn trước khi Lưu. Thay một switch sau preset đặt serviceProfile=custom.

```js
function applyPreset(name) {
  const p=FeaturePolicy.preset(name);
  Object.assign(D,{serviceProfile:p.serviceProfile,features:p.features,
    customerCancel:p.customerCancel});
  setDirty(true); renderFeatures();
}
```

- [ ] Render each row bằng readiness(D,key), nhưng Hệ thống dùng App.site; links lý do dẫn đúng field menu/payment/requestStation. Dời “Ghi chú nhanh” hoặc dùng link tới Vai trò & thời gian, không hai editor cho cùng dữ liệu.
- [ ] Khung smoke mới import Playwright theo `PLAYWRIGHT_MODULE || 'playwright'`, dùng `chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM})`. `base='http://127.0.0.1:1891'`; một context mới cho mỗi kịch bản, `assert=require('node:assert/strict')`. Tạo page bằng context.newPage(), thu pageerror và assert rỗng ở cuối; luôn đóng browser trong finally. Test chỉ chạy sau HOLD của môi trường tạm.
- [ ] Test Playwright bật missing menu → Chưa đủ điều kiện; chọn trạm → call ready; notes xoá hết → Lưu/reload vẫn []; preset preview không thay server; conflict hai trang giữ draft; guest alias và system link cùng tới editor.

```js
const expectText=async(page,selector,text)=>assert.match(await page.locator(selector).innerText(),new RegExp(text));
await page.goto(base+'/setup.html?tab=guest');
await page.waitForFunction(()=>typeof D!=='undefined' && D);
await page.evaluate(()=>{D.menu={cats:[],items:[]};setDirty(true);renderFeatures();});
await page.locator('[data-feat="order"]').check();
await page.locator('#save').click();
await page.waitForFunction(()=>!saving);
await expectText(page,'#features','Chưa đủ điều kiện');

```

- [ ] Thêm test strict booleans cho JSON import; không có toast lưu thành công giả sau reconnect. Chạy npm test và browser settings subset; commit `feat: expose restaurant feature settings and readiness` nếu được phép.

## Task 7: Robot/QR policies, hướng dẫn nhân viên và acknowledgements

**Files:** Modify `data/public/robot.html`, `table.html`, `station.html`, `common.js`; extend `scripts/smoke-feature-policy.js`.
**Consumes:** Request receipts và capabilities.

- [ ] Nạp policy bằng script UMD trước common trên cả ba trang. Thay feat call cũ bằng flag riêng; text “Yêu cầu tính tiền / Request the bill”. Giữ VI/EN và role controls.
- [ ] Return policy request dùng returnRequest; direct dùng cancelStop có why customer/table/mission/stop. Chỉ toast thành công sau event ok+requestId, error không reset giỏ hoặc selection. Tái dùng requestId cho retry, không sinh id mới mỗi reconnect.
- [ ] Bus toggle chỉ ẩn/khóa shortcut robot tạo mới; vẫn có nút confirm/receive/dỡ đồ. Guide đổi entry thành “Nhân viên: dẫn khách tới bàn”, chọn bàn rồi xác nhận; text không khẳng định bàn trống. Valetudo không có speed button/toast giả; simulator vẫn có.
- [ ] Thêm browser assertions thực tế:

```js
assert.equal(await robot.locator('[data-act="speed"]').count(),0); // fixture Valetudo guiding
await guest.locator('[data-act="returnRequest"]').click();
await station.waitForFunction(()=>App.state.alerts.some(a=>a.key.startsWith('return-')));
assert.equal(await guest.evaluate(()=>App.state.missions[0].status),'active');
```

- [ ] Fixtures browser dùng server test site có/không flags và driver riêng; không chỉ inject CSS. Giữ case retarget/QR cũ, newest locked cancelTarget, stable cancel button khi ETA đổi, notes từ config.
- [ ] Tắt order khi cart mở: giữ cart, disable submit và giải thích; bật lại tiếp tục dùng cart sau validation menu mới. Tắt guide khi đang dẫn: vẫn hoàn thành chuyến. Chạy npm test và browser subset; commit `feat: apply restaurant policy across guest and robot screens` nếu được phép.

## Task 8: Station billing workflow và màn QR theo phiếu

**Files:** Modify `data/public/station.html`, `robot.html`, `table.html`, `common.js`; extend `scripts/smoke-feature-policy.js`, `scripts/test-guest-policy.js`.
**Consumes:** Billing commands/state.bills/receipts, không dùng call paid cũ.

- [ ] Station thêm vùng Yêu cầu & tính tiền: xem đơn chưa đóng kể cả sau ack; chuẩn bị phiếu từ current orderIds + tổng tham khảo, input total/note, xác nhận “Đã đối chiếu toàn bộ khoản phải thu”. Với bàn không có đơn robot, cho nhập tổng/mô tả nguồn đã đối chiếu.
- [ ] Tách nút “Đã nhận yêu cầu”, “Xác nhận đã thu tiền”, “Đóng lượt tính tiền”, “Vô hiệu hóa phiếu”. Settle/void/close xác nhận hai bước và disable pending request. Render theo bill.status, không theo cảnh báo còn/đã ack.
- [ ] Robot pay dùng bill ID/rev/snapshot/total server; không cộng order lại. Claim gửi billClaim. Không cho chuyển khoản lại khi claimed; settled hiển thị đã xác nhận. Nút gọi nhân viên chỉ xuất hiện nếu callStaff effective; hỗ trợ payment không phụ thuộc callStaff.

```js
send({type:'billClaim',bill:b.id,rev:b.rev,requestId:pendingId,by:guestLabel});
// Do not set local status to paid. The correlated event/state determines the next view.
```

- [ ] Test browser: station prepare → QR đúng tổng → guest claim → station ack giữ orders → staff settle → close; total=0 không QR; stale bill/rev bị từ chối; QR network error fallback; tắt pay giữa màn vẫn gửi claim phiếu đã mở; chỉnh bank khi prepared bị chặn.
- [ ] Test concurrency: hai station prepare cùng orderIds chỉ một thắng; double settle/close sau reload không ghi hai lần; order trong lúc bill mở có error rõ; close không nuốt chuyến còn phục vụ bàn.
- [ ] Chạy npm test + browser billing subset; commit `feat: separate billing acknowledgement settlement and closure` nếu được phép.

## Task 9: Export, demo persistence và tài liệu

**Files:** Modify `scripts/export-web.sh`, `../web/demo/transport.js`, `../web/demo/index.html`, `../web/demo.html`, `../web/README.md`, `docs/valetudo-setup.md`, `docs/testing.md`, `data/site.json`, `data/site.demo.json`.
**Consumes:** Modules hoàn chỉnh Tasks 1–8.

- [ ] Viết seeds v2: production dùng defaults spec §4, demo bật đủ sáu flags với requestStation trạm hiện có và customerCancel=request. Viết fixture legacy riêng trong test để vẫn kiểm tra nâng cấp; đổi fixtures huỷ trực tiếp sang customerCancel=direct một cách rõ ràng, không đổi kỳ vọng test retarget-safe cancel. Chạy toàn bộ suite sau đổi seed.
- [ ] Export hai module mới trong cp list; thêm browser script policy vào các trang nguồn trước export. Demo loader thêm dependency đúng thứ tự:

```js
const policy=await load('lib/feature-policy.js');
const siteLib=await load('lib/site.js',{'./feature-policy':policy});
const billing=await load('lib/billing.js');
const O=await load('lib/orchestrator.js',{
  './route':route,'./site':siteLib,'./feature-policy':policy,'./billing':billing
});
```

- [ ] Demo normalize legacy custom config trước khi đưa tới engine, Billing.init với persisted st; giữ fingerprints/shape validation từ main. Đổi seed có thể reset demo theo cơ chế đã có, ghi rõ trên demo; không lấy cơ chế reset này áp production.
- [ ] Demo kịch bản tính tiền có bước nhân viên xác nhận phiếu và tiền vào; bỏ copy hứa robot tự xác nhận tiền/Valetudo đi chậm. Bổ sung đường vào Tính năng từ Hệ thống.
- [ ] Run `npm run web`; byte-compare shared files và modules. Chạy `node scripts/smoke-web.js` với static server; test các feature defaults khác nhau trong hai browser context độc lập.
- [ ] Cập nhật docs: requestStation, policies, migration, limits, manual bank verification, cleanup 30 ngày, config version compatibility và runtime restart procedure. Không sửa plan phase2 cũ như thể nó chưa được thực hiện; thêm link spec mới.
- [ ] Commit riêng trial/web nếu được phép; không push/deploy chỉ vì export thành công.

## Task 10: Nghiệm thu, review và phát hành có kiểm soát

**Files:** Update `docs/testing.md` với ma trận kết quả khi thực thi; sửa đúng file bị lỗi nếu test phát hiện.

- [ ] Chạy `npm test`: đầy đủ scenarios cũ + policy/billing/guest-policy. Không bỏ test để đạt xanh; cập nhật test cũ chỉ khi spec thay contract (ack, guest cancel defaults, cleanup).
- [ ] `node scripts/smoke-review.js`: MQTT thêm robot/redeploy/topic map, alerts demo và live delivery đều phải còn đạt.
- [ ] `SMOKE_HOLD=1 node scripts/smoke-review.js`, đợi HOLD, chạy static server 1892. `node scripts/smoke-feature-policy.js` và các smoke-browser/smoke-web hiện có với PLAYWRIGHT_MODULE/PLAYWRIGHT_CHROMIUM nếu dùng browser ngoài repo.
- [ ] Browser matrix: 1280×800, 800×1280, 390px; VI/EN; mỗi preset; flags riêng lẻ; mixed drivers; disconnect lúc save/request; restart sau prepare/claim/settle; tắt từng feature giữa luồng. Ghi giới hạn: hardware Valetudo thật chưa được xác minh nếu chỉ dùng fake robot.
- [ ] Chạy `npm run pack`, `git diff --check`; scan conflict markers. Kiểm tra gói có feature-policy.js/billing.js và không thiếu scripts tải browser.
- [ ] Review theo A01–A12; với billing đặc biệt tìm thao tác filter theo table làm mất đơn, amount từ client, status tự paid và cleanup open orders. Mọi lỗi quan trọng phải sửa và test lại trước phát hành.
- [ ] Trước nâng cấp production: export config, sao lưu persisted context khi process đã dừng; nâng core + UI cùng phiên bản, reload tablet. Không chạy code version cũ trên persisted billing state mới; rollback bằng snapshot trước nâng cấp với cửa sổ dừng vận hành, tránh mất giao dịch mới.
- [ ] Nếu được yêu cầu commit/push: hai repo cùng branch triển khai, kiểm tra upstream trước push; xác nhận working tree sạch và báo SHA, phạm vi test, giới hạn phần cứng. Không đụng branch main hoặc dịch vụ đang chạy ngoài yêu cầu.

## Ma trận traceability và tự review

| Spec | Tasks |
|---|---|
| F01/F02 giữ retarget và ngôn ngữ | 5, 7, 10 |
| F03 notes rỗng, không hứa chỉ dẫn chế biến | 2, 6, 9 |
| F04 busRobot độc lập trạm | 2, 5, 7 |
| F05 return request/direct | 2, 5, 7 |
| F06/F07 tách calls + routing | 2, 5–7 |
| F08 guide/capability | 2, 5, 7, 9 |
| F09 order readiness/đơn tồn | 2, 4–7 |
| F10 billing/QR | 1, 3, 4, 8 |
| Migration/presets/version/save | 2, 4, 6, 9 |
| Feature-off lifecycle | 4, 5, 7, 8, 10 |
| UI/editor/system/VI-EN/layout | 6–10 |
| Truy vết/retention/restart/export | 3, 4, 9, 10 |

Trước khi bàn giao plan: xác minh tên flag/message/file nhất quán với spec, không thiếu consumer của schema mới, không có bước thực thi vô tình reset production. Tài liệu hiện tại chưa đánh dấu task nào đã làm.
