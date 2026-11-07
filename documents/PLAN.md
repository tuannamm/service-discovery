# PLAN: Service Discovery (Service Registry)

> Mục tiêu: một **sổ danh bạ động** cho hệ thống microservices. Service tự đăng ký "tôi là ai, ở đâu, xử lý những `@MessagePattern` nào"; API Gateway hỏi "instance nào xử lý pattern X?". **Một registry phục vụ đúng một project application** (xem mục 10d).
> Thay cho file tĩnh `discovery.local.json` của gateway (Bước 7 trong `apps/api-gateway/documents/PLAN.md`).
> Kiến thức học được theo dõi ở [KNOWLEDGE.md](./KNOWLEDGE.md).

---

## 1. Bối cảnh: vì sao cần

Gateway hiện đọc instance từ file tĩnh (`StaticDiscovery`):
- Thêm/bớt instance phải **sửa file và restart** gateway.
- Instance chết vẫn nằm trong danh sách, round-robin vẫn chọn nó (chỉ cứu được nhờ failover).

Registry giải quyết cả hai: service **tự đăng ký**, giữ đăng ký bằng **heartbeat**, quá **TTL** thì bị gỡ; gateway **đồng bộ snapshot** ở nền.

```
echo-1 ─┐ PUT /v1/instances/echo-1   (đăng ký + heartbeat mỗi 5s, kèm patterns)
echo-2 ─┤
        ▼
  Service Registry :8500   (in-memory, lease TTL 15s, quét hết hạn mỗi 5s)
        ▲
        │ GET /v1/snapshot   (mỗi 3s, If-None-Match → 304 nếu không đổi)
  API Gateway: snapshot trong RAM → resolve() chỉ đọc bộ nhớ
```

---

## 2. Các quyết định đã chốt (kế thừa từ gateway)

| # | Quyết định | Ghi chú |
|---|---|---|
| 1 | Registry là **project riêng**, nói chuyện qua **HTTP/JSON** | Gateway chỉ biết interface `ServiceDiscovery` |
| 2 | Tra theo **pattern**, không theo tên service | Service khai báo danh sách `@MessagePattern` khi đăng ký |
| 3 | ~~Mọi dữ liệu nằm trong phạm vi project~~ → **Một registry = một project application, không có project trong registry** | Đổi ngày 2026-11-07 (mục 10d). Muốn nhiều project thì chạy nhiều registry |
| 4 | **Một pattern chỉ thuộc một service** trong registry | Xung đột → 409 |
| 5 | **Self-registration** + **heartbeat = đăng ký lại đầy đủ** (PUT idempotent) | Soft state: registry mất dữ liệu thì tự khôi phục |
| 6 | Lưu **in-memory**, một instance registry | Chấp nhận được nhờ soft state |
| 7 | Ưu tiên **AP** | Registry chết: gateway dùng snapshot cũ, service vẫn chạy |
| 8 | Gateway **poll snapshot + ETag**, không tra registry mỗi request | Data plane chỉ đọc RAM |
| 9 | Lỗi theo **RFC 9457** (`application/problem+json`) | Giống gateway |
| 10 | Stack theo scaffold: **NestJS 12, ESM, Vitest** | Import tương đối có đuôi `.js` |

---

## 3. Trách nhiệm của registry

| # | Trách nhiệm | Chi tiết |
|---|---|---|
| 1 | **Đăng ký / heartbeat** | Cùng một lệnh `PUT`, luôn gửi đủ dữ liệu. Cập nhật `lastSeen` bằng đồng hồ của registry. |
| 2 | **Lease TTL** | `sweep()` chạy mỗi `TTL/3`, gỡ instance có `now - lastSeen > TTL`. Lưới an toàn cho instance crash/SIGKILL. |
| 3 | **Huỷ đăng ký** | `DELETE` khi service tắt êm → gateway thôi gửi ở lần poll kế, không chờ TTL. |
| 4 | **Chặn xung đột pattern** | Pattern đang do service khác giữ (còn instance sống) → 409 `PATTERN_CONFLICT`. Instance cuối của service chủ bị gỡ thì pattern được giải phóng. |
| 5 | **Một bảng duy nhất** | Không khoá theo project; cách ly giữa các project bằng cách chạy registry riêng. |
| 6 | **Snapshot có phiên bản** | `version` của registry, **chỉ tăng khi bảng đổi**; heartbeat thuần không tăng → gateway nhận 304. |
| 7 | **ETag kèm `bootId`** | `ETag = "<bootId>-<version>"`. Không có `bootId` thì registry restart đếm lại từ 0, gateway có thể nhận 304 sai. |
| 8 | **Validate đầu vào** | Gom mọi lỗi, trả 400 problem+json. |
| 9 | **Bảo vệ ghi (tuỳ chọn)** | `REGISTRY_TOKEN` đặt thì `PUT`/`DELETE` cần header `x-registry-token`. |
| 10 | **Health + trang quản trị** | `GET /health`, `GET /v1/overview` (JSON), `GET /lists` (HTML). |

---

## 4. Mô hình dữ liệu

```ts
/** Body service gửi lên khi PUT. */
interface RegistrationInput {
  service: string;     // tên service (log/metrics), KHÔNG dùng để định tuyến
  host: string;        // advertise host: địa chỉ bên khác gọi tới, không bao giờ là 0.0.0.0
  port: number;        // cổng TCP của microservice
  patterns: string[];  // các @MessagePattern service xử lý
  metadata?: Record<string, string>;
}

/** Bản ghi registry giữ trong RAM. */
interface InstanceRecord extends RegistrationInput {
  id: string;
  lastSeen: number;     // monotonic clock (performance.now), dùng để tính TTL
}

/** GET snapshot trả về (cùng hình dạng file discovery tĩnh của gateway). */
interface Snapshot {
  version: number;
  instances: Array<{ id: string; service: string; host: string; port: number; patterns: string[] }>;
}
```

Cấu trúc bên trong `RegistryStore`:
```
version: number,
instances: Map<id, InstanceRecord>,
owners: Map<pattern, service>     // để kiểm tra xung đột O(1)
```

**Quy tắc khi `register(id, input)`:**
1. Validate `input`.
2. Kiểm tra xung đột **trước khi ghi**: với mỗi pattern, nếu `owners` có service khác `input.service` → ném `PatternConflictError` (không ghi gì cả, tránh ghi dở).
3. So với bản ghi cũ cùng `id`: nếu `service/host/port/patterns/metadata` khác (hoặc mới hoàn toàn) → ghi đè, tính lại `owners`, `version++`. Nếu giống hệt → chỉ cập nhật `lastSeen` (heartbeat).
4. Trả `{ leaseTtlMs, heartbeatIntervalMs }`.

**Vì sao `lastSeen` dùng monotonic clock:** `Date.now()` có thể nhảy (NTP chỉnh giờ, đổi giờ hệ thống) làm instance bị gỡ oan hoặc sống mãi. `performance.now()` chỉ tăng.

---

## 5. HTTP API

| Method | Path | Thành công | Lỗi |
|---|---|---|---|
| `PUT` | `/v1/instances/:id` | 200 `{ leaseTtlMs, heartbeatIntervalMs }` | 400 dữ liệu sai · 401 sai token · 409 xung đột pattern |
| `DELETE` | `/v1/instances/:id` | 204 (không tồn tại cũng 204: idempotent) | 401 |
| `GET` | `/v1/snapshot` | 200 + `ETag`; `If-None-Match` khớp → 304 | |
| `GET` | `/v1/overview` | 200 JSON service → instance + health | |
| `GET` | `/health` | 200 `{ status: "ok" }` | |

Registry chưa có instance nào → snapshot rỗng `{ version: 0, instances: [] }` (200, không phải 404): gateway coi như "chưa ai đăng ký".

Ví dụ:
```http
PUT /v1/instances/echo-1
Content-Type: application/json

{ "service": "echo", "host": "127.0.0.1", "port": 4001,
  "patterns": ["user.getById", "user.list", "user.create", "auth.login"] }
```
```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{ "type": "about:blank", "title": "Conflict", "status": 409, "code": "PATTERN_CONFLICT",
  "detail": "Pattern \"user.getById\" is already handled by service \"user\"." }
```

**Validate:**
- `service`: `^[a-z0-9][a-z0-9-]{0,62}$`
- `id`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`
- `host`: chuỗi không rỗng, **khác** `0.0.0.0` và `::`
- `port`: số nguyên 1–65535
- `patterns`: mảng 1–500 phần tử, string không rỗng, không trùng
- Body tối đa 64KB

**Env:**
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8500` | Cổng HTTP |
| `REGISTRY_LEASE_TTL_MS` | `15000` | Lease TTL; heartbeat = TTL/3, sweep = TTL/3 |
| `REGISTRY_TOKEN` | (trống) | Bật kiểm tra token cho `PUT`/`DELETE` |

Config sai (VD TTL không phải số dương) → **không khởi động** (fail-fast).

---

## 6. Cấu trúc code

```
apps/service-discovery/
├── documents/ (PLAN.md, KNOWLEDGE.md)
├── src/
│   ├── main.ts                     đọc config → listen → enableShutdownHooks
│   ├── app.module.ts
│   ├── config.ts                   parse + validate env (fail-fast)
│   ├── registry/                   CORE thuần, không import NestJS
│   │   ├── types.ts                RegistrationInput, InstanceRecord, Snapshot
│   │   ├── clock.ts                interface Clock { now(): number } + systemClock
│   │   ├── validation.ts           validate input, gom mọi lỗi
│   │   ├── errors.ts               ValidationError, PatternConflictError
│   │   ├── registry-store.ts       register / deregister / sweep / snapshot / overview
│   │   └── registry-store.spec.ts
│   └── http/                       lớp mỏng NestJS
│       ├── registry.controller.ts  HTTP ↔ store; ETag / 304
│       ├── sweeper.service.ts      setInterval(sweep, TTL/3); clear khi shutdown
│       ├── token.guard.ts
│       └── problem.filter.ts       lỗi → application/problem+json
└── test/registry.e2e-spec.ts       supertest
```

- Xoá các file mẫu của scaffold (`app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`).
- Core nhận `Clock` qua constructor → test "tua" thời gian, không `sleep` thật.

---

## 7. Lộ trình

| Phần | Nội dung | Trạng thái |
|---|---|---|
| 1 | `apps/service-discovery`: RegistryStore + HTTP API + test | ✅ |
| 2 | `registry-client` (NestJS module) + tích hợp vào echo-service | ✅ |
| 3 | `RegistryDiscovery` trong gateway (poll snapshot, stale-on-error) | ✅ |

**Mỗi phần: plan → duyệt → code → dừng để bạn review → bạn bảo mới commit.**

### Phần 1 chia nhỏ
1. Dọn scaffold, `config.ts` + test.
2. `registry/` core: types, clock, validation, errors, `RegistryStore` + unit test.
3. HTTP: controller, problem filter, token guard, sweeper.
4. e2e test + chạy thử bằng `curl`.
5. Cập nhật KNOWLEDGE.md + README.

### Phần 2 (tóm tắt): client đăng ký (nay là lib dùng chung, xem mục 10e)
- `ServiceDiscoveryModule.forRoot()`: mọi cấu hình đọc từ env (`REGISTRY_URL`, `PORT`, ...), tuỳ chọn ghi đè bằng option.
- Tự thu thập `@MessagePattern` bằng `DiscoveryService` + `MetadataScanner`; bỏ `@EventPattern`; pattern không phải string → bỏ qua + cảnh báo.
- Vòng đời: bootstrap → PUT + heartbeat theo `heartbeatIntervalMs` registry trả về (timer `unref`); registry chết → service vẫn chạy, thử lại nhịp kế; 409 → log lỗi rõ; shutdown → `DELETE` best effort.
- `instanceId` mặc định `<service>-<hostname>-<port>`.

### Phần 3 (tóm tắt): gateway
- `src/gateway/discovery/registry-discovery.ts` implements `ServiceDiscovery` hiện có → `GatewayHandler` không đổi.
- `start()` tải lần đầu; lỗi vẫn khởi động (bảng rỗng → 503) và thử lại nền.
- Poll mỗi `GATEWAY_REGISTRY_POLL_MS` (3000) với `If-None-Match`; lỗi → giữ bản cũ, log có giới hạn tần suất.
- Config: `GATEWAY_REGISTRY_URL` **hoặc** `GATEWAY_DISCOVERY_FILE` (đúng một).
- Instance bị kill bị gỡ khỏi gateway sau tối đa `TTL + poll` ≈ 18s.

---

## 8. Test

**Unit `RegistryStore`** (Node 22 chạy được nhờ Vitest):
- Đăng ký mới → có trong snapshot, `version` tăng.
- Heartbeat giống hệt → `version` **không** tăng, `lastSeen` cập nhật.
- Đăng ký lại cùng `id` khác `patterns`/`port` → `version` tăng, `owners` tính lại.
- Hết TTL → `sweep()` gỡ, `version` tăng; chưa hết TTL → giữ.
- Service khác giữ pattern → `PatternConflictError`, **không ghi gì**.
- Instance cuối của service chủ hết hạn → service khác đăng ký được pattern đó.
- Cùng service nhiều instance cùng pattern → hợp lệ.
- `deregister` → gỡ; id không tồn tại → không lỗi, không tăng version.
- Một pattern, một service áp dụng cho toàn registry (không còn phạm vi project).

**Unit `validation`, `config`.**

**e2e HTTP:** PUT → snapshot (200 + ETag) → snapshot với `If-None-Match` (304) → PUT đổi → ETag mới → DELETE (204) → 409 → 400 → 401 khi có token.

**Kiểm chứng tay:**
```bash
curl -X PUT localhost:8500/v1/instances/echo-1 \
  -H 'content-type: application/json' \
  -d '{"service":"echo","host":"127.0.0.1","port":4001,"patterns":["user.getById"]}'
curl -i localhost:8500/v1/snapshot
# chờ > 15s không heartbeat → snapshot rỗng
```

---

## 9. Ngoài phạm vi
Nhiều instance registry / replication (gossip, Raft), lưu bền, health check chủ động từ registry, self-preservation, watch/long-poll, mTLS, Docker.

---

## 10. Quyết định đã chốt khi triển khai (trước là câu hỏi mở)

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Mỗi app là repo riêng? | Có (api-gateway, service-discovery). ~~`registry-client` là bản copy trong từng service~~ → **đổi ngày 2026-11-07: lib dùng chung `libs/service-discovery-client`** (mục 10e) |
| 2 | Express hay Fastify? | **Express** (giữ scaffold) |
| 3 | TTL / heartbeat / poll | **15s / 5s / 3s** |

**Thay đổi so với thiết kế ban đầu (phát sinh khi code):**
- **Hết hạn lazy + quét định kỳ:** `register`/`snapshot` gỡ instance hết hạn trước khi xử lý; sweeper chỉ dọn khi không ai hỏi. Log "expired" qua hook `onExpire` của store.
- **Version không bao giờ lùi** trong một lần chạy, kể cả khi registry hết instance.
- **Bỏ `registeredAt`**: không dùng trong logic.
- `PUT` trả thêm `status: created | updated | renewed`: client phát hiện registry vừa restart (đang `registered` mà nhận `created`).
- Client **chỉ đăng ký khi địa chỉ quảng bá đã nhận được kết nối TCP** (module tự thăm dò, không phụ thuộc `main.ts`), **deregister ở `beforeApplicationShutdown`** (trước khi NestJS đóng cổng TCP). Bản đầu để `main.ts` gọi `start()` sau `listen()`; bản lib bỏ bước đó (mục 10e).
- Gateway poll bằng **`setTimeout` nối tiếp** + timeout 2s mỗi lần gọi; chỉ log khi trạng thái đổi.

## 10b. Kết quả kiểm chứng chạy thật (2026-11-06)

TTL 6s, gateway poll 1s, 2 echo:

| Kịch bản | Kết quả |
|---|---|
| 2 echo tự đăng ký | Pattern tự quét đúng 4 pattern; request chia 2/2 |
| `SIGKILL` echo-2 | Bị gỡ sau ~5s |
| `SIGTERM` echo-1 | Deregister ngay |
| Tắt registry | Gateway giữ snapshot cũ, vẫn 200 |
| Bật lại registry | Echo tự đăng ký lại qua heartbeat; version về 1, ETag khác nhờ bootId |
| Gateway khởi động khi registry tắt | 503, bật registry thì tự phục hồi |

**Test:** registry 55 unit + 10 e2e (Vitest, chạy được trên Node 22); gateway thêm 14 test (`registry-discovery`, `config`); echo-service 15 test client. `pattern-collector.spec.ts` cần Node ≥ 24.9 (Jest + NestJS ESM), đã kiểm chứng bằng lần chạy thật.

## 10c. Trang quản trị `/lists` (2026-11-07)

**Yêu cầu:** một trang HTML liệt kê service đã đăng ký, health của từng instance và pattern của từng service.

| Quyết định | Chọn | Lý do |
|---|---|---|
| Health | **Thụ động, theo tuổi heartbeat**: `healthy` nếu ≤ 1.5 nhịp (7.5s), `late` nếu đã lỡ nhịp nhưng chưa hết TTL | Không thêm kết nối từ registry tới service; đúng mô hình Eureka |
| Cập nhật | **Tự cập nhật mỗi 2s**, có nút tạm dừng, dừng khi tab ẩn | |
| Render | **Server render** bằng hàm thuần; JS chỉ gọi `/lists?partial=1` rồi thay nội dung | Một chỗ render duy nhất, luôn escape; trang vẫn xem được khi tắt JS |
| Bảo mật | Escape mọi chuỗi + **CSP có nonce** (script) + `no-store`, `nosniff` | `patterns`/`metadata`/`host` do service gửi lên → nguy cơ stored XSS |

**Code:**
- `registry/registry-store.ts`: `overview()` gom service → instance; thêm `registeredAt` (giờ thực, chỉ hiển thị, giữ nguyên qua heartbeat/update) qua option `wallClock`.
- `http/overview.page.ts`: `renderOverviewPage`, `renderOverviewContent`, `escapeHtml` (hàm thuần, test không cần trình duyệt).
- `http/overview.controller.ts`: `GET /v1/overview` (JSON), `GET /lists` (HTML, `?partial=1` chỉ trả phần nội dung).

**Test:** 4 unit (`overview`: gom nhóm, ngưỡng healthy/late, ẩn instance hết hạn, giữ `registeredAt`) + 5 e2e (JSON, CSP nonce, nonce mới mỗi lần, escape XSS, partial + trạng thái rỗng). Đã chụp màn hình chạy thật ở chế độ sáng/tối/màn hẹp.

**Chưa làm:** health check chủ động (registry tự kết nối TCP tới service), lịch sử (instance đã bị gỡ lúc nào).

## 10d. Bỏ khái niệm project khỏi registry (2026-11-07)

**Quyết định (của bạn):** mỗi project application có **registry riêng**, nên registry chỉ cần quản lý service nào đăng ký vào nó, không cần chia theo project. Đảo lại quyết định #3 ở mục 2.

| Thay đổi | Trước | Sau |
|---|---|---|
| API | `/v1/projects/:project/instances/:id`, `/v1/projects/:project/snapshot`, `/v1/projects` | `/v1/instances/:id`, `/v1/snapshot` (bỏ `/v1/projects`) |
| `RegistryStore` | `Map<project, state>` | một bảng; `register(id, body)`, `deregister(id)`, `snapshot()` |
| Snapshot | `{ project, version, instances }` | `{ version, instances }` |
| `/lists` | nhóm theo project, ô lọc project | thẻ service ngay dưới phần tổng hợp, chỉ còn ô tìm |
| Client (echo-service) | env `REGISTRY_PROJECT` | bỏ; chỉ cần `REGISTRY_URL` và `PORT` (xem mục 10e) |
| Gateway `ServiceDiscovery` | `resolve(project, pattern)` | `resolve(pattern)` |
| File discovery tĩnh | mỗi instance có `project` | bỏ field `project` |
| Khoá cân bằng tải | `project\|pattern` | `pattern` (một gateway chỉ phục vụ một project) |

**Không đổi:** `GATEWAY_PROJECT` vẫn dùng để chọn file spec (`specs/<project>/openapi.yml`) và gửi `meta.project` cho service; không liên quan tới registry.

**Đánh đổi chấp nhận:** không dùng chung một registry cho nhiều project; quy tắc "một pattern một service" áp dụng cho cả registry; phá vỡ API cũ (không giữ route cũ). Đổi lại bỏ được một lớp cấu hình và một lỗi hay gặp (service đặt `REGISTRY_PROJECT` lệch `GATEWAY_PROJECT` thì gateway âm thầm trả 503).

## 10e. Client thành lib dùng chung `@org/service-discovery-client` (2026-11-07)

**Vấn đề:** client nằm trong `echo-service/src/registry/` (4 file, ~330 dòng). Mỗi service mới phải copy cả thư mục; đổi giao thức với registry (như vừa bỏ project) phải sửa mọi bản.

**Quyết định (của bạn):** gom thành lib trong monorepo `libs/service-discovery-client`; mỗi service chỉ cần **import module + khai báo env**.

```ts
@Module({ imports: [ServiceDiscoveryModule.forRoot()], controllers: [UserController] })
export class AppModule {}
```
```
# .env của service
PORT=4001
REGISTRY_URL=http://localhost:8500
```

| Chủ đề | Chốt |
|---|---|
| Nơi đặt / cách dùng | `libs/service-discovery-client`, npm workspaces (`libs/*`), Nx build; service trong monorepo dùng qua `"@org/service-discovery-client": "*"` |
| Cổng | **Biến `PORT`** mà service đã có (cũng dùng cho `createMicroservice` trong `main.ts`). Module không tự biết cổng vì NestJS không cho module đọc cấu hình của `createMicroservice` |
| Địa chỉ quảng bá | **Tự phát hiện** IPv4 đầu tiên không phải loopback; ghi đè bằng `SERVICE_ADVERTISE_HOST`; offline thì lùi về `127.0.0.1` (có log) |
| Tên service | `SERVICE_NAME`, mặc định `name` trong package.json (bỏ `@scope/`) |
| Khi nào đăng ký | Module chạy nền ở `onApplicationBootstrap`: **thăm dò TCP tới `advertiseHost:PORT` đến khi nhận kết nối** rồi mới đăng ký. Không cần `main.ts` gọi gì (microservice chỉ mở cổng sau hook này) |
| Huỷ đăng ký | `beforeApplicationShutdown` (cần `app.enableShutdownHooks()` trong `main.ts`) |
| Không có `REGISTRY_URL` | Module tắt, in một dòng cảnh báo; service chạy như thường |
| Cấu hình sai | Fail-fast lúc khởi tạo provider, **trước khi mở cổng** (thiếu `PORT`, URL sai, tên service sai, host `0.0.0.0`) |

**Chi tiết kỹ thuật đáng nhớ:**
- **Đọc env lazy:** `forRoot()` chạy khi file module được import, thường *trước* khi `main.ts` kịp nạp `.env`. Nên gộp cấu hình trong `useFactory` của provider (lúc `NestFactory.create`), không phải trong `forRoot()`. Vì vậy dùng `forRoot()` không tham số.
- **Lib CJS** (không `"type": "module"`), `@nestjs/*` là **peerDependencies**: mọi service dùng chung một bản `@nestjs/common` (hai bản thì DI/decorator metadata không nhận nhau).
- **Lib có bước build** (khác khuyến nghị "không build" của generator): service chạy bằng `nest build` (tsc) nên Node cần JS thật lúc chạy. `nx.json` có `targetDefaults` `dependsOn: ["^build"]` để build lib trước.
- Test của lib dùng **Vitest** nên chạy được trên Node 22, kể cả `pattern-collector` (trước đây kẹt vì Jest + NestJS ESM).
- Đổi `ECHO_PORT` thành `PORT` trong echo-service cho thống nhất với gateway.

**Đánh đổi:** service nằm ngoài monorepo (như api-gateway, repo riêng) chưa dùng được cho tới khi publish package; chấp nhận vì gateway không cần (có `RegistryDiscovery` riêng).

**Test:** lib 33 test (options, registry-client, pattern-collector, module tích hợp với microservice TCP thật + registry giả). Chạy thật: echo tự đăng ký qua lib, instance thứ hai chỉ cần `PORT=4002`, SIGTERM huỷ đăng ký ngay, gateway chia request qua registry.

## 11. Cách làm việc
- Claude viết code, bạn đọc, hiểu và hỏi lại. Mỗi file: giải thích "tại sao" trước, kèm câu hỏi phỏng vấn liên quan.
- Code xong thì **dừng để bạn review, không tự commit**.
- Sau mỗi phần cập nhật [KNOWLEDGE.md](./KNOWLEDGE.md).
