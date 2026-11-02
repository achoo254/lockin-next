# API kèo

Máy chủ `apps/server` (mã ở [`src/plans`](../apps/server/src/plans), [`src/stats`](../apps/server/src/stats)). Mọi giờ
lưu và trả về là UTC dạng ISO 8601; giao diện tự hiện theo giờ Asia/Ho_Chi_Minh. Mọi lỗi trả `{ "error": "<mã>" }` với
mã ổn định ở bảng cuối. Mọi request đổi dữ liệu phải có `Origin` của app (chống CSRF, như đăng nhập). Trả lời của
`/api/plans…` và `/api/k/…` có `Cache-Control: no-store`.

## Luật

- Trạng thái: `open` → `locked` → `done`; `cancelled` (huỷ khi `open` hoặc `locked`); `expired` (chỉ đọc). Không có nháp.
- Vote: mỗi người chọn nhiều giờ và nhiều chỗ, gửi lại là thay cả bộ; chỉ khi `open` và chưa tới hạn vote.
- Quá hạn vote mà chưa chốt: người tạo vẫn chốt được. Chốt cần một giờ (nếu kèo có lựa chọn giờ) và một chỗ (nếu có
  lựa chọn chỗ); hoà phiếu thì người tạo tự chọn, máy chủ không tự chốt. Chốt là một transaction khoá hàng `plans`
  (`FOR UPDATE`); vote khoá hàng đó `FOR SHARE`, nên không vote nào lọt sau khi chốt và hai lần chốt cùng lúc chỉ một
  lần thắng.
- Sau khi chốt vẫn tham gia và báo đi/không được (thẻ kết quả hiện ai đi), không vote được nữa.
- Sửa một lựa chọn đã có vote (đổi chữ hoặc giờ) thì xoá vote của lựa chọn đó và ghi `option_edited`.
- Giữ dữ liệu ([`retention.ts`](../apps/server/src/plans/retention.ts), dùng chung với trang Quyền riêng tư): kèo còn
  `open`/`locked` 30 ngày sau hạn vote thành `expired`; 90 ngày sau hạn vote kèo bị xoá cùng lựa chọn, người tham
  gia, vote và nhật ký. Máy chủ quét mỗi giờ (bắt đầu từ `server.ts`), và kiểm lại khi đọc một kèo.

## Token và cookie

- Link chia sẻ `PUBLIC_URL/k/<token>`, token khách: 32 byte ngẫu nhiên, base64url (43 ký tự). Máy chủ chỉ lưu SHA-256.
  Link chỉ được trả một lần khi tạo kèo và khi đổi link (máy chủ không giữ được link gốc).
- Khách: cookie `lockin_g_<plan id không gạch>` (production `__Host-lockin_g_…`), `HttpOnly`, `SameSite=Lax`, `Path=/`,
  `Secure` ở production, sống tới lúc kèo bị xoá. Mỗi kèo một cookie, đặt theo id kèo nên đổi link không làm mất khách.
  Cookie được cấp ở lần mở trang kèo đầu tiên (hoặc khi tham gia nếu chưa có). Máy khác là người khác.
- Người tạo (đã đăng nhập) được nhận ra theo tài khoản trên trang kèo, không cần cookie khách.

## Bảng API

Người tạo = có phiên đăng nhập (cookie `lockin_session`). Khách = ai có link; cookie khách nếu có.

| Method | Đường dẫn | Ai | Body | Trả về | Mã lỗi |
|---|---|---|---|---|---|
| POST | `/api/plans` | người tạo | `title` (1–80), `activity` (`coffee`·`dinner`·`movie`·`karaoke`·`day_trip`·`other`), `area?` (≤80), `budgetPerPerson?` (VND, 0–100 000 000), `voteDeadline` (ISO, sau bây giờ, ≤60 ngày), `options` (1–20, mỗi loại ≤10: `{kind:"time", startsAt, label?}` hoặc `{kind:"place", label}`), `creatorDisplayName?` (≤40, có thì người tạo tham gia luôn) | 201 `{ plan: PlanView, share: { token, url } }` | 401 `sign-in-required`, 400 `invalid-body`, 400 `invalid-deadline`, 429 `rate-limited` |
| GET | `/api/plans` | người tạo | — | `{ plans: [{ id, title, activity, status, voteDeadline, createdAt, participantCount }] }` (mới nhất trước, ≤200) | 401 |
| GET | `/api/plans/:id` | người tạo | — | `{ plan: PlanView }` | 401, 403 `not-creator`, 404 `not-found` |
| PATCH | `/api/plans/:id` | người tạo | như tạo kèo, mọi trường tuỳ chọn; `options` là cả danh sách mới (có `id` = sửa/giữ, không `id` = thêm, thiếu = xoá) | `{ plan: PlanView }` | 401, 403, 404, 400 `invalid-body`·`invalid-deadline`·`invalid-option`, 409 `plan-not-open`·`plan-expired` |
| POST | `/api/plans/:id/lock` | người tạo | `{ timeOptionId?, placeOptionId? }` | `{ plan: PlanView }` | 401, 403, 404, 400 `lock-choice-required`·`invalid-option`, 409 `plan-not-open`·`plan-expired` |
| POST | `/api/plans/:id/cancel` | người tạo | — | `{ plan: PlanView }` | 401, 403, 404, 409 `plan-closed`·`plan-expired` |
| POST | `/api/plans/:id/done` | người tạo | — | `{ plan: PlanView }` | 401, 403, 404, 409 `plan-not-locked`·`plan-expired` |
| POST | `/api/plans/:id/rotate-link` | người tạo | — | `{ share: { token, url } }`; link cũ 404 ngay | 401, 403, 404, 409 `plan-expired` |
| GET | `/api/k/:token` | ai có link | — | `{ plan: PlanView }`; lần mở đầu cấp cookie khách | 404 `not-found` |
| POST | `/api/k/:token/join` | khách hoặc người tạo | `{ displayName }` (1–40); gọi lại = đổi tên, giữ nguyên người | `{ plan: PlanView }` | 404, 400, 409 `plan-closed`·`plan-expired`·`guest-conflict`, 429 |
| POST | `/api/k/:token/votes` | người đã tham gia | `{ optionIds: uuid[] }` (cả bộ; `[]` = rút hết) | `{ plan: PlanView }` | 404, 400 `invalid-option`, 409 `not-joined`·`plan-not-open`·`deadline-passed`·`plan-expired`, 429 |
| POST | `/api/k/:token/rsvp` | người đã tham gia | `{ rsvp: "going" \| "maybe" \| "no" }` | `{ plan: PlanView }` | 404, 400, 409 `not-joined`·`plan-closed`·`plan-expired`, 429 |

Token sai, sai dạng, đã đổi, hay kèo đã xoá đều trả cùng một `404 {"error":"not-found"}`. `:id` không phải uuid cũng 404.

`PlanView` ([`plan-view.ts`](../apps/server/src/plans/plan-view.ts)):

```ts
{
  id?: string;                 // chỉ người tạo thấy
  title; activity; area; budgetPerPerson; voteDeadline; readOnlyAt; status;
  creatorName: string | null;  // tên người tạo nhập trong kèo; null khi người tạo chưa tham gia
  lockedOptionIds: string[];
  options: [{ id, kind, label, startsAt, votes }];          // giờ trước, rồi chỗ, theo thứ tự người tạo
  participants: [{ id, displayName, rsvp, isCreator, optionIds }];  // theo thứ tự tham gia, không có giờ tham gia
  viewer: { isCreator, participantId };
  can: { join, vote, rsvp, edit, lock, cancel, done, rotateLink };  // việc người xem làm được lúc này
}
```

Không bao giờ có trong trả lời cho khách: tài khoản người tạo (sub, tên, email, ảnh), hash token, giờ tham gia, id kèo.

## Giới hạn tần suất

Tạo kèo 20/giờ/tài khoản; tham gia (cả đổi tên) 30/giờ/IP; vote và báo đi/không 120/giờ/IP. Quá giới hạn: 429
`rate-limited`. Bộ đếm trong bộ nhớ của một tiến trình.

## Phễu và `pnpm stats`

`plan_events` là nhật ký thay đổi và nguồn số liệu. Chỉ có id người tham gia, không bao giờ có tên.

| Sự kiện | Khi nào |
|---|---|
| `plan_created` | tạo kèo; `source_plan_id` = kèo khác mà trình duyệt này đã tham gia làm khách (cookie khách khớp một người tham gia của đúng kèo đó) |
| `link_opened` | trình duyệt mở trang kèo lần đầu (chưa có cookie khách của kèo); người tạo mở không tính. Trình duyệt chặn cookie bị đếm mỗi lần mở: đây là cách đơn giản và trung thực nhất mà không lưu thêm gì về người mở |
| `joined` | một người tham gia (một lần mỗi người; đổi tên không tính) |
| `voted` | lần vote đầu của một người |
| `rsvp`, `locked`, `done`, `cancelled`, `expired`, `plan_edited`, `option_added`, `option_edited`, `option_removed`, `link_rotated` | đúng như tên |

`pnpm stats` (gốc repo) chạy [`stats-cli.ts`](../apps/server/src/stats/stats-cli.ts) trên `DATABASE_URL`, chỉ đọc.
`--exclude-owner` bỏ kèo của các tài khoản trong `STATS_EXCLUDE_SUBS` (danh sách sub, cách bằng dấu phẩy). Số đếm:
"tham gia", "vote" chỉ tính khách (không tính người tạo); "kèo có từ 2 người vote" tính cả người tạo; "quay lại" = tạo
kèo thứ hai trong 30 ngày sau kèo đầu. Kèo đã bị xoá (90 ngày sau hạn) không còn trong số liệu.
