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

- Link chia sẻ `PUBLIC_URL/k/<token>`, token khách: 32 byte ngẫu nhiên, base64url (43 ký tự). Máy chủ tìm theo SHA-256.
  Token chia sẻ còn được lưu mã hoá AES-256-GCM (`plans.share_token_enc`, khoá `SHARE_TOKEN_KEY`, dữ liệu xác thực kèm
  là id kèo; [`share-token-box.ts`](../apps/server/src/plans/share-token-box.ts)) để người tạo xem lại link: mọi trả lời
  cho người tạo có `plan.share` (`{ token, url }`, `null` khi kèo có link từ trước khi lưu mã hoá hoặc khoá đã đổi; khi
  đó "đổi link" tạo link mới). Khách không bao giờ nhận `share`. Đổi link mã hoá lại token mới.
- Khách: cookie `lockin_g_<plan id không gạch>` (production `__Host-lockin_g_…`), `HttpOnly`, `SameSite=Lax`, `Path=/`,
  `Secure` ở production, sống tới lúc kèo thành chỉ-đọc (hạn vote + 30 ngày; gia hạn khi người tạo dời hạn). Mỗi kèo một
  cookie, đặt theo id kèo nên đổi link không làm mất khách. Cookie chỉ được cấp khi tham gia: chỉ mở xem kèo thì không
  có cookie nào, nên trình duyệt không tích một cookie cho mỗi kèo từng xem. Máy khác là người khác.
- Người tạo (đã đăng nhập) được nhận ra theo tài khoản trên trang kèo, không cần cookie khách.

## Bảng API

Người tạo = có phiên đăng nhập (cookie `lockin_session`). Khách = ai có link; cookie khách nếu có.

| Method | Đường dẫn | Ai | Body | Trả về | Mã lỗi |
|---|---|---|---|---|---|
| POST | `/api/plans` | người tạo | `title` (1–80), `activity` (`coffee`·`dinner`·`movie`·`karaoke`·`day_trip`·`birthday`·`lunch`·`party`·`team_building`·`meeting`·`other`), `area?` (≤80), `budgetPerPerson?` (VND, 0–100 000 000), `groupSize?` (2–50, số người dự kiến để nhắc ai chưa vote), `voteDeadline` (ISO, sau bây giờ, ≤60 ngày), `options` (1–20, mỗi loại ≤10: `{kind:"time", startsAt, label?}` hoặc `{kind:"place", label, mapUrl?}`; `mapUrl` chỉ nhận link https của Google Maps: `maps.app.goo.gl/…`, `goo.gl/maps/…`, `google.com/maps/place/…`, `google.com/maps/search/…`, [`map-link.ts`](../apps/server/src/plans/map-link.ts); máy chủ không mở link), `creatorDisplayName?` (≤40, có thì người tạo tham gia luôn; web điền sẵn tên tài khoản) | 201 `{ plan: PlanView, share: { token, url } }` | 401 `sign-in-required`, 400 `invalid-body`, 400 `invalid-deadline`, 429 `rate-limited` |
| GET | `/api/plans` | người tạo | — | `{ plans: [{ id, title, activity, status, voteDeadline, createdAt, participantCount, shareUrl }] }` (mới nhất trước, ≤200; `shareUrl` null như `plan.share`) | 401 |
| GET | `/api/plans/:id` | người tạo | — | `{ plan: PlanView }` | 401, 403 `not-creator`, 404 `not-found` |
| PATCH | `/api/plans/:id` | người tạo | như tạo kèo, mọi trường tuỳ chọn; `options` là cả danh sách mới (có `id` = sửa/giữ, không `id` = thêm, thiếu = xoá) | `{ plan: PlanView }` | 401, 403, 404, 400 `invalid-body`·`invalid-deadline`·`invalid-option`, 409 `plan-not-open`·`plan-expired` |
| POST | `/api/plans/:id/lock` | người tạo | `{ timeOptionId?, placeOptionId? }` | `{ plan: PlanView }` | 401, 403, 404, 400 `lock-choice-required`·`invalid-option`, 409 `plan-not-open`·`plan-expired` |
| POST | `/api/plans/:id/cancel` | người tạo | — | `{ plan: PlanView }` | 401, 403, 404, 409 `plan-closed`·`plan-expired` |
| POST | `/api/plans/:id/done` | người tạo | — | `{ plan: PlanView }` | 401, 403, 404, 409 `plan-not-locked`·`plan-expired` |
| POST | `/api/plans/:id/rotate-link` | người tạo | — | `{ share: { token, url } }`; link cũ 404 ngay | 401, 403, 404, 409 `plan-expired` |
| GET | `/k/:token` | ai có link | — | HTML: `index.html` của web với `og:title` (tên kèo), `og:description`, `og:url`, `og:image` (ảnh chung của app), `twitter:card`, `robots noindex`; `?lang=en` cho mô tả tiếng Anh. Token sai/đổi/sai dạng: cùng trang với thẻ chung của app, cùng mã 200 (không lộ link nào tồn tại). Không có tên người tham gia, không cấp cookie khách | 503 khi không đọc được trang |
| GET | `/api/k/:token` | ai có link | — | `{ plan: PlanView }`; không cấp cookie (khách đã tham gia thì cookie được gia hạn) | 404 `not-found` |
| POST | `/api/k/:token/join` | khách hoặc người tạo | `{ displayName }` (1–40); gọi lại = đổi tên, giữ nguyên người | `{ plan: PlanView }` | 404, 400, 409 `plan-closed`·`plan-expired`·`guest-conflict`, 429 |
| POST | `/api/k/:token/votes` | người đã tham gia | `{ optionIds: uuid[] }` (cả bộ; `[]` = rút hết) | `{ plan: PlanView }` | 404, 400 `invalid-option`, 409 `not-joined`·`plan-not-open`·`deadline-passed`·`plan-expired`, 429 |
| POST | `/api/k/:token/rsvp` | người đã tham gia | `{ rsvp: "going" \| "maybe" \| "no" }` | `{ plan: PlanView }` | 404, 400, 409 `not-joined`·`plan-closed`·`plan-expired`, 429 |

Token sai, sai dạng, đã đổi, hay kèo đã xoá đều trả cùng một `404 {"error":"not-found"}`. `:id` không phải uuid cũng 404.

`PlanView` ([`plan-view.ts`](../apps/server/src/plans/plan-view.ts)):

```ts
{
  id?: string;                 // chỉ người tạo thấy
  share?: { token; url } | null;  // chỉ người tạo thấy
  title; activity; area; budgetPerPerson; groupSize; voteDeadline; readOnlyAt; status;
  creatorName: string | null;  // tên người tạo nhập trong kèo; null khi người tạo chưa tham gia
  lockedOptionIds: string[];
  options: [{ id, kind, label, mapUrl, startsAt, votes }];  // giờ trước, rồi chỗ, theo thứ tự người tạo
  participants: [{ id, displayName, rsvp, isCreator, optionIds }];  // theo thứ tự tham gia, không có giờ tham gia
  viewer: { isCreator, participantId };
  can: { join, vote, rsvp, edit, lock, cancel, done, rotateLink };  // việc người xem làm được lúc này
}
```

Không bao giờ có trong trả lời cho khách: tài khoản người tạo (sub, tên, email, ảnh), hash hay bản mã hoá của token, link chia sẻ (`share`), giờ tham gia, id kèo.

## Giới hạn tần suất

Tạo kèo 20/giờ/tài khoản. Khách đếm theo (IP, link kèo), để cả văn phòng hay mạng di động chung một IP vẫn cùng vào
một kèo được: tham gia (cả đổi tên) 60/giờ, vote 300/giờ, báo đi/không 300/giờ (ba bộ đếm riêng); cộng mọi kèo thì
tối đa 3000/giờ/IP (tính cả lần bị từ chối). Quá giới hạn: 429 `rate-limited`. Mở kèo (`GET /api/k/:token`) không bao
giờ bị từ chối; quá 600 lần/giờ/IP thì vẫn trả kèo nhưng không ghi `link_opened`. Bộ đếm trong bộ nhớ của một tiến
trình.

## Phễu và `pnpm stats`

`plan_events` là nhật ký thay đổi và nguồn số liệu. Chỉ có id người tham gia, không bao giờ có tên.

| Sự kiện | Khi nào |
|---|---|
| `plan_created` | tạo kèo; `source_plan_id` = kèo khác mà trình duyệt này đã tham gia làm khách (cookie khách khớp một người tham gia của đúng kèo đó) |
| `link_opened` | người chưa tham gia mở kèo, một lần mỗi ngày (UTC) cho mỗi (kèo, IP, User-Agent); người tạo và người đã tham gia mở không tính, quá giới hạn mở theo IP cũng không. Để không đếm trùng, máy chủ giữ trong bộ nhớ (không ghi đĩa, không vào database) bản băm của IP + User-Agent với muối ngẫu nhiên đổi mỗi ngày, bỏ hết khi sang ngày hay khởi động lại ([`daily-open-dedupe.ts`](../apps/server/src/plans/daily-open-dedupe.ts)). Nhiều người sau một IP dùng cùng trình duyệt tính là một |
| `joined` | một người tham gia (một lần mỗi người; đổi tên không tính) |
| `voted` | lần vote đầu của một người |
| `rsvp`, `locked`, `done`, `cancelled`, `expired`, `plan_edited`, `option_added`, `option_edited`, `option_removed`, `link_rotated` | đúng như tên |

`pnpm stats` (gốc repo) chạy [`stats-cli.ts`](../apps/server/src/stats/stats-cli.ts) trên `DATABASE_URL`, chỉ đọc.
`--exclude-owner` bỏ kèo của các tài khoản trong `STATS_EXCLUDE_SUBS` (danh sách sub, cách bằng dấu phẩy). Số đếm:
"tham gia", "vote" chỉ tính khách (không tính người tạo); "kèo có từ 2 người vote" tính cả người tạo; "quay lại" = tạo
kèo thứ hai trong 30 ngày sau kèo đầu. Kèo đã bị xoá (90 ngày sau hạn) không còn trong số liệu.
