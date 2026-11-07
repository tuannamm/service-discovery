# KNOWLEDGE: Kiến thức học được từ Service Discovery

> File theo dõi kiến thức để ôn phỏng vấn. Cập nhật sau mỗi phần trong [PLAN.md](./PLAN.md).
> Phần discovery phía gateway (client-side, cache, snapshot) xem thêm `apps/api-gateway/documents/KNOWLEDGE.md` mục 7, 8, 16.
> Quy ước trạng thái: ✅ đã học và đã làm · 📖 đã học lý thuyết, chưa code · ⬜ chưa học

## Cách dùng file này

1. Sau mỗi phần build, điền mục **"Tự trả lời"** bằng lời của bạn (3-5 dòng). Đó là câu trả lời phỏng vấn thật.
2. Đổi trạng thái trong bảng tiến độ.
3. Ghi lại cái bẫy hoặc lỗi đã gặp ở mục **"Bẫy thực tế"**.

---

## Bảng tiến độ

| # | Chủ đề | Phần PLAN | Trạng thái |
|---|---|---|---|
| 0 | **Giới thiệu registry trong 2 phút** | - | 📖 (tự viết) |
| 1 | Service discovery là gì, vì sao cần | - | ✅ |
| 2 | Client-side vs server-side discovery | 3 | ✅ client-side (gateway poll) |
| 3 | Self-registration vs third-party registration | 2 | ✅ self-registration |
| 4 | Lease, heartbeat, TTL | 1, 2 | ✅ |
| 5 | Soft state và heartbeat idempotent | 1 | ✅ (đã thử restart registry) |
| 6 | Phát hiện instance chết: chủ động vs thụ động | 1 | ✅ thụ động (TTL); 📖 health check chủ động |
| 7 | Monotonic clock vs wall clock | 1 | ✅ |
| 8 | Phiên bản, ETag, 304 và `bootId` | 1, 3 | ✅ |
| 9 | Capability-based discovery và xung đột pattern | 1 | ✅ |
| 10 | Thiết kế REST cho registry (PUT idempotent, mã lỗi) | 1 | ✅ |
| 11 | CAP: registry nên AP hay CP | - | ✅ AP ở phía client; 📖 nhiều node |
| 12 | Self-preservation | - | 📖 (ngoài phạm vi) |
| 13 | Registry nhiều node: gossip vs Raft | - | 📖 (ngoài phạm vi) |
| 14 | Advertise address (`0.0.0.0`, Docker, NAT) | 2 | ✅ |
| 15 | Graceful shutdown và deregister | 2 | ✅ |
| 16 | So sánh sản phẩm: Consul, Eureka, etcd, Kubernetes | - | 📖 |
| 17 | Test logic phụ thuộc thời gian (clock tiêm vào) | 1 | ✅ |
| 18 | Bảo mật registry | 1 | ✅ token + constant-time; 📖 mTLS/ACL |
| 19 | Hết hạn lazy + quét định kỳ | 1 | ✅ |
| 20 | Polling: `setTimeout` nối tiếp vs `setInterval` | 2, 3 | ✅ |
| 21 | Log theo chuyển trạng thái (tránh log ngập) | 2, 3 | ✅ |
| 22 | Thu thập `@MessagePattern` bằng metadata (reflection) | 2 | ✅ |
| 23 | Stale-on-error và atomic swap ở gateway | 3 | ✅ |
| 24 | Kiểm chứng chạy thật: số đo và đọc log | 1-3 | ✅ |
| 25 | Health thụ động từ heartbeat (healthy / late) | UI | ✅ |
| 26 | Stored XSS, escape HTML và CSP có nonce | UI | ✅ |
| 27 | Server render + cập nhật từng phần (partial) | UI | ✅ |
| 28 | Registry riêng cho mỗi project hay dùng chung (multi-tenancy) | 10d | ✅ |
| 29 | Đóng gói code dùng chung trong monorepo (lib, peerDependencies, CJS/ESM, env lazy) | 10e | ✅ |

---|---|---|---|
| 1 | Service discovery là gì, vì sao cần | - | 📖 |
| 2 | Client-side vs server-side discovery | 3 | 📖 |
| 3 | Self-registration vs third-party registration | 2 | 📖 |
| 4 | Lease, heartbeat, TTL | 1, 2 | 📖 |
| 5 | Soft state và heartbeat idempotent | 1 | 📖 |
| 6 | Phát hiện instance chết: chủ động vs thụ động | 1 | 📖 |
| 7 | Monotonic clock vs wall clock | 1 | 📖 |
| 8 | Phiên bản, ETag, 304 và `bootId` | 1, 3 | 📖 |
| 9 | Capability-based discovery và xung đột pattern | 1 | 📖 |
| 10 | Thiết kế REST cho registry (PUT idempotent, mã lỗi) | 1 | 📖 |
| 11 | CAP: registry nên AP hay CP | - | 📖 |
| 12 | Self-preservation | - | 📖 (ngoài phạm vi) |
| 13 | Registry nhiều node: gossip vs Raft | - | 📖 (ngoài phạm vi) |
| 14 | Advertise address (`0.0.0.0`, Docker, NAT) | 2 | 📖 |
| 15 | Graceful shutdown và deregister | 2 | 📖 |
| 16 | So sánh sản phẩm: Consul, Eureka, etcd, Kubernetes | - | 📖 |
| 17 | Test logic phụ thuộc thời gian (clock tiêm vào) | 1 | 📖 |
| 18 | Bảo mật registry | 1 | 📖 |

---

## 0. Giới thiệu registry trong 2 phút

Khung trả lời (tự viết lại bằng lời mình, canh 2 phút):

1. **Bối cảnh (15s):** gateway dịch HTTP → TCP RPC, cần biết "pattern X do instance nào xử lý". File tĩnh thì thêm/bớt instance phải restart, instance chết vẫn bị chọn.
2. **Thiết kế (45s):**
   - Service **tự đăng ký** kèm danh sách `@MessagePattern` (tự quét bằng metadata NestJS), giữ chỗ bằng **heartbeat = PUT lại đầy đủ** mỗi TTL/3.
   - Registry **in-memory, soft state**: restart thì heartbeat kế tiếp tự khôi phục. Lease TTL gỡ instance crash.
   - Gateway **poll snapshot + ETag** mỗi 3s, data plane chỉ đọc RAM; registry chết thì dùng bảng cũ (**AP**).
3. **Chi tiết đáng kể (40s), chọn 2:**
   - ETag kèm **`bootId`**: registry restart, version đếm lại nhưng ETag không trùng.
   - TTL đo bằng **monotonic clock**, không bị NTP chỉnh giờ làm gỡ oan.
   - **Một pattern một service**: kiểm tra xung đột xong mới ghi (409, không ghi nửa vời).
   - Hết hạn **lazy + quét định kỳ** như Redis.
4. **Kết quả (20s):** chạy thật 2 echo + gateway: SIGKILL bị gỡ sau ~5s (TTL 6s), SIGTERM gỡ ngay, tắt registry gateway vẫn trả 200, bật lại tự phục hồi.

**Tự viết:**
> _(viết bài 2 phút của bạn ở đây)_

---

## 1. Service discovery là gì, vì sao cần

**Tóm tắt:** Cơ chế để một thành phần tìm được **địa chỉ hiện tại** của service khác. Trong microservices, địa chỉ thay đổi liên tục: scale lên/xuống, deploy, crash, IP động trong container.

**Ba mảnh ghép:**
- **Registry:** cơ sở dữ liệu "service nào, instance nào, ở đâu, còn sống không".
- **Đăng ký:** cách instance vào/ra registry.
- **Tra cứu:** cách bên gọi lấy danh sách instance.

**Trong dự án:** registry riêng (`apps/service-discovery`), tra theo **pattern** (`@MessagePattern`). **Một registry phục vụ một project application** nên không có khái niệm project trong registry (chạy nhiều project = chạy nhiều registry). Gateway là bên tra cứu duy nhất ở thời điểm này.

**Câu hỏi phỏng vấn**
- Vì sao không cấu hình cứng IP của service?
- DNS có phải service discovery không? Hạn chế của DNS (TTL cache, không có port, không có health)?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 2. Client-side vs server-side discovery

| | Client-side | Server-side |
|---|---|---|
| Ai hỏi registry | Bên gọi (gateway) | Load balancer / router |
| Ai chọn instance | Bên gọi | Load balancer |
| Ưu | Ít hop, bên gọi tự chọn thuật toán LB | Bên gọi đơn giản, không phụ thuộc ngôn ngữ |
| Nhược | Logic discovery phải có ở mọi client | Thêm một thành phần, thêm một hop |
| Ví dụ | Netflix Eureka + Ribbon | AWS ALB, Kubernetes Service (kube-proxy) |

**Trong dự án:** **client-side**: gateway poll snapshot, tự round-robin. Chỉ có gateway gọi service (qua TCP), nên logic chỉ nằm ở một chỗ.

**Câu hỏi phỏng vấn**
- Kubernetes Service là kiểu nào? (Server-side: ClusterIP + kube-proxy.)
- Khi nào bạn chọn client-side?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 3. Self-registration vs third-party registration

- **Self-registration:** service tự gọi registry để đăng ký, heartbeat, huỷ đăng ký. Đơn giản, nhưng code đăng ký phải có trong mọi service. Giải pháp: gom thành **một thư viện dùng chung** (dự án: `@org/service-discovery-client`, xem #29).
- **Third-party registration:** một "registrar" bên ngoài theo dõi môi trường (Docker events, Kubernetes API) rồi đăng ký thay. Service không biết gì về registry.

**Trong dự án:** self-registration qua thư viện `libs/service-discovery-client` (service chỉ import `ServiceDiscoveryModule`), vì service phải tự khai báo **danh sách pattern** (chỉ service biết nó có `@MessagePattern` nào). Registrar bên ngoài không đọc được thông tin này.

**Câu hỏi phỏng vấn**
- Đánh đổi giữa hai cách?
- Kubernetes dùng kiểu nào? (Third-party: kubelet + endpoints controller.)

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 4. Lease, heartbeat, TTL

**Tóm tắt:** Mỗi lần đăng ký là một **hợp đồng thuê (lease)** có hạn TTL. Service phải **gia hạn** bằng heartbeat trước khi hết hạn; không gia hạn thì registry gỡ.

**Con số trong dự án:** TTL 15s, heartbeat 5s (= TTL/3), sweep 5s.
- Heartbeat = TTL/3 → lỡ **2 nhịp** (mạng chập chờn, GC pause) vẫn chưa bị gỡ.
- Instance chết bị gỡ **ngay khi hết TTL** nếu có ai hỏi tới (hết hạn lazy, xem #19); gateway poll mỗi 3s nên thấy sau tối đa `TTL + poll` ≈ 18s. Sweep (TTL/3) chỉ dọn khi không ai hỏi.
- Registry **trả** `heartbeatIntervalMs` trong response của PUT → registry quyết định nhịp, đổi TTL không phải sửa client.

**Đánh đổi:** TTL ngắn → phát hiện chết nhanh nhưng dễ gỡ oan + nhiều tải heartbeat. TTL dài → ngược lại.

**Câu hỏi phỏng vấn**
- Chọn TTL và chu kỳ heartbeat thế nào?
- Vì sao heartbeat không bằng TTL?
- Instance chết thì sau bao lâu request ngừng tới nó? Tính đủ các độ trễ.

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 5. Soft state và heartbeat idempotent

**Soft state:** trạng thái **tự làm mới** từ nguồn bên ngoài; mất đi cũng tự hồi phục. Ngược lại là **hard state** (mất là mất, cần lưu bền).

**Trong dự án:** heartbeat **không** phải lệnh "ping" riêng, mà là **gọi lại PUT với đủ dữ liệu**.
- Registry restart, mất sạch RAM → trong vòng một nhịp heartbeat (5s), mọi service đăng ký lại đầy đủ.
- Vì vậy lưu **in-memory là đủ**, không cần database. Eureka cũng làm vậy.
- PUT là **idempotent**: gọi 1 lần hay 100 lần với cùng body cho cùng kết quả → retry an toàn.

Nếu tách `register` + `ping`: registry restart xong, `ping` của service trả 404, service phải có thêm logic "404 thì đăng ký lại" → phức tạp hơn và dễ sai.

**Câu hỏi phỏng vấn**
- Vì sao registry của bạn không cần database?
- PUT vs POST cho đăng ký? Idempotent nghĩa là gì?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 6. Phát hiện instance chết: chủ động vs thụ động

| | Thụ động (heartbeat/TTL) | Chủ động (health check) |
|---|---|---|
| Ai khởi động | Service gửi lên | Registry gọi xuống `/health` |
| Phát hiện | "Còn sống" (process chạy, gửi được) | "Còn khoẻ" (DB kết nối được, ...) nếu health check sâu |
| Chi phí | Rẻ, registry không cần kết nối tới service | Registry phải gọi được tới mọi instance |
| Ví dụ | Eureka, dự án này | Consul (cả hai), Kubernetes liveness/readiness |

Ngoài ra còn **phát hiện thụ động ở phía bên gọi** (outlier detection: gateway thấy instance lỗi liên tục thì tạm loại). Dự án để ở Bước 5 của gateway.

**Hạn chế của heartbeat:** process còn chạy, heartbeat vẫn gửi, nhưng service không xử lý được request (deadlock, mất DB). Registry vẫn coi là sống.

**Câu hỏi phỏng vấn**
- Liveness vs readiness khác nhau thế nào?
- Heartbeat vẫn đến nhưng service hỏng thì sao?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 7. Monotonic clock vs wall clock

- **Wall clock** (`Date.now()`): giờ thực, có thể **nhảy lùi/tới** khi NTP chỉnh giờ hoặc ai đó đổi giờ hệ thống.
- **Monotonic clock** (`performance.now()`, `process.hrtime`): chỉ tăng, không gắn với giờ thực. Dùng để **đo khoảng thời gian**.

**Trong dự án:** `lastSeen` và tính TTL dùng monotonic; `registeredAt` (hiển thị) dùng wall clock.
- Giờ nhảy tới 1 phút với wall clock → mọi instance bị gỡ oan cùng lúc.
- Giờ nhảy lùi → instance chết sống thêm.

**Thêm:** registry **không tin** thời gian do service gửi lên (đồng hồ các máy lệch nhau, gọi là *clock skew*). `lastSeen` là lúc **registry nhận** heartbeat.

**Câu hỏi phỏng vấn**
- Tính timeout/TTL bằng `Date.now()` có vấn đề gì?
- Clock skew giữa các máy ảnh hưởng gì tới hệ phân tán?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 8. Phiên bản, ETag, 304 và `bootId`

**Cơ chế:** registry có một `version`, **chỉ tăng khi bảng đổi** (thêm/gỡ/đổi instance). Heartbeat thuần không tăng.
- Registry gửi `ETag: "<bootId>-<version>"`.
- Gateway gửi lại `If-None-Match` ở lần poll kế. Khớp → **304 Not Modified**, không có body.
- Phần lớn lần poll chỉ tốn một response rỗng.

**Vì sao cần `bootId`** (UUID sinh lúc registry khởi động):
1. Gateway đang giữ snapshot `version = 3` (gồm echo-1, echo-2).
2. Registry restart, đếm lại từ 0. Chỉ echo-1 đăng ký lại kịp, rồi thêm user-1, ... tình cờ lại tới `version = 3` với nội dung khác.
3. Gateway gửi `If-None-Match: "3"` → registry trả 304 → gateway **giữ bảng sai mãi**.

Có `bootId` thì ETag sau restart chắc chắn khác. Ý tưởng giống **epoch / generation number** trong hệ phân tán.

**Câu hỏi phỏng vấn**
- ETag hoạt động thế nào? Strong vs weak ETag?
- Bộ đếm phiên bản reset thì có vấn đề gì? Giải pháp?
- Polling + ETag so với long-polling / watch?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 9. Capability-based discovery và xung đột pattern

**Tóm tắt:** tìm theo **việc làm được** (pattern) thay vì **tên service**. Spec của gateway chỉ có `operationId`, không ghi tên service.

**Quy tắc:** một pattern chỉ thuộc **một service** trong toàn registry; nhiều **instance** của cùng service giữ cùng pattern là bình thường (đó là scale ngang).
- Xung đột → 409, **không ghi gì** (kiểm tra hết rồi mới ghi, tránh trạng thái nửa vời).
- Pattern được giải phóng khi instance cuối của service chủ bị gỡ.

**Chuyển pattern từ service A sang service B** (tách service): phải gỡ hết instance A đang giữ pattern trước (deploy A bản mới không còn pattern đó), rồi B mới đăng ký được. Đây là đánh đổi của quy tắc "một chủ".

**Vì sao không cho hai service cùng giữ:** gateway không biết gửi cho ai; nếu round-robin giữa hai service khác nhau thì cùng một API trả kết quả khác nhau tuỳ lần gọi.

**Câu hỏi phỏng vấn**
- Ưu/nhược của tra theo pattern so với theo tên service?
- Hai team vô tình dùng cùng tên pattern thì hệ thống phản ứng thế nào?
- Blue/green deploy với quy tắc này thế nào? (Cùng tên service thì không xung đột.)

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 10. Thiết kế REST cho registry

| Lựa chọn | Lý do |
|---|---|
| `PUT /instances/:id` (client chọn id) | Idempotent, heartbeat = PUT lại |
| `DELETE` trả 204 kể cả khi không tồn tại | Idempotent; service tắt có thể gọi nhiều lần |
| 409 cho xung đột pattern | Request hợp lệ nhưng xung đột với trạng thái hiện tại |
| 400 gom mọi lỗi validate | Client sửa một lần, không phải thử từng lỗi |
| Snapshot rỗng → 200 `instances: []` | "Chưa ai đăng ký" là trạng thái hợp lệ, không phải "không tìm thấy" |
| Prefix `/v1` | Chừa chỗ đổi hợp đồng sau |
| Lỗi RFC 9457 | Thống nhất với gateway |

**Câu hỏi phỏng vấn**
- 400 vs 409 vs 422 khác nhau thế nào?
- Vì sao DELETE tài nguyên không tồn tại vẫn trả 204?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 11. CAP: registry nên AP hay CP

**CAP:** khi có **network partition**, hệ phân tán phải chọn giữa **Consistency** (mọi node trả cùng dữ liệu mới nhất, hoặc từ chối) và **Availability** (luôn trả lời, có thể dữ liệu cũ).

| | AP | CP |
|---|---|---|
| Sản phẩm | Eureka | ZooKeeper, etcd, Consul (mặc định) |
| Khi partition | Vẫn trả danh sách (có thể cũ) | Phía thiểu số từ chối trả lời |

**Với service discovery, AP thường hợp lý hơn:** danh sách hơi cũ (có một instance đã chết) vẫn tốt hơn **không có danh sách** (mọi request 503). Instance chết đã có failover/retry ở gateway cứu.

**Trong dự án:** AP ở mọi tầng:
- Registry chết → gateway dùng snapshot cũ (stale-on-error).
- Registry chết → service vẫn chạy, tiếp tục thử heartbeat.
- Gateway khởi động khi registry chết → vẫn mở cổng (503) và tự phục hồi.

Registry hiện chỉ một node nên CAP chưa thật sự áp dụng bên trong nó; AP thể hiện ở cách **các client** xử lý khi registry không trả lời.

**Câu hỏi phỏng vấn**
- Registry nên AP hay CP? Vì sao?
- Eureka và ZooKeeper khác nhau thế nào khi mất mạng?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 12. Self-preservation (ngoài phạm vi)

**Vấn đề:** registry mất kết nối mạng với **nhiều** service cùng lúc → heartbeat ngừng hàng loạt → registry gỡ hết → gateway nhận bảng rỗng → toàn hệ thống 503, dù service vẫn sống.

**Eureka giải quyết:** nếu số heartbeat nhận được tụt dưới ngưỡng (VD 85% kỳ vọng), registry **ngừng gỡ** instance, vì nghi là lỗi mạng phía registry chứ không phải service chết.

**Đánh đổi:** trong chế độ này, instance chết thật cũng không bị gỡ → bên gọi phải tự chịu bằng retry/circuit breaker.

**Câu hỏi phỏng vấn**
- Mất heartbeat hàng loạt thì registry nên làm gì?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 13. Registry nhiều node: gossip vs Raft (ngoài phạm vi)

Một node registry là **single point of failure** (dự án giảm nhẹ nhờ stale-on-error). Muốn nhiều node phải đồng bộ dữ liệu:

| | Gossip / peer replication | Đồng thuận (Raft, Paxos) |
|---|---|---|
| Ý tưởng | Node gửi thay đổi cho nhau, cuối cùng nhất quán | Leader ghi, đa số (quorum) xác nhận mới tính |
| Nhất quán | Eventual | Strong |
| Ví dụ | Eureka (peer), Consul (membership qua Serf) | etcd, Consul (catalog), ZooKeeper (ZAB) |
| Thuộc | AP | CP |

**Câu hỏi phỏng vấn**
- Làm registry chịu lỗi thế nào?
- Quorum là gì? Vì sao cluster Raft nên có số node lẻ?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 14. Advertise address

- Service **lắng nghe** `0.0.0.0` (mọi card mạng) là bình thường.
- Nhưng nó phải **quảng bá** địa chỉ mà **bên khác dùng để gọi tới**. Đăng ký `0.0.0.0` → gateway kết nối tới `0.0.0.0` → thất bại.
- Trong Docker: tên service/container hoặc IP mạng nội bộ. Sau NAT: địa chỉ ngoài.
- Dự án: mặc định **tự phát hiện** IPv4 đầu tiên không phải loopback (chạy được local, Docker, K8s) và in ra log; ghi đè bằng `SERVICE_ADVERTISE_HOST`. Máy có VPN/nhiều card mạng có thể chọn nhầm nên cần đặt tay. Module và registry đều **từ chối** `0.0.0.0` và `::`.

**Câu hỏi phỏng vấn**
- Bind address và advertise address khác nhau thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 15. Graceful shutdown và deregister

| Cách tắt | Registry biết khi nào | Gateway ngừng gửi sau |
|---|---|---|
| Tắt êm (SIGTERM) → `DELETE` | Ngay | ≤ 1 chu kỳ poll (3s) |
| Crash / SIGKILL | Khi hết TTL (lazy khi gateway hỏi) | ≈ TTL + poll (~18s) |

- Deregister là **best effort**: lỗi cũng không chặn service tắt.
- **Chỉ đăng ký khi cổng đã nhận kết nối:** với microservice, `app.listen()` chạy *sau* hook `onApplicationBootstrap`, nên đăng ký ngay ở hook đó là quảng bá một cổng chưa mở. Module chạy nền ở hook đó và **thăm dò TCP tới đúng `advertiseHost:PORT`** (khoảng nghỉ 250ms, nhân đôi tới 2s) rồi mới đăng ký; sau 10s mà vẫn chưa kết nối được thì cảnh báo (nhưng không đăng ký bừa). Thăm dò đúng địa chỉ sẽ quảng bá nên còn bắt được lỗi cấu hình sai `PORT` hoặc host (ý tưởng của **readiness**). Bản đầu để `main.ts` gọi `start()` sau `listen()`; bản lib bỏ bước đó.
- **Thứ tự tắt của NestJS khi nhận SIGTERM:** `onModuleDestroy` → **`beforeApplicationShutdown`** → `dispose` (đóng cổng TCP) → `onApplicationShutdown`. Dự án gọi `DELETE` ở `beforeApplicationShutdown`, tức **trước** khi đóng cổng: gateway thôi gửi request mới trong lúc service còn xử lý nốt.
- Thứ tự đúng khi tắt: deregister → chờ một chút để gateway cập nhật → đóng listener → xử lý nốt request đang chạy (*draining*).
- Timer heartbeat phải `unref()`, nếu không process không thoát được.

**Câu hỏi phỏng vấn**
- Graceful shutdown của một microservice gồm những bước nào?
- Vì sao vẫn cần TTL khi đã có deregister?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 16. So sánh sản phẩm

| | Eureka | Consul | etcd | Kubernetes |
|---|---|---|---|---|
| CAP | AP | CP (catalog) | CP | CP (etcd bên dưới) |
| Đăng ký | Self | Self / agent | Self (lease) | Third-party (kubelet) |
| Phát hiện chết | Heartbeat | Health check + gossip | Lease TTL | Liveness/readiness probe |
| Tra cứu | HTTP, client cache | DNS + HTTP | gRPC watch | DNS (CoreDNS) + kube-proxy |
| Đổi được báo bằng | Poll delta | Blocking query (long-poll) | Watch stream | Watch API |

**Dự án giống nhất:** Eureka (self-registration, heartbeat, in-memory, AP, client poll) + lease của etcd.

**Câu hỏi phỏng vấn**
- Nếu chạy trên Kubernetes thì registry của bạn còn cần không? (Thường không cần cho tra theo tên; nhưng tra theo **pattern** thì K8s không có sẵn.)

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 17. Test logic phụ thuộc thời gian

- **Không** `sleep(15000)` trong test: chậm và dễ flaky.
- Tiêm **`Clock`** vào `RegistryStore`; test dùng `FakeClock` có `advance(ms)`.
- Timer (`setInterval` của sweeper) tách khỏi logic: core chỉ có `sweep()`; lớp NestJS lo gọi định kỳ. Test core gọi `sweep()` trực tiếp.
- Với code có timer thật (client heartbeat): `vi.useFakeTimers()`.

Đây là **Dependency Injection** cho thứ không xác định (thời gian, random, mạng) → test xác định.

**Câu hỏi phỏng vấn**
- Test logic TTL/timeout thế nào?
- Vì sao tách core khỏi framework?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 18. Bảo mật registry

- Ai ghi được vào registry là **điều hướng được traffic**: đăng ký instance giả giữ pattern `auth.login` → nhận mật khẩu người dùng. Đây là rủi ro lớn nhất.
- Dự án: registry chỉ mở trong **mạng nội bộ** + `REGISTRY_TOKEN` cho `PUT`/`DELETE` + validate chặt + giới hạn body.
- Quy tắc "một pattern một service" cũng chặn một phần (không chiếm được pattern đang có chủ).
- Thực tế hơn: **mTLS** (service chứng minh danh tính bằng cert), ACL theo service (Consul ACL), token riêng từng service.
- So sánh token bằng **constant-time** (`crypto.timingSafeEqual`) để tránh timing attack.

**Câu hỏi phỏng vấn**
- Kẻ tấn công ghi được vào registry thì làm được gì?
- Bảo vệ registry thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 19. Hết hạn lazy + quét định kỳ

**Vấn đề:** nếu chỉ có sweeper chạy mỗi 5s, giữa hai lần quét registry vẫn trả về instance đã hết hạn, và instance đã chết vẫn **giữ pattern** (service khác đăng ký pattern đó bị 409 oan).

**Cách làm (giống Redis xử lý key có TTL):**
- **Lazy:** mọi thao tác (`register`, `snapshot`, `overview`) gỡ instance hết hạn **trước**. Kết quả luôn đúng tại thời điểm gọi.
- **Định kỳ:** `SweeperService` gọi `sweep()` mỗi TTL/3 để dọn khi không ai hỏi tới (giải phóng RAM) và để log "expired" đúng lúc.
- Log nằm ở hook `onExpire` của store, nên gỡ kiểu nào cũng có log.
- Timer nằm ở lớp NestJS, **core không có timer**: test gọi `sweep()` trực tiếp, không cần fake timer.

**Thêm: version không bao giờ lùi.** Registry hết instance thì version vẫn giữ nguyên (chỉ tăng), không về 0 trong một lần chạy, vì version lùi thì ETag cũ có thể trùng bảng mới.

**Câu hỏi phỏng vấn**
- Redis xoá key hết hạn thế nào? (Lazy khi truy cập + quét ngẫu nhiên định kỳ.)
- Chỉ dùng sweeper định kỳ có vấn đề gì?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 20. Polling: `setTimeout` nối tiếp vs `setInterval`

- `setInterval(fn, 3000)` gọi fn mỗi 3s **bất kể lần trước xong chưa**. Registry chậm 5s → các request chồng lên nhau, response về lộn thứ tự (bảng cũ ghi đè bảng mới).
- **`setTimeout` nối tiếp:** xong lần này mới hẹn lần sau (`refresh().finally(schedule)`). Không bao giờ chồng; nhịp tự giãn khi bên kia chậm.
- Client heartbeat còn dùng nhịp **mới nhất registry trả về** (`heartbeatIntervalMs`), điều chỉnh được giữa chừng.
- Mọi timer đều `unref()`: không giữ process sống.
- Mỗi lần gọi có **timeout** (`AbortSignal.timeout(2000)`): registry treo không làm vòng poll treo theo.

**Câu hỏi phỏng vấn**
- Vì sao không dùng `setInterval` để poll qua mạng?
- `unref()` làm gì?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 21. Log theo chuyển trạng thái (tránh log ngập)

Heartbeat mỗi 5s × nhiều instance, poll mỗi 3s × nhiều gateway: log mỗi lần là ngập.

- **Registry:** không log heartbeat thuần (`renewed`); chỉ log `created`, `updated`, `deregistered`, `expired`.
- **Client / gateway:** giữ trạng thái (`registered` / `unreachable` / `rejected`) và **chỉ log khi trạng thái đổi**: "unreachable" một lần, "reachable again" một lần. Đây là kiểu **edge-triggered** (theo cạnh) thay vì **level-triggered** (theo mức).
- Mức log theo ý nghĩa: registry chết = `warn` (tự hồi phục), 409/400/401 = `error` (cần người sửa cấu hình).

**Câu hỏi phỏng vấn**
- Thiết kế log cho một vòng lặp chạy mỗi vài giây thế nào?
- Khi nào log `warn`, khi nào `error`?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 22. Thu thập `@MessagePattern` bằng metadata (reflection)

- Decorator TypeScript chạy lúc định nghĩa class; `@MessagePattern('x')` ghi **metadata** lên method bằng `Reflect.defineMetadata`:
  - `microservices:pattern` = `['x']` (luôn là mảng)
  - `microservices:handler_type` = `1` (MESSAGE) hoặc `2` (EVENT)
- `DiscoveryService.getControllers()` cho mọi controller; `MetadataScanner.getAllMethodNames()` cho mọi method; `Reflect.getMetadata(...)` đọc lại.
- Bỏ `@EventPattern` (event đi RabbitMQ, gateway không gửi tới) và pattern dạng object (`{ cmd: 'x' }`, operationId là string).
- Lợi ích: danh sách pattern **không thể lệch** với code; thêm handler là tự đăng ký.

**Câu hỏi phỏng vấn**
- Decorator trong TypeScript hoạt động thế nào? Metadata lưu ở đâu?
- NestJS biết route/handler của bạn bằng cách nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 23. Stale-on-error và atomic swap ở gateway

- `RegistryDiscovery.resolve()` **chỉ đọc RAM**, không bao giờ chờ registry. Data plane không chậm theo registry.
- Snapshot mới về: dựng **bảng mới** rồi gán một lần (`this.table = newTable`), không sửa bảng cũ tại chỗ. Request đang đọc không bao giờ thấy bảng nửa vời (**atomic swap**; JavaScript đơn luồng nên phép gán là nguyên tử).
- Registry lỗi (mạng, 5xx, JSON hỏng, thiếu `instances`) → giữ bảng cũ (**stale-on-error**). Bản ghi sai hình dạng bị bỏ qua: không tin dữ liệu qua mạng.
- Gateway khởi động khi registry chết: **vẫn mở cổng**, trả 503 cho tới snapshot đầu tiên, rồi tự phục hồi. Lỗi cấu hình (thiếu URL, URL sai) thì vẫn fail-fast.
- `GatewayHandler` **không đổi một dòng**: `RegistryDiscovery` và `StaticDiscovery` cùng implements `ServiceDiscovery` (Dependency Inversion).

**Câu hỏi phỏng vấn**
- Registry chết thì gateway làm gì? Khởi động lúc registry chết thì sao?
- Fail-fast và AP có mâu thuẫn không? (Không: fail-fast cho lỗi **cấu hình**, AP cho lỗi **runtime** của phụ thuộc.)

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 24. Kiểm chứng chạy thật: số đo và đọc log

Cấu hình thử: registry TTL 6s (heartbeat 2s, sweep 2s), gateway poll 1s, 2 echo (4001, 4002).

| Kịch bản | Kết quả đo được |
|---|---|
| 2 echo tự đăng ký | Pattern tự quét: `auth.login, user.create, user.getById, user.list`; 4 request chia 2/2 |
| Pattern trong spec chưa ai xử lý | Gateway log `No instance registered for: auth.logout`; gọi thử → 503 `NO_INSTANCE` |
| `SIGKILL` echo-4002 | Registry gỡ sau **~5s** (TTL 6s tính từ heartbeat cuối); gateway hết gửi tới nó |
| `SIGTERM` echo-4001 | Log `Deregistered` ngay; snapshot rỗng trong < 0.5s; gateway 503 |
| Tắt registry (`kill -9`) | Gateway log một lần `keeping the last snapshot`; request vẫn **200** |
| Bật lại registry (RAM rỗng) | Heartbeat kế tiếp khôi phục bản ghi (soft state); version về **1** nhưng ETag khác nhờ `bootId` → gateway nhận bảng mới |
| Gateway khởi động khi registry tắt | 503 + cảnh báo; bật registry → tự phục hồi, 200 |

**Công thức thời gian gỡ instance crash:** `≤ TTL + chu kỳ poll` (lazy expiry khi gateway hỏi snapshot). Mặc định 15s + 3s ≈ **18s**.

**Tự trả lời:** _(kể lại một kịch bản bằng lời của bạn, kèm số đo)_

---

## 25. Health thụ động từ heartbeat (healthy / late)

Trang `/lists` cần hiện "health" nhưng registry **không gọi tới service**. Thông tin duy nhất có là **tuổi của heartbeat cuối** (`now - lastSeen`, đồng hồ monotonic).

| Trạng thái | Điều kiện (TTL 15s, heartbeat 5s) | Ý nghĩa |
|---|---|---|
| 🟢 `healthy` | tuổi ≤ 1.5 nhịp = **7.5s** | Heartbeat đến đúng nhịp |
| 🟡 `late` | 7.5s < tuổi ≤ 15s | Đã **lỡ ít nhất một nhịp**: mạng chập chờn, GC pause, hoặc process sắp chết |
| (không hiện) | tuổi > 15s | Hết lease, đã bị gỡ |

- Ngưỡng 1.5 nhịp chứ không phải đúng 1 nhịp: heartbeat có độ trễ mạng + thời gian xử lý, lấy đúng 1 nhịp thì instance khoẻ cũng nhấp nháy "late".
- `late` là **cảnh báo sớm**: gateway vẫn gửi request tới instance này (nó vẫn trong snapshot) cho tới khi hết TTL.
- Giới hạn: đây là **liveness** (process còn gửi heartbeat), không phải **readiness** (xử lý được request). Process treo nhưng timer heartbeat vẫn chạy thì vẫn "healthy". Muốn biết thật thì cần health check chủ động (TCP connect, hoặc gọi một pattern `health`).

**Câu hỏi phỏng vấn**
- Bạn đo health của service thế nào? Hạn chế?
- Vì sao ngưỡng là 1.5 nhịp?
- Liveness và readiness khác nhau thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 26. Stored XSS, escape HTML và CSP có nonce

**Mối nguy:** `patterns`, `metadata`, `host` là **chuỗi do service gửi lên** rồi được registry lưu và hiển thị trên trang quản trị. Một service (bị chiếm quyền, hoặc cấu hình sai) gửi pattern `<img src=x onerror=...>` → mỗi người mở `/lists` đều chạy script đó. Đây là **stored XSS** (lưu ở server, chạy ở trình duyệt người khác).

**Lớp 1: escape khi xuất ra HTML.** `escapeHtml` đổi `& < > " '` thành entity cho MỌI giá trị, cả trong nội dung lẫn trong attribute (`data-search="..."`, `title="..."`). Escape ở **lúc xuất** (output encoding), không phải lúc nhận: cùng dữ liệu có thể xuất ra HTML, JSON, log, mỗi nơi cần cách mã hoá khác nhau.

**Lớp 2: Content-Security-Policy.** Kể cả lỡ quên escape ở đâu đó, trình duyệt vẫn chặn:
```
default-src 'none'; script-src 'nonce-<ngẫu nhiên>'; style-src 'unsafe-inline'; connect-src 'self'; ...
```
- Chỉ `<script nonce="...">` có đúng nonce mới chạy. Script/handler (`onerror=`) bị chèn vào không có nonce → bị chặn.
- **Nonce mới cho mỗi response** (`randomBytes(16)`): kẻ tấn công không đoán trước được.
- Không dùng `'unsafe-inline'` cho script (nếu dùng thì CSP mất tác dụng chống XSS).
- Style vẫn `'unsafe-inline'` vì thanh lease dùng `style="width:..%"`; CSS không chạy được code nên rủi ro thấp.
- `connect-src 'self'`: script trên trang chỉ gọi được về chính registry.

Đây là **defense in depth**: hai lớp độc lập, một lớp hỏng vẫn còn lớp kia. Test e2e gửi một instance có `<script>` trong host/pattern/metadata và kiểm tra HTML trả về chỉ chứa bản đã escape.

**Thêm:** `innerHTML` khi cập nhật trang an toàn vì nội dung đã được server escape, và trình duyệt **không chạy `<script>` được gán qua innerHTML**.

**Câu hỏi phỏng vấn**
- XSS có mấy loại (stored, reflected, DOM-based)? Trang của bạn có nguy cơ loại nào?
- Escape lúc nhận hay lúc xuất? Vì sao?
- CSP là gì? Nonce khác hash và `'unsafe-inline'` thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 27. Server render + cập nhật từng phần (partial)

- **Server render bằng hàm thuần** `Overview → string`: không template engine, test bằng supertest không cần trình duyệt; trang xem được cả khi tắt JS.
- **Cập nhật mỗi 2s:** JS gọi `GET /lists?partial=1`, server trả **đúng phần nội dung** đã render, JS thay vào `#content`. Ý tưởng giống **htmx / Hotwire Turbo**: server trả HTML thay vì JSON.
- So với cách "JSON + render bằng JS": chỉ có **một** chỗ render (server), không phải viết lại giao diện bằng hai ngôn ngữ, và escape nằm ở một nơi. JSON vẫn có ở `/v1/overview` cho máy đọc (monitoring, CLI).
- Poll bằng **`setTimeout` nối tiếp** như gateway (#20); **dừng khi tab ẩn** (`visibilitychange`) để không tốn tài nguyên; registry mất kết nối thì hiện "đang thử lại" và giữ nội dung cũ (stale-on-error ở phía UI).
- Ô tìm kiếm chạy hoàn toàn ở client và **áp lại sau mỗi lần thay nội dung**.
- `Cache-Control: no-store`: trang trạng thái luôn phải là dữ liệu mới.

**Câu hỏi phỏng vấn**
- Server-side rendering và client-side rendering khác nhau thế nào? Khi nào chọn cái nào?
- Cập nhật realtime: polling, long-polling, SSE, WebSocket. Bạn chọn gì cho trang này, vì sao?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 28. Registry riêng cho mỗi project hay dùng chung (multi-tenancy)

**Quyết định của dự án:** mỗi project application chạy **một registry riêng**; registry không có khái niệm project (PLAN mục 10d). Ban đầu thiết kế ngược lại (một registry, mọi thứ khoá theo project), rồi đổi.

| | Một registry dùng chung (nhiều project) | **Mỗi project một registry (dự án chọn)** |
|---|---|---|
| Cách ly | Phải tự đảm bảo trong code (khoá theo project ở mọi API, mọi bảng) | **Cách ly vật lý**: bug hay overload ở project A không chạm project B |
| Blast radius | Registry hỏng = **mọi** project mất discovery | Registry hỏng = chỉ project đó |
| Độ phức tạp code | Thêm tham số `project` ở API, store, client, gateway, UI | **Đơn giản hơn**: một bảng, một version, một ETag |
| Vận hành | Một thứ để chạy, giám sát, nâng cấp | N registry để chạy (rẻ vì nhỏ, in-memory) |
| Lỗi cấu hình | Service đặt sai project: lặng lẽ không ai thấy → 503 | Không có biến này để sai (sai URL thì thấy ngay) |
| Quy tắc "một pattern một service" | Trong phạm vi từng project | Trong cả registry (ranh giới = project) |

**Mẫu quen thuộc:** đây là lựa chọn giữa **shared multi-tenant** và **single-tenant per deployment** (cell-based architecture). Sản phẩm thực tế có cả hai kiểu:
- Consul dùng **namespaces / admin partitions** trong một cluster; Kubernetes dùng **namespace**.
- Eureka thường chạy **một cluster cho mỗi môi trường** và đặt tên theo `appName`.

**Khi nào dùng chung đáng giá:** hàng trăm project nhỏ, mỗi cái ít instance, vận hành N registry là gánh nặng; cần nhìn toàn cảnh tất cả project ở một nơi.

**Bài học thiết kế:** bỏ một chiều (project) khỏi mô hình dữ liệu kéo theo thay đổi ở **mọi tầng** (URL, store, snapshot, UI, client env, interface gateway, file discovery tĩnh). Mô hình dữ liệu càng sớm đơn giản càng đỡ tốn.

**Câu hỏi phỏng vấn**
- Multi-tenancy: dùng chung hay tách riêng? Đánh đổi?
- Blast radius là gì? Cell-based architecture giải quyết vấn đề gì?
- Bạn đã bỏ một khái niệm khỏi hệ thống đang chạy chưa? Ảnh hưởng tới những đâu?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## 29. Đóng gói code dùng chung trong monorepo (lib, peerDependencies, CJS/ESM, env lazy)

**Vấn đề:** code đăng ký (~330 dòng) cần ở **mọi** service. Copy-paste thì mỗi lần đổi giao thức phải sửa N chỗ, và các bản lệch nhau dần (đã gặp: bỏ project khỏi URL phải sửa mọi bản).

**Giải pháp:** thư viện `libs/service-discovery-client` (npm workspace `@org/service-discovery-client`). Service chỉ cần:
```ts
@Module({ imports: [ServiceDiscoveryModule.forRoot()] })   // + REGISTRY_URL và PORT trong .env
```

**Các quyết định kỹ thuật (mỗi cái là một câu phỏng vấn):**

| Vấn đề | Chọn | Vì sao |
|---|---|---|
| `@nestjs/*` trong lib | **`peerDependencies`**, không phải `dependencies` | Mọi service dùng chung **một** bản `@nestjs/common`. Hai bản thì `@Injectable`/`@Inject`/metadata của bản này không được container của bản kia nhận ra |
| Định dạng module | **CJS** (không `"type": "module"`) | CJS dùng được cho cả service CJS (`require`) lẫn ESM (`import`). Lib ESM-only chỉ `require()` được từ CJS khi Node ≥ 22.12 |
| Lib có build không | **Có** (generator mặc định khuyên không) | Service chạy bằng `nest build` (tsc) nên Node cần JS thật lúc chạy; lib "không build" chỉ hợp khi consumer tự bundle source. `targetDefaults` `dependsOn: ["^build"]` để Nx build lib trước |
| Đọc env | **Lazy**, trong `useFactory` của provider | `forRoot()` chạy khi file được `import`, thường *trước* khi `main.ts` nạp `.env`; đọc env ở đó sẽ thấy giá trị rỗng |
| Cấu hình sai | Ném lỗi lúc khởi tạo provider | Fail-fast **trước khi mở cổng**; NestFactory mặc định `process.abort()` khi khởi tạo lỗi |
| Test | Vitest | Chạy ESM trực tiếp nên test được cả code import `@nestjs/*` trên Node 22 (Jest kẹt do NestJS 12 ESM-only) |
| Phạm vi API | Chỉ export module, `ServiceDiscoveryOptions`, `ServiceDiscoveryConfigError` | API nhỏ thì đổi nội bộ không vỡ consumer |

**Mô hình cấu hình "convention over configuration":** mặc định hợp lý cho mọi thứ (tên service từ `package.json`, địa chỉ quảng bá tự phát hiện, instance id từ hostname), chỉ **bắt buộc** `REGISTRY_URL` và `PORT`; mọi thứ có thể ghi đè bằng env hoặc option. Thứ tự ưu tiên: **option > env > mặc định**.

**Cái bẫy gặp phải khi làm:**
- Generator `@nx/js:library` tự thêm `vitest ~5` và `vite ^8` vào root, xung đột peer với `vitest ^4` của registry (`ERESOLVE`) → gỡ, để lib dùng cùng phiên bản với registry.
- `npm install` vẫn lỗi `edgesOut` → `--legacy-peer-deps`.
- Nx báo "workspace out of sync" cho tới khi `nx sync` thêm TypeScript project references (service → lib).

**Giới hạn:** service ở repo riêng (như api-gateway) chưa dùng được cho tới khi publish package lên npm (private) hoặc cài từ git; đổi lại không phải dựng npm registry riêng ngay bây giờ.

**Câu hỏi phỏng vấn**
- Khi nào nên gom code thành thư viện dùng chung, khi nào chấp nhận copy?
- `dependencies` khác `peerDependencies` thế nào? Vì sao thư viện NestJS phải khai báo Nest là peer?
- CommonJS và ES Modules: thư viện nên phát hành định dạng nào? `require()` một ESM-only package có được không?
- Vì sao đọc biến môi trường trong `forRoot()` có thể sai? (Thứ tự import so với lúc nạp `.env`.)
- Monorepo: Nx giải quyết việc build đúng thứ tự giữa lib và app thế nào?

**Tự trả lời:**
> _(viết bằng lời của bạn)_

---

## Bẫy thực tế

| Bẫy | Hậu quả | Cách tránh |
|---|---|---|
| Quảng bá `0.0.0.0` | Gateway không kết nối được | Advertise host riêng; registry từ chối |
| Tính TTL bằng `Date.now()` | Gỡ oan hàng loạt khi giờ nhảy | Monotonic clock |
| ETag chỉ có `version` | 304 sai sau khi registry restart | Thêm `bootId` |
| Ghi rồi mới kiểm tra xung đột | Bảng nửa vời | Kiểm tra hết rồi mới ghi |
| Heartbeat tăng version | Gateway không bao giờ nhận 304 | Chỉ tăng khi dữ liệu đổi |
| Timer không `unref()` | Process không thoát | `unref()` / clear khi shutdown |
| `setInterval` để poll qua mạng | Request chồng nhau, bảng cũ ghi đè bảng mới | `setTimeout` nối tiếp + timeout mỗi lần gọi |
| Chỉ dựa vào sweeper định kỳ | Instance chết vẫn giữ pattern giữa hai lần quét | Hết hạn lazy khi đọc/ghi |
| Reset version khi registry hết instance | Version về 0, ETag cũ trùng bảng mới | Version chỉ tăng trong một lần chạy |
| Đăng ký ngay trong `onApplicationBootstrap` | Quảng bá cổng chưa mở (microservice chỉ mở cổng sau hook này) | Thăm dò TCP tới địa chỉ quảng bá rồi mới đăng ký |
| Log mỗi lần heartbeat/poll | Ngập log | Log theo chuyển trạng thái |
| `npm install` lỗi `Cannot read properties of null (reading 'edgesOut')` | Không cài được | Lỗi của npm khi giải peer deps; dùng `npm install --legacy-peer-deps` |
| Jest + NestJS 12 trên Node 22 | Test import `@nestjs/*` không chạy (ESM-only) | Core không import NestJS; registry dùng Vitest (chạy ESM trực tiếp) |
| Hiển thị chuỗi do service gửi lên mà không escape | Stored XSS trên trang quản trị | Escape mọi giá trị khi xuất + CSP có nonce |
| Ngưỡng "healthy" đúng bằng 1 nhịp heartbeat | Instance khoẻ nhấp nháy "late" | Ngưỡng 1.5 nhịp |
| _(ghi thêm khi gặp)_ | | |

---

## Từ điển nhanh

| Thuật ngữ | Nghĩa ngắn |
|---|---|
| Registry | Nơi lưu danh sách instance đang sống và địa chỉ của chúng |
| Lease | Quyền "có mặt" trong registry có thời hạn, phải gia hạn |
| Heartbeat | Tín hiệu định kỳ để gia hạn lease |
| TTL | Thời gian sống tối đa nếu không được gia hạn |
| Sweep | Quét định kỳ để gỡ bản ghi hết hạn |
| Soft state | Trạng thái tự làm mới, mất đi tự hồi phục |
| Idempotent | Gọi nhiều lần cho kết quả như gọi một lần |
| ETag | Mã phiên bản của tài nguyên trong HTTP |
| 304 Not Modified | Tài nguyên chưa đổi so với ETag client gửi |
| Epoch / bootId | Mã "thế hệ" để phân biệt dữ liệu trước và sau khi restart |
| Monotonic clock | Đồng hồ chỉ tăng, dùng đo khoảng thời gian |
| Clock skew | Độ lệch đồng hồ giữa các máy |
| Advertise address | Địa chỉ bên khác dùng để gọi tới mình |
| Self-preservation | Registry ngừng gỡ instance khi nghi lỗi mạng diện rộng |
| Quorum | Đa số node phải đồng ý mới tính là ghi thành công |
| Draining | Ngừng nhận request mới, xử lý nốt request đang chạy rồi mới tắt |
| Lazy expiry | Gỡ bản ghi hết hạn lúc có người truy cập, không chờ quét |
| Atomic swap | Thay nguyên bảng trong một phép gán, không có trạng thái nửa vời |
| Edge-triggered log | Chỉ log khi trạng thái đổi, không log mỗi lần lặp |
| Readiness | Sẵn sàng nhận request (khác liveness: còn sống) |
| Stored XSS | Script độc được lưu ở server rồi chạy trong trình duyệt người xem |
| Output encoding | Escape dữ liệu lúc xuất ra, theo đúng ngữ cảnh (HTML, attribute, JSON...) |
| CSP nonce | Mã ngẫu nhiên mỗi response; chỉ script mang đúng mã mới được chạy |
| Partial rendering | Server trả một mảnh HTML để thay vào trang (kiểu htmx/Turbo) |
| Multi-tenancy | Một hệ thống phục vụ nhiều khách hàng/project, cần cách ly dữ liệu giữa họ |
| Blast radius | Phạm vi bị ảnh hưởng khi một thành phần hỏng |
| peerDependencies | Phụ thuộc mà thư viện yêu cầu *consumer* tự cài, để cả hệ thống dùng chung một bản |
| Convention over configuration | Mặc định hợp lý cho mọi thứ, người dùng chỉ khai báo phần bắt buộc |
| Lazy configuration | Đọc cấu hình lúc cần (khởi tạo provider) thay vì lúc import file |

---

## Nhật ký học tập

| Ngày | Đã làm | Điều rút ra | Câu còn mơ hồ |
|---|---|---|---|
| 2026-11-06 | Viết PLAN.md + KNOWLEDGE.md cho service-discovery (chưa code) | Bổ sung `bootId` trong ETag, monotonic clock cho TTL, kiểm tra xung đột trước khi ghi | |
| 2026-11-06 | Code Phần 1 (registry), Phần 2 (client trong echo-service), Phần 3 (`RegistryDiscovery` ở gateway); chạy thật đủ 6 kịch bản | Lazy expiry; `setTimeout` nối tiếp; log theo chuyển trạng thái; đăng ký sau `listen`, deregister ở `beforeApplicationShutdown` | |
| 2026-11-07 | Trang `/lists` + `GET /v1/overview`: health theo heartbeat, pattern theo service, tự cập nhật 2s | Health thụ động (healthy ≤ 1.5 nhịp / late); stored XSS → escape lúc xuất + CSP nonce; server render + partial | |
| 2026-11-07 | Bỏ project khỏi registry (một registry = một project application), đổi API, store, `/lists`, client, interface gateway | Bỏ một chiều khỏi mô hình dữ liệu kéo theo đổi mọi tầng; shared vs per-project tenancy; blast radius | |
| 2026-11-07 | Gom client đăng ký thành lib `@org/service-discovery-client`: service chỉ import module + `REGISTRY_URL`/`PORT` | peerDependencies, CJS vs ESM, đọc env lazy, thăm dò TCP để biết cổng đã mở, Nx build lib trước app | |
