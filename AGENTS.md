# AGENTS.md

Lockin (`lockin-next`): nhóm bạn chốt kèo đi chơi bằng một link; app giải trí trong hệ sinh thái hoandat. Đọc `README.md` và `docs/deployment-guide.md` trước khi làm. Repo này là mẫu tham chiếu của chuẩn deploy.

## Gate trước khi báo xong

`pnpm lint` → `pnpm typecheck` → `pnpm test`. Máy dev dùng chung: local chỉ chạy lint, typecheck và đúng file test liên quan (`pnpm vitest run <file>`); bộ đầy đủ chạy trên CI (push `main` rồi `gh run watch`). Chỉ dùng `pnpm`, không dùng npm.

## Deploy prod

Không có môi trường dev hay staging: xong việc, push hết lên `main`, kiểm `ci`, rồi `bash ../tools/deploy-prod.sh lockin-next` (script của workspace `hoandat-app`). Không cần hỏi trước. Vẫn hỏi trước khi ghi dữ liệu tay, restore, sửa bí mật/OAuth hay chạy script setup. Chuẩn chung: `../docs/deploy-standard.md`; riêng repo này: `docs/deployment-guide.md`.

## Repo công khai

Không commit IP, cổng SSH, user máy chủ, secret hay file env. Env production nằm ngoài repo ở iCloud `ENV production/<tên dự án>/`. Tên sản phẩm chỉ khai ở `brand.config.json`; `pnpm check:brand` chặn viết cứng.
