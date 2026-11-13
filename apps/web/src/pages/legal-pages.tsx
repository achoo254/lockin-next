/** /privacy, /terms and /credits in Vietnamese and English. `{app}` is the brand name. */
import type { ReactNode } from 'react';
import { APP_HOST, IDP_ACCOUNT_DELETE_URL } from '../brand';
import { type Locale, format, useI18n } from '../i18n/i18n';
// The server enforces these numbers; the privacy page prints the very same constants.
import { DELETE_AFTER_DAYS, PLAN_COOKIE_ROOM, READ_ONLY_AFTER_DAYS } from '../../../server/src/plans/retention';

interface Section {
  heading: string;
  paragraphs?: string[];
  items?: Array<string | { text: string; href?: string; note: string }>;
}

interface LegalDoc {
  title: string;
  intro: string;
  sections: Section[];
}

export type LegalPageKind = 'privacy' | 'terms' | 'credits';


const APP_ICON_LICENCE = 'AI-generated (OpenAI gpt-image-2) for the hoandat ecosystem; owned by hoandat, all rights reserved (not CC0).';
const STICKER_LICENCE = 'AI-generated (OpenAI gpt-image) for the hoandat ecosystem; owned by hoandat, all rights reserved (not CC0).';

const DOCS: Record<LegalPageKind, Record<Locale, LegalDoc>> = {
  privacy: {
    vi: {
      title: 'Quyền riêng tư',
      intro: `{app} (${APP_HOST}) là app nhỏ giúp nhóm bạn chốt kèo đi chơi, do một nhà phát triển độc lập vận hành. Trang này nói rõ app giữ gì và không giữ gì.`,
      sections: [
        {
          heading: 'Người tạo kèo',
          items: [
            `Tạo kèo không cần tài khoản: chỉ cần tên của bạn trong kèo. Tạo lúc chưa đăng nhập thì trình duyệt của bạn nhận một cookie riêng của kèo (__Host-lockin_c_…) chứa mã ngẫu nhiên để nhận ra người tạo; máy chủ chỉ lưu bản băm của mã, và cookie hết hạn khi kèo bị xoá (${DELETE_AFTER_DAYS} ngày sau hạn vote). Cùng mã đó nằm trong link quản lý riêng của kèo; ai mở link quản lý thì trình duyệt đó cũng quản lý được kèo, nên đừng gửi nó vào nhóm. Máy chủ giữ thêm một bản mã hoá (AES-256-GCM) của mã để người tạo xem lại link quản lý. Người tạo đổi được link quản lý bất cứ lúc nào: link cũ và cookie người tạo trên các máy khác hết dùng ngay.`,
            'Tạo kèo khi đã đăng nhập thì tài khoản là chìa khoá: kèo không có mã người tạo, cookie người tạo hay link quản lý.',
            'Bạn có thể lưu kèo tạo lúc chưa đăng nhập vào tài khoản hoandat.com bất cứ lúc nào: từ đó chỉ tài khoản đó quản lý được kèo, trên máy nào cũng được. Lúc lưu, mã người tạo được thay bằng mã mới: link quản lý cũ hết dùng, cookie người tạo của kèo trên trình duyệt vừa lưu bị xoá, cookie trên máy khác không còn quyền gì (và bị xoá khi đăng xuất trên máy đó). Tài khoản vẫn xem được link quản lý mới, nhưng link này chỉ mở trang quản lý của kèo và đòi đăng nhập đúng tài khoản. Một kèo đã gắn vào tài khoản không bị tài khoản khác lấy đi.',
            'Nếu bạn đã tham gia kèo của chính mình như khách trên một trình duyệt, rồi mở link quản lý hoặc đăng nhập tài khoản sở hữu kèo ở đó, phần tham gia khách (lượt vote, đi hay không) được gộp vào phần của người tạo và cookie khách của kèo bị xoá, để bạn chỉ là một người trong kèo.',
            'Người tạo kèo đăng nhập (nếu muốn) qua tài khoản hoandat.com (auth.hoandat.com) với quyền "openid profile email": app nhận mã định danh tài khoản, tên hiển thị (không có thì tên người dùng), email và địa chỉ ảnh đại diện.',
            'Tên, email và địa chỉ ảnh được lưu cùng tài khoản và cập nhật mỗi lần đăng nhập, chỉ để hiện trong menu tài khoản. App không gửi email cho bạn, không dùng chúng vào việc khác và không chia sẻ chúng với ai.',
            'Ảnh đại diện do trình duyệt tải thẳng từ nơi giữ ảnh (Google hoặc GitHub), app không lưu bản sao. Đăng nhập bằng Apple thì không có ảnh.',
            'Một cookie phiên (__Host-lockin_session) giữ bạn đăng nhập tối đa 30 ngày; máy chủ chỉ lưu bản băm của nó. Đăng xuất là huỷ phiên trên máy chủ.',
          ],
        },
        {
          heading: 'Kèo và lượt vote',
          items: [
            'Với mỗi kèo, máy chủ lưu những gì người tạo nhập: tên kèo, loại hoạt động, khu vực, ngân sách mỗi người, số người trong nhóm và danh sách tên bạn bè người tạo muốn nhắc vote (nếu có), hạn vote, các lựa chọn giờ và chỗ, và giờ, chỗ đã chốt. Danh sách tên bạn bè đã lưu sẵn nằm trong bộ nhớ trình duyệt của người tạo và chỉ lên máy chủ khi được dùng cho một kèo.',
            `Bạn bè tham gia không cần tài khoản: máy chủ lưu tên hiển thị họ tự nhập, các lựa chọn họ vote và việc họ có tham gia hay không. Khi tham gia một kèo, trình duyệt nhận một cookie (__Host-lockin_g_…) chứa mã ngẫu nhiên của riêng kèo đó, để nhận ra cùng trình duyệt khi mở lại; máy chủ chỉ lưu bản băm của mã đó, và cookie hết hạn khi kèo thành chỉ-đọc (${READ_ONLY_AFTER_DAYS} ngày sau hạn vote). Chỉ mở xem kèo thì không có cookie nào. Mỗi trình duyệt giữ tối đa ${PLAN_COOKIE_ROOM} cookie khách và ${PLAN_COOKIE_ROOM} cookie người tạo: khi cần chỗ cho cookie mới, app xoá trước cookie của kèo đã xoá hoặc đã chỉ-đọc, rồi cookie cũ nhất. Để đếm số người mở link mà không đếm trùng, máy chủ giữ trong bộ nhớ, không ghi lại, một mã băm của địa chỉ IP và trình duyệt, xoá khi sang ngày mới.`,
            'Ai có link kèo đều thấy tên kèo, các lựa chọn, tên hiển thị của người tham gia, lượt vote của họ và danh sách tên người tạo đã nhập. Link chỉ chứa mã ngẫu nhiên; máy chủ tìm kèo bằng bản băm của mã, và giữ thêm một bản mã hoá (AES-256-GCM) để người tạo xem lại và gửi lại link. Người tạo đổi được link khi link bị gửi ra ngoài nhóm. Thẻ xem trước của link chỉ có tên kèo, không có tên người tham gia.',
            'App ghi nhật ký thay đổi của kèo (tạo, vote, chốt, huỷ, lưu vào tài khoản, đổi link) để đếm số kèo được tạo và được chốt, và bao nhiêu kèo được tạo khi chưa đăng nhập; nhật ký không chứa tên người vote hay người tạo.',
          ],
        },
        {
          heading: 'Giữ trong bao lâu',
          paragraphs: [
            `Kèo chỉ còn xem, không vote hay sửa được nữa, sau ${READ_ONLY_AFTER_DAYS} ngày kể từ hạn vote. ${DELETE_AFTER_DAYS} ngày kể từ hạn vote, kèo bị xoá hẳn cùng tên người tham gia, lượt vote và nhật ký của kèo.`,
          ],
        },
        {
          heading: 'Số liệu truy cập',
          paragraphs: [
            'Trang có thể dùng Cloudflare Web Analytics để đếm lượt xem trang. Công cụ này không đặt cookie và không theo dõi bạn sang trang khác. Đường dẫn của link kèo có thể hiện trong số liệu lượt xem gộp mà chỉ người vận hành trang xem được. App không dùng quảng cáo và không bán dữ liệu.',
          ],
        },
        {
          heading: 'Xoá tài khoản',
          items: [
            {
              text: 'Trang tài khoản hoandat.com',
              href: IDP_ACCOUNT_DELETE_URL,
              note: 'là nơi duy nhất xoá được tài khoản. Khi bạn xoá ở đó, app xoá ngay tài khoản, phiên đăng nhập và các kèo đã lưu vào tài khoản mà chưa ai khác tham gia. Kèo đã có người tham gia được chuyển cho người tham gia sớm nhất để nhóm vẫn dùng tiếp; tên, lượt vote và trả lời đi hay không của bạn trong kèo đó bị xoá, link quản lý cũ hết dùng.',
            },
          ],
        },
        {
          heading: 'Liên hệ',
          paragraphs: ['Muốn hỏi, hay xoá tên và vote của bạn trong một kèo bạn tham gia như khách (không gắn với tài khoản): nhắn Trang Facebook Hoandat Apps.'],
        },
      ],
    },
    en: {
      title: 'Privacy',
      intro: `{app} (${APP_HOST}) is a small app that helps a group of friends lock in a plan, run by an independent developer. This page says what the app keeps and what it does not.`,
      sections: [
        {
          heading: 'People who make plans',
          items: [
            `Making a plan needs no account: only your name in the plan. Made while signed out, your browser gets a cookie of its own for that plan (__Host-lockin_c_…) holding a random code that marks you as its maker; the server stores only the hash of the code, and the cookie expires when the plan is deleted (${DELETE_AFTER_DAYS} days after the vote deadline). The same code is in the plan's private manage link; whoever opens the manage link can manage the plan from that browser too, so keep it out of the group chat. The server also keeps an encrypted copy (AES-256-GCM) of the code so the maker can see the manage link again. The maker can change the manage link at any time: the old link and the maker cookies on other devices stop working at once.`,
            'A plan made while signed in has the account as its key: it has no maker code, maker cookie or manage link.',
            'You can save a plan made while signed out to a hoandat.com account at any time: from then on only that account can manage it, from any device. On saving, the maker code is replaced with a new one: the old manage link stops working, the plan’s maker cookie in the browser that saved it is removed, and maker cookies on other devices grant nothing any more (and are removed when signing out there). The account can still see the new manage link, but it only opens the plan’s management page and asks to sign in with the right account. A plan saved to an account is never taken over by another account.',
            'If you joined your own plan as a guest in a browser and then open the manage link or sign in with the owning account there, your guest part (votes, going or not) is merged into the maker’s and the plan’s guest cookie is removed, so you are one person in the plan.',
            'The person making a plan can sign in with a hoandat.com account (auth.hoandat.com) with the "openid profile email" scopes: the app receives an account identifier, the display name (or username if there is none), the email and the address of the profile picture.',
            'The name, email and picture address are stored with the account and updated at each sign-in, only to show in the account menu. The app sends you no email, uses them for nothing else and shares them with no one.',
            'Your browser loads the profile picture straight from where it is kept (Google or GitHub); the app keeps no copy. Signing in with Apple gives no picture.',
            'A session cookie (__Host-lockin_session) keeps you signed in for up to 30 days; the server stores only its hash. Signing out ends the session on the server.',
          ],
        },
        {
          heading: 'Plans and votes',
          items: [
            'For each plan the server keeps what its maker typed: the title, kind of activity, area, budget per person, group size and the list of friends’ names the maker wants to remind (if any), vote deadline, the time and place options, and the time and place locked in. The saved list of friends’ names lives in the maker’s browser storage and only reaches the server when it is used for a plan.',
            `Friends join without an account: the server keeps the display name they type, the options they vote for and whether they are joining. On joining a plan the browser gets a cookie (__Host-lockin_g_…) with a random code for that plan, to recognise the same browser when it comes back; the server stores only its hash, and the cookie expires when the plan turns read-only (${READ_ONLY_AFTER_DAYS} days after the vote deadline). Only viewing a plan sets no cookie. A browser keeps at most ${PLAN_COOKIE_ROOM} guest cookies and ${PLAN_COOKIE_ROOM} maker cookies: when a new one needs room, the app first removes cookies of plans that are deleted or read-only, then the oldest. To count how many people open a link without counting anyone twice, the server keeps a hash of the IP address and browser in memory only, never written down, and drops it at the end of the day.`,
            "Anyone with a plan's link sees its title, options, the display names of the people who joined, their votes and the list of names the maker typed. The link holds only a random code; the server finds the plan by the code's hash and also keeps an encrypted copy (AES-256-GCM) so the maker can see and resend the link. The maker can change the link if it travels outside the group. The link preview shows only the plan's title, never the names of the people in it.",
            'The app logs the changes of a plan (made, voted, locked, cancelled, saved to an account, links changed) to count how many plans are made and locked in, and how many are made without signing in; the log holds no names of voters or makers.',
          ],
        },
        {
          heading: 'How long it is kept',
          paragraphs: [
            `A plan turns read-only (no more voting or editing) ${READ_ONLY_AFTER_DAYS} days after its vote deadline. ${DELETE_AFTER_DAYS} days after the deadline it is deleted for good, with the names of the people who joined, their votes and the plan's log.`,
          ],
        },
        {
          heading: 'Usage numbers',
          paragraphs: [
            'The site may use Cloudflare Web Analytics to count page views. It sets no cookie and does not follow you to other sites. The path of a plan link may appear in the aggregated page-view figures that only the site operator can see. The app shows no ads and sells no data.',
          ],
        },
        {
          heading: 'Deleting your account',
          items: [
            {
              text: 'The hoandat.com account page',
              href: IDP_ACCOUNT_DELETE_URL,
              note: 'is the only place an account is deleted. When you delete it there, the app at once deletes the account, its sessions and the plans saved to it that nobody else joined. A plan others joined passes to the person who joined first, so the group can keep using it; your name, votes and answer in it are deleted, and its old manage link stops working.',
            },
          ],
        },
        {
          heading: 'Contact',
          paragraphs: ['Questions, or deleting your name and votes in a plan you joined as a guest (not tied to an account): message the Hoandat Apps Facebook Page.'],
        },
      ],
    },
  },
  terms: {
    vi: {
      title: 'Điều khoản sử dụng',
      intro: `{app} (${APP_HOST}) là app miễn phí, không quảng cáo. Dùng app nghĩa là bạn đồng ý với các điều dưới đây.`,
      sections: [
        {
          heading: 'Kèo và link',
          items: [
            'Ai có link kèo đều xem và vote được, nên chỉ gửi link cho nhóm của bạn và đừng ghi thông tin nhạy cảm (số điện thoại, địa chỉ nhà, số tài khoản) vào kèo.',
            'Người tạo kèo chịu trách nhiệm về nội dung kèo; người tham gia chịu trách nhiệm về tên mình nhập. Không dùng app để quấy rối, lừa đảo hay đăng nội dung trái pháp luật.',
            'App chỉ giúp nhóm chọn giờ và chỗ; app không đặt chỗ, không thu tiền và không chịu trách nhiệm về buổi đi chơi.',
          ],
        },
        {
          heading: 'Trách nhiệm',
          paragraphs: [
            'App được cung cấp "như hiện có". Nhà phát triển có thể thay đổi, tạm dừng hay ngừng app bất cứ lúc nào, và có thể xoá kèo vi phạm điều khoản. Điều khoản có thể được cập nhật; bản mới nhất luôn ở trang này.',
          ],
        },
        { heading: 'Liên hệ', paragraphs: ['Nhắn Trang Facebook Hoandat Apps.'] },
      ],
    },
    en: {
      title: 'Terms of Service',
      intro: `{app} (${APP_HOST}) is a free app with no ads. By using it you agree to the terms below.`,
      sections: [
        {
          heading: 'Plans and links',
          items: [
            'Anyone with a plan link can see it and vote, so share it only with your group and keep sensitive details (phone numbers, home addresses, bank accounts) out of plans.',
            'The person making a plan is responsible for its content; each person who joins is responsible for the name they type. Do not use the app to harass, scam or post anything unlawful.',
            'The app only helps the group pick a time and place; it books nothing, takes no money and is not responsible for the outing itself.',
          ],
        },
        {
          heading: 'Liability',
          paragraphs: [
            'The app is provided "as is". The developer may change, pause or stop it at any time, and may delete plans that break these terms. These terms may be updated; the latest version is always on this page.',
          ],
        },
        { heading: 'Contact', paragraphs: ['Message the Hoandat Apps Facebook Page.'] },
      ],
    },
  },
  credits: {
    vi: {
      title: 'Ghi công',
      intro: '{app} đứng trên vai những dự án mã nguồn mở dưới đây.',
      sections: [
        {
          heading: 'Giao diện và máy chủ',
          items: [
            { text: 'React', href: 'https://react.dev', note: 'giấy phép MIT.' },
            { text: 'Bricolage Grotesque', href: 'https://github.com/ateliertriay/bricolage', note: 'giấy phép SIL Open Font License 1.1.' },
            { text: 'Be Vietnam Pro', href: 'https://github.com/bettergui/BeVietnamPro', note: 'giấy phép SIL Open Font License 1.1.' },
            { text: 'Express', href: 'https://expressjs.com', note: 'giấy phép MIT.' },
            { text: 'Drizzle ORM', href: 'https://orm.drizzle.team', note: 'giấy phép Apache-2.0.' },
          ],
        },
        { heading: 'Biểu tượng app', paragraphs: [APP_ICON_LICENCE] },
        { heading: 'Sticker trên ảnh story', paragraphs: [STICKER_LICENCE] },
        { heading: 'Mã nguồn', paragraphs: ['Mã nguồn của app theo giấy phép MIT.'] },
      ],
    },
    en: {
      title: 'Credits',
      intro: '{app} stands on the open-source projects below.',
      sections: [
        {
          heading: 'Interface and server',
          items: [
            { text: 'React', href: 'https://react.dev', note: 'MIT licence.' },
            { text: 'Bricolage Grotesque', href: 'https://github.com/ateliertriay/bricolage', note: 'SIL Open Font License 1.1.' },
            { text: 'Be Vietnam Pro', href: 'https://github.com/bettergui/BeVietnamPro', note: 'SIL Open Font License 1.1.' },
            { text: 'Express', href: 'https://expressjs.com', note: 'MIT licence.' },
            { text: 'Drizzle ORM', href: 'https://orm.drizzle.team', note: 'Apache-2.0 licence.' },
          ],
        },
        { heading: 'App icon', paragraphs: [APP_ICON_LICENCE] },
        { heading: 'Story image stickers', paragraphs: [STICKER_LICENCE] },
        { heading: 'Source code', paragraphs: ["The app's source code is under the MIT licence."] },
      ],
    },
  },
};

export function legalTitle(kind: LegalPageKind, locale: Locale): string {
  return DOCS[kind][locale].title;
}

export function LegalPage({ kind }: { kind: LegalPageKind }): ReactNode {
  const { locale } = useI18n();
  const doc = DOCS[kind][locale];
  return (
    <article className="card doc" data-id={`legal-${kind}`}>
      <h1 className="doc-title">{doc.title}</h1>
      <p>{format(doc.intro)}</p>
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="doc-heading">{section.heading}</h2>
          {section.paragraphs?.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {section.items && (
            <ul>
              {section.items.map((item) =>
                typeof item === 'string' ? (
                  <li key={item}>{item}</li>
                ) : (
                  <li key={item.text}>
                    {item.href ? (
                      <a href={item.href} rel="noopener noreferrer">
                        {item.text}
                      </a>
                    ) : (
                      <b>{item.text}</b>
                    )}{' '}
                    {item.note}
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
