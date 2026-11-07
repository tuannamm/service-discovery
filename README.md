# Service Registry

Sổ danh bạ động cho hệ thống microservices: service **tự đăng ký** kèm danh sách `@MessagePattern`, giữ chỗ bằng **heartbeat**, quá **lease TTL** thì bị gỡ; API Gateway **đồng bộ snapshot** qua HTTP + ETag.

- Thiết kế: [documents/PLAN.md](./documents/PLAN.md)
- Kiến thức ôn phỏng vấn: [documents/KNOWLEDGE.md](./documents/KNOWLEDGE.md), câu hỏi: [documents/INTERVIEW-QUESTIONS.md](./documents/INTERVIEW-QUESTIONS.md)
- Bản trực quan: mở `knowledge.html` (sinh lại bằng `npm run docs:knowledge` sau khi sửa markdown)

## Chạy

```bash
npm run build && npm run start:prod     # hoặc: npm run start:dev
```

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8500` | Cổng HTTP |
| `REGISTRY_LEASE_TTL_MS` | `15000` | Lease TTL; heartbeat và sweep = TTL/3 |
| `REGISTRY_TOKEN` | (trống) | Đặt thì `PUT`/`DELETE` cần header `x-registry-token` (tối thiểu 16 ký tự) |

## API

| Method | Path | Kết quả |
|---|---|---|
| `PUT` | `/v1/projects/:project/instances/:id` | 200 `{ status, leaseTtlMs, heartbeatIntervalMs }` · 400 · 401 · 409 |
| `DELETE` | `/v1/projects/:project/instances/:id` | 204 (idempotent) |
| `GET` | `/v1/projects/:project/snapshot` | 200 + `ETag`; `If-None-Match` khớp → 304 |
| `GET` | `/v1/projects` | Danh sách project |
| `GET` | `/v1/overview` | JSON toàn cảnh: project → service → instance, kèm health |
| `GET` | `/lists` | **Trang HTML**: service đang đăng ký, health, pattern; tự cập nhật mỗi 2s |
| `GET` | `/health` | Liveness |

```bash
curl -X PUT localhost:8500/v1/projects/example/instances/echo-1 \
  -H 'content-type: application/json' \
  -d '{"service":"echo","host":"127.0.0.1","port":4001,"patterns":["user.getById"]}'
curl -i localhost:8500/v1/projects/example/snapshot
```

## Chạy cả hệ thống local

```bash
# 1. Registry
cd apps/service-discovery && npm run start:dev
# 2. Hai echo tự đăng ký (echo tự nạp .env; biến trên dòng lệnh thắng .env)
cd apps/echo-service
cp .env.example .env          # lần đầu: đã có REGISTRY_URL, REGISTRY_PROJECT, REGISTRY_ADVERTISE_HOST
npm run start:dev                       # instance 1, cổng 4001
ECHO_PORT=4002 npm run start:dev        # instance 2
# Thấy "Registered example/..." là đã đăng ký; thấy "Registry disabled" là thiếu REGISTRY_URL
# 3. Gateway đọc từ registry
cd apps/api-gateway
GATEWAY_PROJECT=example GATEWAY_DISCOVERY_FILE= GATEWAY_REGISTRY_URL=http://localhost:8500 npm run start:dev
curl localhost:3000/users/42
```

## Test

```bash
npm test             # unit (Vitest, chạy được trên Node 22)
npm run test:e2e     # HTTP thật bằng supertest
```
