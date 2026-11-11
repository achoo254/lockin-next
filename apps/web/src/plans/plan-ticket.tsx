/** The locked-in plan as a ticket (mockup screen 06), with "send the result" and "save story image". */
import { type ReactNode, useEffect, useState } from 'react';
import type { PlanView } from '../api/plans-api';
import { APP_HOST, BRAND_MARK_SRC, brand } from '../brand';
import { type Locale, type Translate, useI18n } from '../i18n/i18n';
import { Icon } from '../ui/icon';
import { goingNames, lockedOptions, mapHref, optionText, pendingMembers } from './plan-format';
import { PersonChip } from './plan-parts';
import { PlanScene } from './scene/plan-scene';
import { sceneContent } from './scene/scene-config';
import { hasScene } from './scene/scene-model';
import { shareOrCopy, useFlag } from './share-actions';
import { SCENE_H, SCENE_RENDER_SCALE, SCENE_W, type StoryInput, renderStoryPng, shareOrDownloadStory } from './story-image';
import { storyTemplate } from './story-templates';
import { formatDong } from './vn-time';

/** The generated square icon the story image draws (emitted at the site root by the brand plugin). */
const STORY_LOGO_SRC = '/icon-512.png';

const stampKey = (plan: PlanView): string => `lockin_stamp_${plan.lockedOptionIds.join('_') || plan.title}`;

/**
 * Whether the stamp lands with its animation: once per locked plan in this browser (the creator locking it, or
 * anyone opening it locked for the first time). Reduced motion turns the animation off in CSS.
 */
function useStampOnce(plan: PlanView): boolean {
  const key = stampKey(plan);
  const [animate] = useState(() => {
    try {
      return window.localStorage.getItem(key) === null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // Storage refused (private mode): the stamp may animate again next time, nothing else.
    }
  }, [key]);
  return animate;
}

/** The picture of who sits where for the story image; null when the plan has no scene or this device cannot draw it. */
async function sceneForStory(plan: PlanView, t: Translate, locale: Locale): Promise<HTMLCanvasElement | null> {
  if (!hasScene(plan)) return null;
  try {
    const { renderSceneSnapshot } = await import('./scene/scene-snapshot');
    const { roster, signage, labels, moreLabel } = sceneContent(plan, t, locale);
    return await renderSceneSnapshot({ roster, signage, labels, moreLabel }, Math.round(SCENE_W * SCENE_RENDER_SCALE), Math.round(SCENE_H * SCENE_RENDER_SCALE));
  } catch (error) {
    console.error('story scene failed', error instanceof Error ? error.message : typeof error);
    return null;
  }
}

export function PlanTicket({ plan, link }: { plan: PlanView; link: string }): ReactNode {
  const { t, locale } = useI18n();
  const animate = useStampOnce(plan);
  const { time, place } = lockedOptions(plan);
  const names = goingNames(plan);
  const waiting = pendingMembers(plan);
  const [copied, flagCopied] = useFlag();
  const [story, setStory] = useState<'idle' | 'busy' | 'saved' | 'failed'>('idle');
  const when = time ? optionText(time, locale) : null;
  const placeText = place ? optionText(place, locale) : null;
  const sticker = storyTemplate(plan.activity).sticker;
  const showScene = hasScene(plan);

  async function sendResult(): Promise<void> {
    const text = t('ticket.shareText', { title: plan.title, when: [when, placeText].filter(Boolean).join(' · ') });
    const outcome = await shareOrCopy({ title: plan.title, text, url: link }, `${text} 👉 ${link}`);
    if (outcome === 'copied') flagCopied();
  }

  async function saveStory(): Promise<void> {
    setStory('busy');
    const input: StoryInput = {
      appName: brand.appName,
      template: storyTemplate(plan.activity),
      footer: t('story.footer', { host: APP_HOST }),
      stamp: t(plan.status === 'done' ? 'ticket.stampDone' : 'ticket.stamp'),
      title: plan.title,
      when,
      place: placeText,
      area: plan.area,
      names,
      waiting,
      waitingLabel: t('story.waiting'),
      nobodyLabel: t('ticket.nobody'),
    };
    try {
      const png = await renderStoryPng(input, STORY_LOGO_SRC, await sceneForStory(plan, t, locale));
      const outcome = await shareOrDownloadStory(png, `${t('story.fileName')}.png`, plan.title);
      setStory(outcome === 'cancelled' ? 'idle' : 'saved');
    } catch (error) {
      console.error('story image failed', error instanceof Error ? error.message : typeof error);
      setStory('failed');
    }
  }

  return (
    <>
      <article className="ticket" aria-label={t('ticket.label')} data-id="ticket">
        <div className="ticket-head">
          <img
            className={sticker ? 'ticket-sticker' : undefined}
            src={sticker ?? BRAND_MARK_SRC}
            width={sticker ? 64 : 52}
            height={sticker ? 64 : 52}
            alt=""
            aria-hidden="true"
          />
          <div>
            <p>{t('ticket.eyebrow')}</p>
            <h2>{plan.title}</h2>
          </div>
        </div>
        <span className={animate ? 'stamp is-new' : 'stamp'} data-id="stamp">
          {t(plan.status === 'done' ? 'ticket.stampDone' : 'ticket.stamp')}
        </span>
        {showScene && <PlanScene plan={plan} enter={animate} />}
        <div className="ticket-body">
          {time && when && (
            <div className="fact">
              <span className="k" aria-hidden="true">
                <Icon name="clock" />
              </span>
              <div>
                <b>{when}</b>
                <span>{t('plan.votes', { n: time.votes })}</span>
              </div>
            </div>
          )}
          {place && placeText && (
            <div className="fact">
              <span className="k" aria-hidden="true">
                <Icon name="pin" />
              </span>
              <div>
                <b>{placeText}</b>
                <span>
                  {plan.area ? `${plan.area} · ` : ''}
                  <a href={mapHref(place, plan.area)} target="_blank" rel="noopener noreferrer" data-id="ticket-map">
                    {t('plan.mapLink')}
                  </a>
                </span>
              </div>
            </div>
          )}
          {plan.budgetPerPerson !== null && (
            <div className="fact">
              <span className="k" aria-hidden="true">
                <Icon name="wallet" />
              </span>
              <div>
                <b>{t('ticket.budget', { amount: formatDong(plan.budgetPerPerson, locale) })}</b>
                <span>{t('ticket.budgetNote')}</span>
              </div>
            </div>
          )}
        </div>
        <div className="tear" />
        <div className="ticket-body">
          <p className="eyebrow">{t('ticket.going', { n: names.length })}</p>
          {names.length > 0 ? (
            <ul className="people" data-id="ticket-going">
              {names.map((name, index) => (
                <PersonChip key={`${name}-${index}`} name={name} />
              ))}
            </ul>
          ) : (
            <p className="muted">{t('ticket.nobody')}</p>
          )}
          {waiting.length > 0 && (
            <>
              <p className="eyebrow">{t('ticket.waiting', { n: waiting.length })}</p>
              <ul className="people" data-id="ticket-waiting">
                {waiting.map((name) => (
                  <PersonChip key={name} name={name} faded />
                ))}
              </ul>
            </>
          )}
        </div>
      </article>
      <div className="stack">
        <button type="button" className={copied ? 'btn btn-ghost is-done' : 'btn btn-ghost'} aria-live="polite" onClick={() => void sendResult()} data-id="ticket-share">
          <Icon name={copied ? 'check' : 'share'} />
          {copied ? t('ticket.copied') : t('ticket.share')}
        </button>
        <button type="button" className="btn btn-ghost" aria-busy={story === 'busy'} disabled={story === 'busy'} onClick={() => void saveStory()} data-id="ticket-story">
          <Icon name={story === 'saved' ? 'check' : 'download'} />
          {story === 'busy' ? t('ticket.storyBusy') : story === 'saved' ? t('ticket.storySaved') : t('ticket.story')}
        </button>
        {story === 'failed' && (
          <p className="alert alert-error" role="alert">
            {t('ticket.storyFailed')}
          </p>
        )}
      </div>
    </>
  );
}
