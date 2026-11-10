import { describe, expect, it } from 'vitest';
import { translator } from '../i18n/i18n';
import { P1, T1, T2, makePlan, person } from '../test/plan-fixture';
import { reminderText } from './plan-format';

const link = 'https://lockin.hoandat.com/k/abc';
const now = new Date();
const t = translator('vi');

describe('reminder text', () => {
  it('says how many are still missing and what leads, and drops the leader on a tie', () => {
    const voters = [person('a', 'Linh', [T1, P1], 'going'), person('b', 'Vy', [T1], 'going')];
    const text = reminderText(makePlan({ groupSize: 5, participants: voters, options: makePlan().options.map((o) => (o.id === P1 ? { ...o, votes: 5 } : o)) }), link, now, t, 'vi');
    expect(text).toContain('còn 3 người chưa vote');
    expect(text).toContain('còn 5 giờ nữa là chốt');
    expect(text).toContain('Đang dẫn đầu: Thứ Bảy 07/11, 9:00 · Quán cà phê A.');
    expect(text.endsWith(`👉 ${link}`)).toBe(true);
    expect(reminderText(makePlan({ groupSize: 5, participants: voters }), link, now, t, 'vi')).not.toContain('Quán cà phê');
  });

  it('follows a withdrawn vote, the time left and a group that is all in', () => {
    const base = { groupSize: 2 };
    const both = [person('a', 'Linh', [T1], 'going'), person('b', 'Vy', [T2], 'going')];
    expect(reminderText(makePlan({ ...base, participants: both }), link, now, t, 'vi')).toContain('Cả nhóm vote đủ rồi');
    const withdrawn = [person('a', 'Linh', [T1], 'going'), person('b', 'Vy', [], 'going')];
    expect(reminderText(makePlan({ ...base, participants: withdrawn }), link, now, t, 'vi')).toContain('còn 1 người chưa vote');
    const soon = makePlan({ ...base, participants: withdrawn, voteDeadline: new Date(now.getTime() + 20 * 60 * 1000).toISOString() });
    expect(reminderText(soon, link, now, t, 'vi')).toContain('còn 20 phút nữa là chốt');
  });

  it('counts votes when the group size is unknown', () => {
    expect(reminderText(makePlan({ participants: [person('a', 'Linh', [T1], 'going')] }), link, now, t, 'vi')).toContain('mới có 1 người vote');
  });
});
