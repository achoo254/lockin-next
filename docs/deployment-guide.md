# Triển khai Lockin (`lockin.hoandat.com`)

Runbook deploy của repo này. Quy tắc chung của hệ sinh thái (tên, IdP, brand, box `.65` dùng chung):
`docs/ecosystem-architecture.md` của workspace `hoandat-app`. Repo public: không ghi IP, cổng SSH hay user máy chủ
vào đây; dùng alias SSH (`SSH_TARGET`) và placeholder như `<SERVER_65_IP>`, `<SSH_PORT>`.

## Kiến trúc chạy

| Phần | Ở đâu |
|---|---|
| Web (React + Vite, tĩnh) | `/var/www/lockin/current/apps/web/dist`, nginx phục vụ trực tiếp |
| API (Node, Express 5, một file bundle) | systemd `lockin-server`, loopback `127.0.0.1:5310`, Node 22 ở `/opt/node22` |
| Database | Postgres đang chạy trên `.65`, database `lockin`, role `lockin`; migration chạy khi server khởi động |
| Đường vào | Cloudflare (proxied, SSL "full") → nginx `conf.d/lockin.hoandat.com.conf` → `/api/`, `/auth/`, `/k/`, `/healthz` sang API |
| Đăng nhập | client BFF `lockin-web` trên `auth.hoandat.com`, scope `openid profile email`, callback `https://lockin.hoandat.com/auth/callback`; tên, email, ảnh lấy từ userinfo lúc đăng nhập, lưu ở bảng `users` cho menu tài khoản |

Cổng `5310` đã kiểm còn trống trên `.65` ngày 02/11/2026 (`5300` là của `truyen-server`). Đổi cổng thì đổi cùng lúc ở
`infra/nginx/lockin.hoandat.com.conf`, `infra/activate-incoming.sh` (`PORT`), `PORT` trong env production, và mục này.

Link kèo `/k/<token>` và API khách `/api/k/<token>/…` mang token chia sẻ trong đường dẫn, nên nginx chuyển chúng cho
server với `access_log off` và `error_log … crit` (lỗi upstream thường ghi kèm dòng request): token không nằm trong
log của nginx. Các trang khác ghi log truy cập theo định dạng `lockin_notoken` (khai ở đầu file site, file được nạp ở
mức `http` qua `conf.d`): chỉ đường dẫn `$uri` (không query string), không `Referer`. Cả site gửi
`Referrer-Policy: no-referrer`, nên trình duyệt cũng không gửi link kèo đi đâu qua `Referer`. `/k/<token>` là trang `index.html` của bản web
đang chạy (`apps/web/dist/index.html`, server đọc một lần mỗi lần khởi động) có thêm thẻ xem trước của kèo
(`apps/server/src/share/og-page.ts`); server gửi kèm đúng CSP của `location /` trong nginx (test giữ hai chuỗi giống
nhau). Khi dev, Vite cũng chuyển `/k/` sang server, server lấy trang từ chính Vite (`PUBLIC_URL`). Server giữ một tiến trình Node, không worker;
unit giới hạn `MemoryHigh=160M`, `MemoryMax=256M`.

Các file: [`infra/nginx/lockin.hoandat.com.conf`](../infra/nginx/lockin.hoandat.com.conf),
[`infra/lockin-server.service`](../infra/lockin-server.service), [`infra/deploy.sh`](../infra/deploy.sh),
[`infra/activate-incoming.sh`](../infra/activate-incoming.sh), [`infra/setup-deploy-user.sh`](../infra/setup-deploy-user.sh),
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

## Biến môi trường

Mẫu: [`.env.example`](../.env.example). Giá trị thật nằm ở thư mục env trên iCloud (`ENV production/lockin-next/`),
không bao giờ trong repo. Trên server là `/etc/lockin/production.env` (`root:lockin`, 640).

| Biến | Production |
|---|---|
| `NODE_ENV` | `production` (bắt buộc có `DATABASE_URL`, `AUTH_CLIENT_SECRET`, `SHARE_TOKEN_KEY`, `PUBLIC_URL` https) |
| `PORT` | `5310` |
| `PUBLIC_URL` | `https://lockin.hoandat.com` |
| `DATABASE_URL` | `postgres://lockin:<mật khẩu>@127.0.0.1:5432/lockin` |
| `AUTH_ISSUER` | `https://auth.hoandat.com` |
| `AUTH_CLIENT_ID` | `lockin-web` |
| `AUTH_CLIENT_SECRET` | secret của client `lockin-web`, cùng giá trị với `LOCKIN_WEB_CLIENT_SECRET` trên IdP (≥ 32 ký tự) |
| `SHARE_TOKEN_KEY` | khoá AES-256-GCM 32 byte dạng base64, mã hoá link chia sẻ để người tạo xem lại link. Tạo một lần: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, lưu cùng thư mục env trên iCloud. Đổi khoá thì mọi link đã lưu không xem lại được (người tạo bấm "Đổi link" để có link mới); link cũ vẫn mở được vì máy chủ tìm theo hash |

Thiếu biến bắt buộc hay sai dạng thì server từ chối khởi động, log nêu tên biến (không bao giờ in giá trị).

## Lần đầu

1. **IdP:** trên `auth-next` đặt `LOCKIN_WEB_CLIENT_SECRET` (client `lockin-web`, redirect
   `https://lockin.hoandat.com/auth/callback`) rồi deploy lại IdP. Việc này thuộc repo `auth-next`.
2. **DNS:** bản ghi `A` `lockin.hoandat.com` **proxied** trỏ về `<SERVER_65_IP>`. Kiểm:
   `dig +short A lockin.hoandat.com @1.1.1.1` trả IP của Cloudflare.
3. **RAM và cổng:** đo `free -m` trước khi cài (ghi vào plan); kiểm cổng như mục Kiến trúc chạy.
4. **Database** (trên `.65`, hỏi người trước):

   ```sh
   sudo -u postgres psql -c "CREATE ROLE lockin LOGIN PASSWORD '<mật khẩu>'"
   sudo -u postgres createdb -O lockin lockin
   ```

   Thêm dòng `host lockin lockin 127.0.0.1/32 scram-sha-256` vào `pg_hba.conf` (cạnh các dòng của sản phẩm khác) rồi
   `systemctl reload postgresql`. Không tạo instance Postgres mới.
5. **Env:** ghi `/etc/lockin/production.env` từ thư mục env trên iCloud qua ssh stdin, không in giá trị ra màn hình.
6. **Cài unit và nginx:** `SSH_TARGET=<alias> bash infra/deploy.sh setup`. Chạy lại sau khi sửa unit hay site nginx:
   unit đổi thì service đang chạy được restart ngay.
7. **Release:** `SSH_TARGET=<alias> bash infra/deploy.sh`.
8. **User CI:** tạo user hạn chế `lockin-deploy` và secret của repo (mục Deploy tự động).

## Deploy tự động (CI)

**Mỗi lần push lên `main` là tự deploy.** `ci` (lint, typecheck, test, build) xanh thì `deploy.yml` chạy:

1. Job `build` (không có secret nào) cài thư viện, `pnpm build`, gói `apps/web/dist`, `apps/server/dist`,
   `apps/server/drizzle` thành artifact; mã bản dạng `YYYYMMDD-HHMMSS-<sha12>`.
2. Job `deploy` (environment `production`) chỉ tải artifact, rsync lên `/var/www/lockin/ci-incoming/<mã bản>` bằng
   user `lockin-deploy`, rồi chạy lệnh sudo duy nhất user đó có: `sudo -n /usr/local/sbin/lockin-activate-incoming <mã bản>`.
3. Lệnh đó (bản cài của `infra/activate-incoming.sh`, root sở hữu) kiểm mã bản, chuyển bản tải lên vào thư mục chỉ
   root đọc được rồi mới kiểm (không link hay tệp đặc biệt; đủ `index.html`, bundle server, `drizzle/meta/_journal.json`),
   ghi mã bản vào `apps/web/dist/RELEASE`, đổi bản như mục Release, hỏng thì quay về bản trước và thoát mã khác 0.
4. Kiểm từ ngoài: `https://lockin.hoandat.com/` trả 200, `/healthz` trả `ok`, `/RELEASE` trả đúng mã bản vừa lên.

User `lockin-deploy` chỉ ghi được `/var/www/lockin/ci-incoming` và chạy đúng lệnh trên qua sudo
(`/etc/sudoers.d/lockin-deploy`); khoá trong `authorized_keys` có `restrict` (không forward, không pty). CI không đổi
được nginx, unit hay script root: những thứ đó chỉ đổi qua `deploy.sh setup`/`deploy.sh` chạy bằng root.

Secret của repo (Settings → Secrets → Actions): `DEPLOY_SSH_KEY` (khoá riêng ed25519 của `lockin-deploy`),
`DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -p <SSH_PORT> -t ed25519,ecdsa,rsa <máy chủ>`), `DEPLOY_HOST`, `DEPLOY_PORT`.

**Tạo hoặc đổi khoá** (lần đầu, hay khi lộ khoá):

```sh
ssh-keygen -t ed25519 -N '' -C lockin-deploy -f lockin-deploy
ssh <alias> 'bash /var/www/lockin/infra/setup-deploy-user.sh' < lockin-deploy.pub   # ghi đè khoá cũ
gh secret set DEPLOY_SSH_KEY -R achoo254/lockin-next < lockin-deploy
rm lockin-deploy lockin-deploy.pub
```

`setup-deploy-user.sh` với stdin rỗng (`< /dev/null`) giữ khoá đang có, chỉ cài lại lệnh sudo. Script cần
`/var/www/lockin/infra` đã có (chạy `deploy.sh setup` hoặc `deploy.sh` một lần trước).

**Deploy tay khi nào:** lần đầu, khi đổi unit/nginx (`setup`), khi sửa `infra/activate-incoming.sh` (mỗi lần chạy
`setup` hay release tay đều cài lại `/usr/local/sbin/lockin-activate-incoming`; CI không tự làm), hoặc khi CI hỏng.
Deploy tay dùng chung bước đổi bản với CI.

## Release

```sh
SSH_TARGET=<alias> [SSH_OPTS="-F <ssh_config>"] bash infra/deploy.sh
```

Script từ chối chạy khi cây làm việc còn thay đổi chưa commit: bản release mang tên commit `HEAD` nên phải đúng là
`HEAD`. Sau đó chạy `pnpm lint`, `typecheck`, `test`, `build` trên máy dev, đẩy `apps/web/dist`, `apps/server/dist`,
`apps/server/drizzle` vào `/var/www/lockin/ci-incoming/<mã bản>`, rồi chạy cùng lệnh đổi bản với CI: chuyển bản sang
`releases/<mã bản>`, trỏ `current` sang bản mới, restart `lockin-server`, kiểm `/healthz` trên loopback và
`https://lockin.hoandat.com/` qua origin. Một bước kiểm hỏng thì script tự trỏ `current` về bản trước, restart, in log
và thoát mã 1. Giữ 5 bản gần nhất. Server không cần `pnpm install`: bundle đã gồm mọi thư viện.

**CSP.** `img-src` cho phép ảnh tài khoản của Google và GitHub trên menu tài khoản; `script-src` chỉ gồm `'self'` và
Cloudflare Web Analytics, vì trang không có script inline. Test `apps/web/index-html.test.ts` giữ đúng hai điều đó.
CSP chỉ đổi khi chạy `setup`.

Kiểm sau release:

- `curl -fsS https://lockin.hoandat.com/healthz` trả `ok`; `curl -fsS https://lockin.hoandat.com/RELEASE` trả mã bản đang chạy.
- Đăng nhập thấy ảnh (hoặc chữ cái đầu) và tên trên header; mở menu, đăng xuất được.
- RSS của service (mục tiêu < 120 MB, không vượt Tử Vi): `systemctl show lockin-server -p MemoryCurrent`.

## Rollback

Release hỏng (CI hay tay) tự quay về bản trước (mục Release). Quay về tay:

```sh
ssh <alias> 'cd /var/www/lockin && ls -1dt releases/*/'          # chọn bản trước
ssh <alias> 'cd /var/www/lockin && ln -sfn releases/<bản trước> current && systemctl restart lockin-server'
```

Migration chỉ thêm bảng/cột; bản cũ chạy được trên schema mới.

Gỡ hẳn app: `systemctl disable --now lockin-server`, xoá `/etc/nginx/conf.d/lockin.hoandat.com.conf` (`nginx -t` rồi
reload), xoá bản ghi DNS, gỡ `LOCKIN_WEB_*` trên IdP.

## Log

`journalctl -u lockin-server`; nginx: `/var/log/nginx/lockin.hoandat.com.{access,error}.log` (không có `/k/` và
`/api/k/`, không `Referer`, không query string). Log của server chỉ ghi lỗi và trạng thái đăng nhập: lỗi truy vấn chỉ ghi mã và thông báo của Postgres,
không ghi câu SQL hay tham số (`apps/server/src/log-error.ts`, có test). Phiên hết hạn bị xoá khi server khởi động,
mỗi giờ và mỗi lần đăng nhập. Mất kết nối Postgres (Postgres chung restart) không làm sập service.
