# HTK Agent Approval

> Hàng đợi tác vụ cho AI agent: mỗi bước được lưu bền vững, dừng chờ con người phê duyệt diff, chạy lại an toàn sau restart và áp dụng thay đổi theo kiểu idempotent trong sandbox.

## Demo

- Live: https://htk-agent-approval.vercel.app
- Health: https://htk-agent-approval.vercel.app/api/health
- Tài khoản demo: `demo@htk.dev` / `Demo12345!`

Chạy local 3 bước:

```bash
npm install
npm run dev
# mở http://localhost:3000, đăng nhập bằng tài khoản demo ở trên
```

Demo có sẵn 8 đề xuất đã xử lý (7 completed, 1 rejected) để xem timeline, diff và audit log.

## Bài toán

Agent tự động sửa dependency, đổi config hoặc gửi email hàng loạt rất hữu ích, nhưng không thể cho nó chạy không giám sát. Nếu process chết giữa chừng, làm sao biết bước nào đã xong? Nếu worker retry, làm sao không gửi email hai lần? Nếu con người cần xem diff trước khi áp dụng, trạng thái đó phải tồn tại qua restart chứ không nằm trong RAM. Hệ thống này biến mỗi đề xuất thành một state machine có bằng chứng: từng bước, từng lần thử, từng quyết định duyệt đều được ghi lại.

## Tính năng chính

- Ba loại đề xuất có planner thật: `dependency_bump` (semver), `bulk_email` (1–5 người nhận, kiểm tra email), `config_change` (allowlist 4 key).
- Planner tạo diff và mức rủi ro (`low/medium/high`) trước khi xếp hàng; input sai bị chặn ở API với lỗi tiếng Việt cụ thể.
- State machine 5 bước `validate → simulate → await_approval → apply → verify`, lưu từng bước vào bảng `run_steps` nên có thể resume sau restart, pause/resume giữa chừng.
- Chặn cứng tại `await_approval`: worker không bao giờ tự vượt qua bước chờ người duyệt.
- UI duyệt diff: xem unified diff, risk, timeline 5 bước, output từng bước, nút approve/reject/pause/resume.
- Retry có trần: tối đa 3 lần mỗi bước, lỗi được ghi vào `last_error` và audit; đề xuất hết hạn sau 24 giờ.
- Apply idempotent: khóa `apply:<runId>` unique trong `tool_calls`; tick lại sau khi xong không tạo bản ghi thứ hai.
- Sandbox cô lập: chỉ ghi vào `sandbox_state` và `outbox` trong DB demo, không chạy shell, không gửi email thật; bước `verify` đọc lại dữ liệu để xác nhận.
- Audit log bất biến theo thứ tự thời gian: tạo, bắt đầu, yêu cầu duyệt, duyệt/từ chối, retry, hoàn tất, hết hạn.
- Auth thật (scrypt + session cookie httpOnly), mỗi tài khoản chỉ thấy đề xuất của mình; rate limit tạo 10/phút, thao tác 30/phút, worker 60/phút.
- Loading, empty, error state cho mọi khối UI; responsive 375px và 1440px; nút có focus ring và `aria-live` cho thông báo.

## Tech stack & quyết định kiến trúc

- **Next.js 15 App Router + TypeScript** cho UI và API routes, deploy Vercel.
- **PostgreSQL (PGlite 0.5)** trong Node runtime; local dùng `./.data/pg`, production snapshot JSON lên **Vercel Blob private**.
- **Worker kiểu pull**: `POST /api/worker/tick` xử lý tối đa 5 run, mỗi run tối đa 6 bước, trả về số run đã chạm.
- **Vitest** cho planner/state machine/retry/expiry.

Trade-off thật:

1. **State machine lưu DB thay vì biến trong RAM**: chậm hơn vài ms mỗi bước nhưng sống sót qua cold start và cho phép pause/resume. Đây là yêu cầu cốt lõi, không phải lựa chọn thẩm mỹ.
2. **Worker poll bằng endpoint thay vì queue managed (SQS/Redis)**: không cần thêm dịch vụ/billing, nhưng tick là best-effort và không có backoff lịch tự động. Người dùng bấm "Chạy worker" hoặc cron gọi endpoint; với tải thật nên thay bằng queue + visibility timeout.
3. **Planner tất định, không gọi LLM**: diff và risk tính từ rule nên tái lập được, test được, không tốn token; đổi lại không hiểu yêu cầu ngôn ngữ tự do. Agent "suy nghĩ" là code kiểm chứng được, không phải hộp đen.
4. **Sandbox chỉ ghi DB thay vì container**: tuyệt đối an toàn cho demo nhưng không chứng minh được thay đổi trên filesystem thật. Bước apply/verify vẫn giữ đúng ngữ nghĩa idempotent để có thể thay adapter sau.
5. **Vercel-only thay vì backend Go/Flask riêng**: giảm một deployment và một nguồn lỗi; đổi lại worker bị giới hạn thời gian serverless (đã đặt `maxDuration = 30`).

## Chạy local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Mặc định local dùng PGlite file tại `./.data/pg` và có sẵn user demo + 8 run mẫu. Muốn dùng Blob như production thì đặt `BLOB_READ_WRITE_TOKEN` và chạy với `VERCEL=1`.

Migration chạy tự động từ zero trong `lib/migrations.ts` (users, sessions, runs, run_steps, tool_calls, sandbox_state, outbox, audit_logs, rate_limits, request_logs).

Luồng thử nhanh trên UI:

1. Tạo đề xuất `config_change` với `checkout_enabled = true`; bấm **Chạy worker** đến khi trạng thái `awaiting_approval`.
2. Đọc diff, bấm **Duyệt**, bấm **Chạy worker** đến `completed`; xem output `apply` và `verify`.
3. Tạo đề xuất `bulk_email`, approve, hoàn tất; bấm worker lần nữa và xác nhận `outbox` vẫn đúng số người nhận (idempotent).

## Kiểm thử

```bash
npm test          # 7 test: diff/risk, semver, giới hạn người nhận, allowlist, thứ tự bước, retry cap, expiry/terminal
npm run build     # type-check + production build
```

Kết quả: **7/7 test pass**, build production thành công.

## Metrics / Evaluation

Đo ngày 2026-11-11 trên bản live `https://htk-agent-approval.vercel.app` bằng luồng E2E thật:

| Metric | Kết quả | Cách đo |
| --- | --- | --- |
| Run E2E hoàn tất | **7/7 completed**, 1 rejected | Tạo → worker → approve → worker, kiểm tra từng run |
| Thứ tự bước | **5/5 done** (`validate`, `simulate`, `await_approval`, `apply`, `verify`) | `GET /api/runs` |
| Idempotency apply | **outbox 2/2** sau khi tick lại run đã completed | So sánh output `verify` trước/sau |
| Approval latency p50 / p95 | **2.366 ms / 3.718 ms** (7 mẫu) | `GET /api/metrics`, chênh lệch audit `approval_requested` → `approved` |
| Request latency p50 / p95 | **145 ms / 5.393 ms** (30 request, gồm cold start) | `GET /api/metrics` |
| Retry | **0** trên luồng thành công | `GET /api/metrics` |
| Rate limit | **429 ở request tạo thứ 10/phút** | Gửi 12 request liên tiếp |

Lưu ý trung thực: approval latency ở đây là thời gian script chờ trước khi bấm duyệt, không phải thời gian suy nghĩ của người thật. p95 request bị cold start PGlite + tải snapshot Blob chi phối. Chưa đo tải đồng thời nhiều user, chưa có benchmark worker 100+ run.

## Deploy

- Frontend + API: Vercel (`vercel deploy --prod --yes`).
- Lưu trữ: Vercel Blob private store `htk-agent-data`, biến `BLOB_READ_WRITE_TOKEN` đặt ở Production/Preview/Development.
- Docker (self-host, DB file bền vững trong volume):

```bash
docker build -t htk-agent-approval .
docker run -p 3000:3000 -v agent-data:/data htk-agent-approval
```

Khi chạy Docker không có Blob token, ứng dụng dùng PGlite tại `/data/pg` và không phụ thuộc Vercel.

## Cấu trúc

```text
app/                # trang + API routes (runs, action, worker, audit, metrics)
components/         # AuthForm, Workspace
lib/engine.ts       # planner, diff, risk, state helpers
lib/worker.ts       # advanceOnce, idempotentApply, decideRun, setPaused
lib/runs.ts         # đọc run + steps cho UI/API
lib/migrations.ts   # schema từ zero
```

## Tác giả

HTK 0396241674
