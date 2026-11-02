/** /privacy, /terms and /credits in Vietnamese and English. `{app}` is the brand name. */
import type { ReactNode } from 'react';
import { APP_HOST } from '../brand';
import { type Locale, format, useI18n } from '../i18n/i18n';
// The server enforces these numbers; the privacy page prints the very same constants.
import { DELETE_AFTER_DAYS, READ_ONLY_AFTER_DAYS } from '../../../server/src/plans/retention';

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
            'Người tạo kèo đăng nhập qua tài khoản hoandat.com (auth.hoandat.com) với quyền "openid profile email": app nhận mã định danh tài khoản, tên hiển thị (không có thì tên người dùng), email và địa chỉ ảnh đại diện.',
            'Tên, email và địa chỉ ảnh được lưu cùng tài khoản và cập nhật mỗi lần đăng nhập, chỉ để hiện trong menu tài khoản. App không gửi email cho bạn, không dùng chúng vào việc khác và không chia sẻ chúng với ai.',
            'Ảnh đại diện do trình duyệt tải thẳng từ nơi giữ ảnh (Google hoặc GitHub), app không lưu bản sao. Đăng nhập bằng Apple thì không có ảnh.',
            'Một cookie phiên (__Host-lockin_session) giữ bạn đăng nhập tối đa 30 ngày; máy chủ chỉ lưu bản băm của nó. Đăng xuất là huỷ phiên trên máy chủ.',
          ],
        },
        {
          heading: 'Kèo và lượt vote',
          items: [
            'Với mỗi kèo, máy chủ lưu những gì người tạo nhập: tên kèo, loại hoạt động, khu vực, ngân sách mỗi người và số người trong nhóm (nếu có), hạn vote, các lựa chọn giờ và chỗ, và giờ, chỗ đã chốt.',
            'Bạn bè tham gia không cần tài khoản: máy chủ lưu tên hiển thị họ tự nhập, các lựa chọn họ vote và việc họ có tham gia hay không. Ngay lần đầu mở link, trình duyệt nhận một cookie chứa mã ngẫu nhiên của riêng kèo đó (kể cả khi chưa nhập tên), để nhận ra cùng trình duyệt khi mở lại và để đếm số lần link được mở; máy chủ chỉ lưu bản băm của mã đó.',
            'Ai có link kèo đều thấy tên kèo, các lựa chọn, tên hiển thị của người tham gia và lượt vote của họ. Link chỉ chứa mã ngẫu nhiên; máy chủ tìm kèo bằng bản băm của mã, và giữ thêm một bản mã hoá (AES-256-GCM) để người tạo xem lại và gửi lại link. Người tạo đổi được link khi link bị gửi ra ngoài nhóm. Thẻ xem trước của link chỉ có tên kèo, không có tên người tham gia.',
            'App ghi nhật ký thay đổi của kèo (tạo, vote, chốt, huỷ) để đếm số kèo được tạo và được chốt; nhật ký không chứa tên người vote.',
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
            'Trang có thể dùng Cloudflare Web Analytics để đếm lượt xem trang. Công cụ này không đặt cookie và không theo dõi bạn sang trang khác. App không dùng quảng cáo và không bán dữ liệu.',
          ],
        },
        {
          heading: 'Liên hệ',
          paragraphs: ['Muốn hỏi hay yêu cầu xoá dữ liệu (tài khoản, kèo bạn tạo, tên và vote của bạn trong một kèo): nhắn Trang Facebook Hoandat Apps.'],
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
            'The person making a plan signs in with a hoandat.com account (auth.hoandat.com) with the "openid profile email" scopes: the app receives an account identifier, the display name (or username if there is none), the email and the address of the profile picture.',
            'The name, email and picture address are stored with the account and updated at each sign-in, only to show in the account menu. The app sends you no email, uses them for nothing else and shares them with no one.',
            'Your browser loads the profile picture straight from where it is kept (Google or GitHub); the app keeps no copy. Signing in with Apple gives no picture.',
            'A session cookie (__Host-lockin_session) keeps you signed in for up to 30 days; the server stores only its hash. Signing out ends the session on the server.',
          ],
        },
        {
          heading: 'Plans and votes',
          items: [
            'For each plan the server keeps what its maker typed: the title, kind of activity, area, budget per person and group size (if any), vote deadline, the time and place options, and the time and place locked in.',
            'Friends join without an account: the server keeps the display name they type, the options they vote for and whether they are joining. The first time a browser opens a link it gets a cookie with a random code for that plan (even before typing a name), to recognise the same browser when it comes back and to count how often the link is opened; the server stores only its hash.',
            "Anyone with a plan's link sees its title, options, the display names of the people who joined and their votes. The link holds only a random code; the server finds the plan by the code's hash and also keeps an encrypted copy (AES-256-GCM) so the maker can see and resend the link. The maker can change the link if it travels outside the group. The link preview shows only the plan's title, never the names of the people in it.",
            'The app logs the changes of a plan (made, voted, locked, cancelled) to count how many plans are made and locked in; the log holds no voter names.',
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
            'The site may use Cloudflare Web Analytics to count page views. It sets no cookie and does not follow you to other sites. The app shows no ads and sells no data.',
          ],
        },
        {
          heading: 'Contact',
          paragraphs: ['Questions or data deletion requests (your account, plans you made, your name and votes in a plan): message the Hoandat Apps Facebook Page.'],
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
