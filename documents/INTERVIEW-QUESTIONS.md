# Ngân hàng câu hỏi phỏng vấn: Service Discovery & Service Registry

> Dùng cùng [KNOWLEDGE.md](./KNOWLEDGE.md). Ký hiệu `📚 #n` = mục n trong KNOWLEDGE.

## Cách luyện

1. Đọc câu hỏi, **nói thành tiếng** câu trả lời trong 1–2 phút (không nhìn ý chính).
2. So với **Ý chính**: thiếu ý nào thì đọc lại mục 📚 tương ứng.
3. Đánh dấu: `[x]` khi trả lời đủ ý, tự tin; để `[ ]` và thêm 🔁 nếu cần ôn lại.
4. Với câu ở Phần B, luôn **gắn với code thật** ("trong dự án của em, ở file ...").
5. Mỗi câu trả lời tốt thường có 3 phần: **định nghĩa → vì sao / đánh đổi → ví dụ từ dự án**.

Mức độ: 🟢 cơ bản · 🟡 trung bình · 🔴 nâng cao

---

## Phần A. Kiến thức nền

### A1. Service discovery
- [ ] 🟢 **Service discovery là gì? Vì sao microservices cần nó?**
  *Ý chính:* địa chỉ instance thay đổi liên tục (scale, deploy, crash, IP động); cấu hình cứng không theo kịp; cần nơi biết "ai đang sống, ở đâu". · 📚 #1
- [ ] 🟢 **Client-side và server-side discovery khác nhau thế nào? Cho ví dụ.**
  *Ý chính:* client tự hỏi registry và tự chọn instance (Eureka + Ribbon) vs gọi qua LB/router, LB hỏi registry (AWS ALB, Kubernetes Service). Đánh đổi: ít hop, tự chọn thuật toán vs client đơn giản. · 📚 #2
- [ ] 🟢 **Self-registration và third-party registration khác nhau thế nào?**
  *Ý chính:* service tự gọi registry vs registrar bên ngoài (kubelet, Docker events) đăng ký thay. Self: đơn giản nhưng code có ở mọi service. · 📚 #3
- [ ] 🟡 **DNS có phải service discovery không? Hạn chế?**
  *Ý chính:* có, dạng đơn giản; nhưng cache theo TTL khó kiểm soát, A record không có port (cần SRV), không có health, client cache lâu. · 📚 #1
- [ ] 🟡 **Tra theo tên service và tra theo khả năng (pattern) khác nhau thế nào?**
  *Ý chính:* capability-based: spec không ghi tên service, tách service không sửa spec; phải chặn hai service giữ cùng pattern; không kiểm tra được lúc khởi động gateway. · 📚 #9

### A2. Lease, heartbeat, TTL
- [ ] 🟢 **Heartbeat và TTL hoạt động thế nào?**
  *Ý chính:* lease có hạn; service gia hạn định kỳ; quá TTL không gia hạn thì bị gỡ. · 📚 #4
- [ ] 🟡 **Chọn TTL và chu kỳ heartbeat thế nào? Vì sao heartbeat = TTL/3?**
  *Ý chính:* lỡ 2 nhịp vẫn sống (mạng chập chờn, GC pause); TTL ngắn phát hiện nhanh nhưng dễ gỡ oan + tải cao. · 📚 #4
- [ ] 🟡 **Instance crash thì sau bao lâu request ngừng tới nó? Tính đủ các độ trễ.**
  *Ý chính:* ≤ TTL (lazy expiry) + chu kỳ poll của gateway; mặc định 15 + 3 ≈ 18s; trong khoảng đó failover ở gateway cứu. · 📚 #4, #19, #24
- [ ] 🟡 **Soft state là gì? Vì sao registry in-memory vẫn chấp nhận được?**
  *Ý chính:* trạng thái tự làm mới; heartbeat là đăng ký lại đầy đủ nên registry restart thì một nhịp sau đã khôi phục. Eureka cũng in-memory. · 📚 #5
- [ ] 🟡 **Vì sao heartbeat nên là PUT đầy đủ thay vì lệnh ping riêng?**
  *Ý chính:* idempotent; registry mất dữ liệu không cần logic "404 thì đăng ký lại"; một đường code duy nhất. · 📚 #5, #10
- [ ] 🔴 **Heartbeat vẫn đến nhưng service không xử lý được request thì sao?**
  *Ý chính:* heartbeat chỉ chứng minh process sống; cần health check sâu (readiness), hoặc outlier detection / circuit breaker ở bên gọi. · 📚 #6

### A3. Thời gian và phiên bản
- [ ] 🟡 **Tính TTL bằng `Date.now()` có vấn đề gì?**
  *Ý chính:* wall clock nhảy khi NTP chỉnh giờ → gỡ oan hàng loạt hoặc sống mãi; dùng monotonic clock (`performance.now()`). · 📚 #7
- [ ] 🟡 **Clock skew là gì? Ảnh hưởng gì tới registry?**
  *Ý chính:* đồng hồ các máy lệch nhau; registry không tin thời gian service gửi lên, tự đo `lastSeen`. · 📚 #7
- [ ] 🟢 **ETag và 304 Not Modified hoạt động thế nào?**
  *Ý chính:* server gắn phiên bản vào `ETag`; client gửi lại trong `If-None-Match`; không đổi → 304 không body. · 📚 #8
- [ ] 🔴 **Bộ đếm phiên bản bị reset (restart) thì có vấn đề gì? Giải pháp?**
  *Ý chính:* version trùng nhưng nội dung khác → 304 sai, client giữ bảng sai mãi; thêm `bootId`/epoch vào ETag; không cho version lùi trong cùng lần chạy. · 📚 #8, #19

### A4. Hệ phân tán
- [ ] 🟡 **Registry nên AP hay CP? Vì sao?**
  *Ý chính:* danh sách hơi cũ tốt hơn không có danh sách; Eureka AP, ZooKeeper/etcd CP; dự án AP ở phía client (stale-on-error). · 📚 #11
- [ ] 🔴 **Mất heartbeat hàng loạt thì registry nên làm gì?**
  *Ý chính:* self-preservation: nghi lỗi mạng phía registry, ngừng gỡ; đánh đổi: instance chết thật cũng không bị gỡ. · 📚 #12
- [ ] 🔴 **Làm registry chịu lỗi (nhiều node) thế nào?**
  *Ý chính:* peer replication/gossip (eventual, AP) vs Raft (quorum, strong, CP); số node lẻ. · 📚 #13
- [ ] 🟡 **So sánh Eureka, Consul, etcd, Kubernetes.**
  *Ý chính:* CAP, cách đăng ký, phát hiện chết, cách báo thay đổi (poll / blocking query / watch). · 📚 #16

---

## Phần B. Đào sâu vào dự án của bạn

### B1. Registry (`apps/service-discovery`)
- [ ] 🟢 **Giới thiệu registry của bạn trong 2 phút.**
  *Ý chính:* bối cảnh → self-registration + heartbeat + lease → snapshot + ETag + stale-on-error → một chi tiết kỹ thuật → kết quả đo. · 📚 #0
- [ ] 🟡 **Cấu trúc code của registry? Vì sao core không phụ thuộc NestJS?**
  *Ý chính:* `registry/` thuần (store, validation, clock, errors) + `http/` mỏng (controller, guard, filter, sweeper); test core không cần HTTP, không cần timer. · 📚 #17
- [ ] 🟡 **Xử lý xung đột pattern thế nào? Vì sao kiểm tra trước khi ghi?**
  *Ý chính:* owners map pattern → service; khác service và còn instance khác giữ → 409; kiểm tra hết rồi mới ghi để không ghi nửa vời. · 📚 #9
- [ ] 🟡 **Instance hết hạn được gỡ lúc nào?**
  *Ý chính:* lazy khi có thao tác (đọc/ghi) + sweeper mỗi TTL/3; hook `onExpire` để log. · 📚 #19
- [ ] 🟡 **Version tăng khi nào? Vì sao heartbeat không tăng version?**
  *Ý chính:* chỉ khi dữ liệu đổi (so sánh service/host/port/patterns/metadata không phụ thuộc thứ tự); để gateway nhận 304 phần lớn thời gian. · 📚 #8
- [ ] 🟡 **Bảo vệ registry thế nào? Vì sao so sánh token constant-time?**
  *Ý chính:* ai ghi được là điều hướng được traffic; token cho PUT/DELETE; `timingSafeEqual` trên hash; validate chặt, giới hạn body 64KB. · 📚 #18
- [ ] 🟢 **Thiết kế API: vì sao PUT? DELETE không tồn tại trả gì? Registry rỗng trả gì?**
  *Ý chính:* client chọn id + idempotent; 204 idempotent; 200 rỗng (trạng thái hợp lệ, không phải 404). · 📚 #10

### B2. Client (`echo-service/src/registry`)
- [ ] 🟡 **Service biết mình xử lý pattern nào bằng cách nào?**
  *Ý chính:* `DiscoveryService` + `MetadataScanner` đọc metadata `microservices:pattern` và `handler_type`; bỏ EventPattern và pattern object. · 📚 #22
- [ ] 🟡 **Registry chết thì service làm gì?**
  *Ý chính:* vẫn chạy; log warn một lần; thử lại theo nhịp; registry sống lại thì heartbeat tự khôi phục, client nhận "created" và cảnh báo re-registered. · 📚 #5, #21
- [ ] 🔴 **Khi nào service đăng ký và huỷ đăng ký? Vì sao chọn đúng thời điểm đó?**
  *Ý chính:* sau `app.listen()` (không quảng bá cổng chưa mở); `beforeApplicationShutdown` chạy trước `dispose` nên DELETE trước khi đóng cổng (draining). · 📚 #15
- [ ] 🟡 **Vì sao không được quảng bá `0.0.0.0`? Trong Docker dùng gì?**
  *Ý chính:* bind ≠ advertise; `REGISTRY_ADVERTISE_HOST`; Docker dùng tên service; registry từ chối 0.0.0.0. · 📚 #14
- [ ] 🟡 **Vì sao client là bản copy trong mỗi service thay vì thư viện dùng chung?**
  *Ý chính:* mỗi app là repo riêng; copy nhỏ, không phụ thuộc phiên bản lib; đánh đổi: đổi giao thức phải cập nhật mọi bản. · 📚 #3

### B3. Gateway (`RegistryDiscovery`)
- [ ] 🟡 **Gateway lấy danh sách instance thế nào? Vì sao không hỏi registry mỗi request?**
  *Ý chính:* poll snapshot nền + ETag; `resolve()` chỉ đọc RAM; không stampede, không chờ registry. · 📚 #23
- [ ] 🟡 **Vì sao poll bằng `setTimeout` nối tiếp thay vì `setInterval`?**
  *Ý chính:* không chồng request khi registry chậm, không có response lộn thứ tự; có timeout mỗi lần gọi. · 📚 #20
- [ ] 🟡 **Gateway khởi động khi registry chết thì sao? Có mâu thuẫn với fail-fast không?**
  *Ý chính:* vẫn mở cổng, 503 tới snapshot đầu, tự phục hồi; fail-fast cho lỗi cấu hình, AP cho lỗi runtime của phụ thuộc. · 📚 #23
- [ ] 🟡 **Thêm RegistryDiscovery có phải sửa GatewayHandler không?**
  *Ý chính:* không; cùng interface `ServiceDiscovery`; chọn bằng env (đúng một trong `GATEWAY_REGISTRY_URL` / `GATEWAY_DISCOVERY_FILE`). · 📚 #23

### B4. Trang quản trị `/lists`
- [ ] 🟡 **Trang `/lists` tính "health" của instance thế nào? Hạn chế?**
  *Ý chính:* thụ động theo tuổi heartbeat: healthy ≤ 1.5 nhịp, late khi lỡ nhịp chưa hết TTL; chỉ là liveness, process treo mà timer còn chạy vẫn healthy. · 📚 #25
- [ ] 🔴 **Trang hiển thị dữ liệu do service gửi lên. Bạn chống XSS thế nào?**
  *Ý chính:* stored XSS; escape mọi giá trị lúc xuất (cả attribute); CSP `script-src 'nonce-...'` mới mỗi response, không `unsafe-inline`; test e2e nhét `<script>` vào pattern/metadata. · 📚 #26
- [ ] 🟡 **Vì sao server render rồi cập nhật bằng partial HTML thay vì trả JSON cho JS render?**
  *Ý chính:* một chỗ render, escape ở một nơi, xem được khi tắt JS; JSON vẫn có ở `/v1/overview` cho máy. · 📚 #27

- [ ] 🟡 **Vì sao registry của bạn không chia theo project? Đánh đổi so với dùng chung?**
  *Ý chính:* mỗi project một registry: cách ly vật lý, blast radius nhỏ, mô hình dữ liệu và API đơn giản (một bảng, một version); đổi lại chạy N registry và quy tắc một-pattern-một-service áp dụng cho cả registry. Dùng chung đáng giá khi rất nhiều project nhỏ (Consul namespaces, K8s namespace). · 📚 #28

---

## Phần C. Tình huống / system design

- [ ] 🔴 **Thiết kế service registry cho 1000 service, 10.000 instance.**
  *Ý chính:* nhiều node (Raft hoặc gossip), sharding (tách registry theo project application), watch/long-poll thay polling, delta thay full snapshot, self-preservation, health check chủ động, ACL/mTLS. · 📚 #11, #12, #13
- [ ] 🔴 **Deploy blue/green một service thì registry và gateway hoạt động thế nào?**
  *Ý chính:* cùng tên service → không xung đột pattern; xanh đăng ký, lục deregister khi tắt; gateway thấy sau ≤ 1 chu kỳ poll. · 📚 #9, #15
- [ ] 🔴 **Tách một pattern từ service A sang service B mà không downtime.**
  *Ý chính:* quy tắc một chủ chặn đăng ký song song; deploy A bản không còn pattern (instance cũ deregister/hết hạn) rồi B đăng ký; có khoảng 503 ngắn; hoặc tạm cho B dùng cùng tên service. · 📚 #9
- [ ] 🟡 **Registry bị partition khỏi một nửa số service thì chuyện gì xảy ra?**
  *Ý chính:* nửa đó hết hạn, bị gỡ; gateway ngừng gửi tới chúng dù vẫn sống; self-preservation sẽ giảm thiểu; dự án hiện chấp nhận. · 📚 #11, #12
- [ ] 🟡 **Bạn sẽ đưa registry này lên Kubernetes thế nào? Có còn cần nó?**
  *Ý chính:* K8s Service/DNS giải quyết tra theo tên; tra theo pattern thì vẫn cần (hoặc dùng label/annotation + controller đọc K8s API). · 📚 #16

---

## Phần D. Câu hỏi đào sâu hay gặp (follow-up)

- [ ] 🟡 **"Nếu registry restart đúng lúc gateway đang poll thì sao?"**
  *Ý chính:* lần poll lỗi → giữ bảng cũ; lần sau nhận bảng mới (có thể rỗng vài giây tới khi heartbeat về); ETag khác nhờ bootId. · 📚 #8, #23
- [ ] 🟡 **"Hai instance cùng id thì sao?"**
  *Ý chính:* ghi đè nhau mỗi heartbeat (version nhảy liên tục); id mặc định `<service>-<hostname>-<port>` để tránh. · 📚 #10
- [ ] 🔴 **"Polling 3s có tốn không? Khi nào chuyển sang watch?"**
  *Ý chính:* 304 rỗng gần như miễn phí; khi cần cập nhật dưới giây hoặc rất nhiều client thì long-poll/watch (Consul blocking query, etcd watch). · 📚 #8, #16
- [ ] 🟡 **"Vì sao không lưu registry vào database?"**
  *Ý chính:* soft state tự hồi phục trong một nhịp heartbeat; DB thêm độ trễ và một điểm hỏng; lưu bền chỉ cần cho hard state. · 📚 #5

---

## Phần E. Câu hỏi hành vi (STAR: Situation, Task, Action, Result)

- [ ] 🟡 **Kể về một bug khó bạn tìm ra khi thiết kế registry.**
  *Gợi ý (ETag):* S: thiết kế ETag = version; T: đảm bảo gateway không giữ bảng sai; A: nhận ra version reset khi restart → thêm bootId, cấm version lùi; R: test chạy thật restart registry, version về 1 mà gateway vẫn cập nhật. · 📚 #8
- [ ] 🟡 **Kể về một lần bạn đánh đổi giữa đơn giản và đúng.**
  *Gợi ý (polling vs watch, in-memory vs DB):* chọn polling + ETag và in-memory soft state; đo thực tế thời gian gỡ ~5s với TTL 6s; ghi rõ ngoài phạm vi. · 📚 #5, #24

---

## Nhật ký luyện tập

| Ngày | Số câu đã luyện | Câu còn yếu | Ghi chú |
|---|---|---|---|
| | | | |
