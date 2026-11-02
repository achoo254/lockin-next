# Lockin

Thư mục repo: `lockin-next` (tên hiển thị lấy từ [`brand.config.json`](brand.config.json), không có hậu tố `-next`).
Chạy tại `https://lockin.hoandat.com`, thuộc tầng giải trí của hệ sinh thái hoandat.com.

Nhóm bạn chốt kèo đi chơi bằng một link: ai cũng tạo được kèo (không cần tài khoản, chỉ cần tên) với vài lựa chọn giờ
và chỗ, gửi một link vào nhóm Zalo hay Messenger; bạn bè mở link, nhập tên và vote, không cần tài khoản; người tạo chốt
giờ và chỗ, cả nhóm thấy kết quả và ai đi. Miễn phí, không gói, không quảng cáo.

**Trạng thái:** đang chạy: tạo kèo (`/new`), màn gửi link (`/plans/<id>`), trang kèo (`/k/<token>`) với thẻ xem trước
link, "Kèo của tôi" (`/plans`), nhật ký phễu và `pnpm stats` (xem [`docs/plans-api.md`](docs/plans-api.md)).

Nút "Lên kèo" ở trang chủ mở thẳng `/new`, không cần đăng nhập. Tạo khi chưa đăng nhập: trình duyệt giữ quyền người tạo
bằng cookie `__Host-lockin_c_<id kèo>`, và người tạo nhận một **link quản lý** riêng (`/m/<id kèo>.<token>`) để mở kèo
trên máy khác; màn gửi link và lúc chốt mời "Lưu kèo vào tài khoản hoandat.com (miễn phí)", đi qua đăng ký/đăng nhập rồi
quay lại với `?claim=<id kèo>` để gắn kèo vào tài khoản. Đã lưu vào tài khoản thì tài khoản là chìa khoá duy nhất: link
quản lý được thay, cookie người tạo không còn quyền. Tạo khi đã đăng nhập: kèo thuộc tài khoản ngay, không có link quản
lý. Người tạo đổi được link quản lý trên màn gửi link. Nút "Đăng nhập" ở header vẫn có cho người chưa đăng nhập.

## Cấu trúc

| Thư mục | Vai trò |
|---|---|
| [`apps/web`](apps/web) | `@lockin/web`: React 19 + Vite + `@achoo254/app-shell`. Trang chủ (câu giá trị, kèo mẫu vẽ bằng HTML/CSS, ba bước), `/login`, trang pháp lý, `/new` và `/k/<token>` tạm, i18n vi/en |
| [`apps/server`](apps/server) | `@lockin/server`: Express 5 + drizzle + Postgres (PGlite khi dev/test). Đăng nhập BFF qua auth-next (client `lockin-web`), phiên riêng (bảng `users`, `sessions`), kiểm Origin, helmet, giới hạn tần suất, `/healthz`; kèo (`plans`, `plan_options`, `participants`, `votes`, `plan_events`), API [`docs/plans-api.md`](docs/plans-api.md) |
| [`infra`](infra) | nginx `lockin.hoandat.com.conf` (`/api/`, `/auth/`, `/k/`, `/healthz` sang server), unit `lockin-server.service`, script deploy |
| [`brand`](brand) | Biểu tượng AI gốc (`app-icon-master-1024.png`) và các file sinh từ nó (`pnpm brand:gen`) |
| [`scripts`](scripts) | `brand-gen`, `check-tokens` (màu chỉ ở `tokens.css`, tương phản WCAG AA) |

Deploy và rollback: [`docs/deployment-guide.md`](docs/deployment-guide.md).

## Chạy

Cần Node và pnpm theo `engines`, `packageManager` trong [`package.json`](package.json).

```sh
pnpm install
pnpm dev          # API ở 127.0.0.1:5310 (PGlite trong .data/), web ở http://localhost:5311
```

Đăng nhập khi dev: đặt `AUTH_CLIENT_SECRET` (và các biến khác theo [`.env.example`](.env.example)) trong file env của
`apps/server`, giá trị lấy từ thư mục env ngoài repo. Không đặt thì app vẫn chạy, nút đăng ký ẩn.

## Kiểm tra

```sh
pnpm lint        # eslint + check:brand (không viết cứng tên app) + check:tokens (màu chỉ ở tokens.css, tương phản WCAG AA)
pnpm typecheck
pnpm test        # vitest: server (PGlite, IdP giả), web (jsdom), script
pnpm build       # web (vite) + bundle server (esbuild)
pnpm brand:gen   # sau khi đổi biểu tượng, màu hay brand.config.json
```

Máy dev dùng chung: không chạy hai việc nặng (test, build, install) cùng lúc.

## Số liệu phễu

```sh
DATABASE_URL=postgres://… pnpm stats                   # mọi tài khoản
DATABASE_URL=postgres://… STATS_EXCLUDE_SUBS=sub1,sub2 pnpm stats --exclude-owner   # bỏ kèo của các tài khoản này
```

Chỉ đọc (mọi transaction `read only`, không chạy migration). In số kèo theo trạng thái, kèo có từ 2 người vote, mở
link → tham gia → vote, kèo chốt, đã đi, huỷ, người tạo quay lại trong 30 ngày, khách thành người tạo. Cách đếm:
[`docs/plans-api.md`](docs/plans-api.md#phễu-và-pnpm-stats).

## Ghi công và giấy phép

Mã nguồn theo giấy phép MIT ([`LICENSE`](LICENSE)). Danh sách thư viện ở trang `/credits`.

Biểu tượng app ([`brand/app-icon-master-1024.png`](brand/app-icon-master-1024.png) và các file sinh từ nó: favicon,
icon PWA, Apple touch, ảnh xem trước link `og-image.png`) không thuộc phạm vi MIT: AI-generated (OpenAI gpt-image-2) for
the hoandat ecosystem; owned by hoandat, all rights reserved (not CC0).
