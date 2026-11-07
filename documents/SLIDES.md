<!--
Nội dung tab "Slide" trong knowledge.html.
- Mỗi slide ngăn cách bằng một dòng chỉ có `---`.
- Slide bắt đầu bằng `# ` là slide bìa; `## ` là slide thường.
- Dòng `Note:` trở xuống là ghi chú cho người nói (không hiện trên slide, bấm N để xem).
- `{{architecture}}` chèn sơ đồ kiến trúc; `{{planes}}` chèn ba cột "ba vai trò".
Sửa xong chạy: npm run docs:knowledge (trong apps/service-discovery)
-->

# Service Registry tự build

Service tự đăng ký, gateway tự biết ai đang sống.

NestJS · Express · Vitest · HTTP/JSON · in-memory

Note: Một câu: đây là mảnh ghép giúp gateway biết pattern nào do instance nào xử lý, thay cho file cấu hình tĩnh.

---

## Bài toán

- Gateway dịch HTTP → TCP RPC, cần biết **"pattern X do ai xử lý, ở đâu?"**
- File tĩnh: thêm/bớt instance phải **sửa file và restart**
- Instance chết vẫn nằm trong danh sách, round-robin **vẫn chọn nó**

Note: Nhấn vào hai nỗi đau: vận hành thủ công và gửi request vào instance chết.

---

## Kiến trúc

{{architecture}}

Note: Service PUT mỗi 5s, registry giữ lease 15s, gateway GET snapshot mỗi 3s với ETag. Request không bao giờ chờ registry.

---

## Ba vai trò

{{planes}}

Note: Mỗi bên một việc. GatewayHandler không đổi một dòng nhờ interface ServiceDiscovery.

---

## Lease + heartbeat = soft state

- Đăng ký là một **hợp đồng thuê** 15s
- Heartbeat = **PUT lại đầy đủ** mỗi 5s (TTL/3: lỡ 2 nhịp vẫn sống)
- Registry restart, mất RAM → **một nhịp sau đã khôi phục**
- Vì vậy **in-memory là đủ**, không cần database

Note: Câu hỏi hay gặp: "registry chết thì sao?". Trả lời: dữ liệu tự quay về, vì nguồn sự thật là các service đang sống.

---

## Snapshot + ETag

| | |
|---|---|
| `version` | Chỉ tăng khi bảng **đổi**, heartbeat không tăng |
| `ETag` | `"<bootId>-<version>"` |
| `If-None-Match` khớp | **304**, không body |
| Registry restart | version về 1, nhưng **bootId khác** → ETag khác |

Note: Kể chuyện bug tiềm ẩn: chỉ dùng version thì sau restart có thể trùng số, gateway nhận 304 cho một bảng khác. Đã kiểm chứng chạy thật: version 5 → 1 mà gateway vẫn cập nhật.

---

## Những chi tiết đúng/sai

- TTL đo bằng **monotonic clock**: NTP chỉnh giờ không gỡ oan
- **Kiểm tra xung đột rồi mới ghi**: 409, không ghi nửa vời
- Hết hạn **lazy + quét định kỳ** (giống Redis)
- Poll bằng **`setTimeout` nối tiếp**, có timeout mỗi lần gọi
- Log **theo chuyển trạng thái**, không log mỗi heartbeat

Note: Chọn 2 ý để nói sâu tuỳ người hỏi. Monotonic clock và bootId thường gây ấn tượng nhất.

---

## Vòng đời một service

1. `app.listen()` xong mới **đăng ký** (không quảng bá cổng chưa mở)
2. Tự quét `@MessagePattern` bằng metadata NestJS
3. Heartbeat theo nhịp registry trả về
4. SIGTERM: `beforeApplicationShutdown` → **DELETE** → rồi mới đóng cổng
5. Crash: không DELETE → **lease hết hạn** là lưới an toàn

Note: Thứ tự shutdown của NestJS: destroy → beforeShutdown → dispose → shutdown. Deregister trước dispose để draining.

---

## AP: registry chết thì sao?

- Gateway: **giữ snapshot cũ**, request vẫn 200
- Service: **vẫn chạy**, thử lại theo nhịp
- Gateway khởi động khi registry chết: mở cổng, **503** tới khi đồng bộ
- Lỗi **cấu hình** thì vẫn fail-fast

Note: Phân biệt fail-fast (lỗi cấu hình, lộ ra lúc deploy) và AP (lỗi runtime của phụ thuộc).

---

## Kiểm chứng chạy thật

| Kịch bản | Kết quả |
|---|---|
| 2 echo tự đăng ký | chia 2/2 |
| `SIGKILL` (TTL 6s) | gỡ sau ~5s |
| `SIGTERM` | gỡ ngay |
| Tắt registry | vẫn 200 |
| Bật lại registry | tự khôi phục |

Note: Số đo cụ thể làm câu trả lời đáng tin hơn nhiều so với "em nghĩ là".

---

## Ngoài phạm vi (và sẽ làm thế nào)

- Nhiều node: **Raft** (etcd) hoặc **gossip** (Eureka peer)
- **Self-preservation** khi mất heartbeat hàng loạt
- Health check chủ động, **watch/long-poll**, **mTLS**/ACL

Note: Biết giới hạn của mình và hướng đi tiếp là một điểm cộng lớn khi phỏng vấn.
