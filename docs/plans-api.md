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
- Người tạo: kèo đã có tài khoản sở hữu (`plans.creator_sub`) thì **chỉ tài khoản đó** là người tạo; cookie người tạo
  hay link quản lý không mở quyền gì nữa (đăng xuất: 401 `sign-in-required`; tài khoản khác: 403 `not-creator`). Kèo
  tạo lúc chưa đăng nhập và chưa lưu vào tài khoản: ai giữ token người tạo (cookie hoặc link quản lý) là người tạo. Người
  tạo làm được mọi việc của người tạo (sửa, chốt, huỷ, đánh dấu đã đi, đổi link chia sẻ, đổi link quản lý, xem hai
  link), trên trang kèo lẫn `/api/plans/:id…`. Không cần cookie khách.
- Token người tạo: 32 byte ngẫu nhiên, **chỉ cấp cho kèo tạo lúc chưa đăng nhập** (tạo khi đã đăng nhập thì tài khoản là
  chìa khoá: không token, không cookie người tạo, `manage: null`). Máy chủ lưu SHA-256 (`plans.creator_token_hash`, duy
  nhất) và bản mã hoá `plans.manage_token_enc` (cùng khoá `SHARE_TOKEN_KEY`, dữ liệu xác thực kèm là `manage:<id kèo>`
  nên không mở được như token chia sẻ và ngược lại). Kèo không có token thì cả hai cột null.
- Cookie người tạo `lockin_c_<plan id không gạch>` (production `__Host-lockin_c_…`), `HttpOnly`, `SameSite=Lax`,
  `Path=/` (cần cho `/api`), `Secure` ở production, sống tới lúc kèo bị xoá (hạn vote + 90 ngày; gia hạn mỗi lần người
  giữ cookie gọi API của kèo, nên dời hạn vote cũng dời cookie). Chỉ cấp khi tạo kèo lúc **chưa đăng nhập** (đăng nhập
  thì tài khoản là chìa khoá) và khi mở link quản lý của kèo chưa có tài khoản. Lưu kèo vào tài khoản xoá cookie này trên
  trình duyệt lưu; đăng xuất xoá cookie người tạo của mọi kèo đã có tài khoản.
- Số cookie: trước khi đặt cookie khách hay cookie người tạo cho một kèo mới mà trình duyệt đã giữ ≥ 40 cookie cùng
  loại, máy chủ cho hết hạn số cookie thừa để còn 40 kể cả cookie mới: trước hết cookie của kèo đã xoá hoặc đã chỉ-đọc,
  rồi cookie cũ nhất ([`plan-cookie-room.ts`](../apps/server/src/plans/plan-cookie-room.ts)). Khi đọc hết cookie một
  loại (danh sách "Kèo của tôi", nguồn của kèo mới) máy chủ đọc 50 cookie mới nhất. nginx nhận header tới 16 KB
  (`large_client_header_buffers 4 16k`).
- Người tạo cũng đã tham gia kèo của mình như khách trên cùng trình duyệt (tham gia trước, rồi mở link quản lý hoặc
  đăng nhập tài khoản sở hữu): lần gọi `/api/k/…` tiếp theo gộp hàng khách vào hàng người tạo (vote của khách thêm vào
  hàng người tạo; đi/không lấy của khách khi người tạo chưa chọn), xoá hàng khách và cookie khách, ghi `guest_merged`.
  Người tạo chưa có hàng thì hàng khách thành hàng người tạo.
- Link quản lý `PUBLIC_URL/m/<id kèo>.<token người tạo>`: trả về khi tạo kèo lúc chưa đăng nhập (`manage`), và trong
  `plan.manage` cho người tạo. `GET /m/…` của kèo chưa có tài khoản đặt cookie người tạo cho trình duyệt đó rồi `303`
  sang `/k/<token chia sẻ>` (hoặc `/plans/<id>` khi không xem lại được link chia sẻ), không còn token trong địa chỉ.
  Kèo đã có tài khoản: không cookie, `303` sang `/plans/<id>` (trang đó đòi đăng nhập đúng tài khoản; link chia sẻ không
  lộ). `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Token sai, link sai dạng hay kèo đã xoá đều `303` về
  `/?manage=invalid`, không cookie. nginx giữ `/m/` ngoài access log như `/k/`.
- Đổi link quản lý (`rotate-manage`): token người tạo mới; link cũ và cookie người tạo của mọi trình duyệt khác hết
  dùng ngay. Trình duyệt đang vào bằng cookie nhận cookie mới. Được làm ở mọi trạng thái cho tới khi kèo bị xoá.
- Lưu vào tài khoản (`claim`): người đã đăng nhập và giữ token người tạo (cookie, hoặc `token` trong body lấy từ link
  quản lý) gắn kèo vào tài khoản mình. Từ đó tài khoản là chìa khoá duy nhất: token người tạo được thay (link quản lý
  cũ hết dùng, tài khoản xem được link mới) và cookie người tạo của kèo trên trình duyệt lưu bị xoá. Gọi lại khi kèo đã
  là của mình: không đổi gì. Kèo đã thuộc tài khoản khác không bao giờ bị lấy (409 `plan-owned` khi token đúng, 403
  `not-creator` khi token sai).

## Bảng API

Người tạo = tài khoản sở hữu kèo (cookie `lockin_session`), hoặc cookie người tạo của kèo khi kèo chưa có tài khoản.
Khách = ai có link; cookie khách nếu có. Với `/api/plans/:id…`: chưa đăng nhập và không phải người tạo → 401
`sign-in-required`; đã đăng nhập nhưng không phải người tạo → 403 `not-creator`. Đường dẫn không giải mã được (mã `%`
hỏng) → 400 `bad-request`, không ghi log.

| Method | Đường dẫn | Ai | Body | Trả về | Mã lỗi |
|---|---|---|---|---|---|
| POST | `/api/plans` | ai cũng được (đăng nhập hay không) | `title` (1–80), `activity` (`coffee`·`dinner`·`movie`·`karaoke`·`day_trip`·`birthday`·`lunch`·`party`·`team_building`·`meeting`·`other`), `area?` (≤80), `budgetPerPerson?` (VND, 0–100 000 000), `groupSize?` (2–50, số người dự kiến để nhắc ai chưa vote), `voteDeadline` (ISO, sau bây giờ, ≤60 ngày), `options` (1–20, mỗi loại ≤10: `{kind:"time", startsAt, label?}` hoặc `{kind:"place", label, mapUrl?}`; `mapUrl` chỉ nhận link https của Google Maps: `maps.app.goo.gl/…`, `goo.gl/maps/…`, `google.com/maps/place/…`, `google.com/maps/search/…`, [`map-link.ts`](../apps/server/src/plans/map-link.ts); máy chủ không mở link), `creatorDisplayName` (≤40, có thì người tạo tham gia luôn, đi; **bắt buộc khi chưa đăng nhập**; web điền sẵn tên tài khoản) | 201 `{ plan: PlanView, share: { token, url }, manage: { url } \| null }`; chưa đăng nhập: `manage` và `Set-Cookie` cookie người tạo; đã đăng nhập: `manage: null` | 400 `invalid-body`, 400 `name-required`, 400 `invalid-deadline`, 429 `rate-limited` |
| GET | `/api/plans` | ai cũng được | — | `{ plans: [{ id, title, activity, status, voteDeadline, createdAt, participantCount, shareUrl, savedToAccount }] }`: kèo của tài khoản đang đăng nhập cộng kèo có cookie người tạo trên trình duyệt này (đọc tối đa 50 cookie, mỗi cookie kiểm với token của kèo), mới nhất trước, ≤200; `participantCount` chỉ đếm khách đã tham gia, không tính người tạo; `shareUrl` null như `plan.share`; không có gì thì `[]` | — |
| GET | `/api/plans/:id` | người tạo | — | `{ plan: PlanView }` | 401, 403 `not-creator`, 404 `not-found` |
| PATCH | `/api/plans/:id` | người tạo | như tạo kèo, mọi trường tuỳ chọn; `options` là cả danh sách mới (có `id` = sửa/giữ, không `id` = thêm, thiếu = xoá) | `{ plan: PlanView }` | 401, 403, 404, 400 `invalid-body`·`invalid-deadline`·`invalid-option`, 409 `plan-not-open`·`plan-expired` |
| POST | `/api/plans/:id/lock` | người tạo | `{ timeOptionId?, placeOptionId? }` | `{ plan: PlanView }` | 401, 403, 404, 400 `lock-choice-required`·`invalid-option`, 409 `plan-not-open`·`plan-expired` |
| POST | `/api/plans/:id/cancel` | người tạo | — | `{ plan: PlanView }` | 401, 403, 404, 409 `plan-closed`·`plan-expired` |
| POST | `/api/plans/:id/done` | người tạo | — | `{ plan: PlanView }` | 401, 403, 404, 409 `plan-not-locked`·`plan-expired` |
| POST | `/api/plans/:id/rotate-link` | người tạo | — | `{ share: { token, url } }`; link cũ 404 ngay | 401, 403, 404, 409 `plan-expired` |
| POST | `/api/plans/:id/rotate-manage` | người tạo | — | `{ manage: { url } }`; link quản lý cũ hết dùng ngay; ghi `manage_link_rotated` | 401, 403, 404, 409 `no-manage-link` (kèo tạo khi đã đăng nhập) |
| POST | `/api/plans/:id/claim` | đã đăng nhập + token người tạo | `{ token? }` (token người tạo từ link quản lý; không có thì dùng cookie) | `{ plan: PlanView }` (`savedToAccount: true`, `manage` là link mới); xoá cookie người tạo của kèo; ghi `plan_claimed` một lần | 401 `sign-in-required`, 400 `invalid-body`, 403 `not-creator`, 404, 409 `plan-owned` |
| GET | `/m/:id.:token` | ai có link quản lý | — | `303` như mục Token và cookie | — |
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
  manage?: { url } | null;     // chỉ người tạo thấy; null cho kèo không có token người tạo (tạo khi đã đăng nhập, hoặc trước tính năng)
  savedToAccount?: boolean;    // chỉ người tạo thấy; false: kèo chỉ nằm ở trình duyệt có cookie người tạo
  title; activity; area; budgetPerPerson; groupSize; voteDeadline; readOnlyAt; status;
  creatorName: string | null;  // tên người tạo nhập trong kèo; null khi người tạo chưa tham gia
  lockedOptionIds: string[];
  options: [{ id, kind, label, mapUrl, startsAt, votes }];  // giờ trước, rồi chỗ, theo thứ tự người tạo
  participants: [{ id, displayName, rsvp, isCreator, optionIds }];  // theo thứ tự tham gia, không có giờ tham gia
  viewer: { isCreator, participantId };
  can: { join, vote, rsvp, edit, lock, cancel, done, rotateLink };  // việc người xem làm được lúc này
}
```

Không bao giờ có trong trả lời cho khách: tài khoản người tạo (sub, tên, email, ảnh), hash hay bản mã hoá của token, link chia sẻ (`share`), link quản lý (`manage`), giờ tham gia, id kèo.

## Giới hạn tần suất

Tạo kèo: đã đăng nhập 20/giờ/tài khoản; chưa đăng nhập 10/giờ và 30/ngày mỗi IP (hai bộ đếm riêng, không tính kèo
tạo khi đã đăng nhập). Khách đếm theo (IP, link kèo), để cả văn phòng hay mạng di động chung một IP vẫn cùng vào
một kèo được: tham gia (cả đổi tên) 60/giờ, vote 300/giờ, báo đi/không 300/giờ (ba bộ đếm riêng); cộng mọi kèo thì
tối đa 3000/giờ/IP (tính cả lần bị từ chối). Quá giới hạn: 429 `rate-limited`. Mở kèo (`GET /api/k/:token`) không bao
giờ bị từ chối; quá 600 lần/giờ/IP thì vẫn trả kèo nhưng không ghi `link_opened`. Bộ đếm trong bộ nhớ của một tiến
trình.

## Phễu và `pnpm stats`

`plan_events` là nhật ký thay đổi và nguồn số liệu. Chỉ có id người tham gia, không bao giờ có tên.

| Sự kiện | Khi nào |
|---|---|
| `plan_created` | tạo kèo; `payload.creatorKind` = `account` (đã đăng nhập) hoặc `guest` (chưa đăng nhập; sự kiện cũ không có payload là `account`); `source_plan_id` = kèo khác mà trình duyệt này đã tham gia làm khách (cookie khách khớp một người tham gia của đúng kèo đó) |
| `plan_claimed` | kèo tạo khi chưa đăng nhập được lưu vào tài khoản (một lần mỗi kèo) |
| `manage_link_rotated` | người tạo đổi link quản lý (lưu vào tài khoản cũng thay token nhưng chỉ ghi `plan_claimed`) |
| `guest_merged` | hàng khách của chính người tạo được gộp vào hàng người tạo (mục Token và cookie); `participant_id` là hàng người tạo |
| `link_opened` | người chưa tham gia mở kèo, một lần mỗi ngày (UTC) cho mỗi (kèo, IP, User-Agent); người tạo và người đã tham gia mở không tính, quá giới hạn mở theo IP cũng không. Để không đếm trùng, máy chủ giữ trong bộ nhớ (không ghi đĩa, không vào database) bản băm của IP + User-Agent với muối ngẫu nhiên đổi mỗi ngày, bỏ hết khi sang ngày hay khởi động lại ([`daily-open-dedupe.ts`](../apps/server/src/plans/daily-open-dedupe.ts)). Nhiều người sau một IP dùng cùng trình duyệt tính là một |
| `joined` | một người tham gia (một lần mỗi người; đổi tên không tính) |
| `voted` | lần vote đầu của một người |
| `rsvp`, `locked`, `done`, `cancelled`, `expired`, `plan_edited`, `option_added`, `option_edited`, `option_removed`, `link_rotated` | đúng như tên |

`pnpm stats` (gốc repo) chạy [`stats-cli.ts`](../apps/server/src/stats/stats-cli.ts) trên `DATABASE_URL`, chỉ đọc.
`--exclude-owner` bỏ kèo của các tài khoản trong `STATS_EXCLUDE_SUBS` (danh sách sub, cách bằng dấu phẩy). Số đếm:
"tham gia", "vote" chỉ tính khách (không tính người tạo); "kèo có từ 2 người vote" tính cả người tạo; "quay lại" = tạo
kèo thứ hai trong 30 ngày sau kèo đầu. "Người tạo" là tài khoản; kèo tạo khi chưa đăng nhập tính khi đã lưu vào tài
khoản. Phần "Signed in or not" đếm kèo tạo khi đã/chưa đăng nhập và số kèo chưa đăng nhập được lưu vào tài khoản.
`--exclude-owner` luôn giữ kèo chưa thuộc tài khoản nào. Kèo đã bị xoá (90 ngày sau hạn) không còn trong số liệu.
