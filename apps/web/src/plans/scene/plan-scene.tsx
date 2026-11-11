/** The cover of a locked plan's ticket: the 3D beer hall with who sits at the tables and who stands outside, and why. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanView } from '../../api/plans-api';
import { useI18n } from '../../i18n/i18n';
import type { SceneController } from './scene-controller';
import { sceneContent } from './scene-config';
import { type SceneEntry, type SceneGroup, groupCounts } from './scene-model';
import type { Signage } from './scene-textures';
import type { WorldLabels } from './scene-world';

const ZOOM_STEP = 0.15;

type Shown = [SceneEntry[], Signage, WorldLabels, string];

/** The 3D code (three.js) loads only when a locked plan with the scene is opened. */
const loadController = (): Promise<typeof import('./scene-controller')> => import('./scene-controller');

export function PlanScene({ plan, enter }: { plan: PlanView; enter: boolean }): ReactNode {
  const { t, locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<SceneGroup | null>(null);

  const content = sceneContent(plan, t, locale);
  // The scene is rebuilt only when what it shows changes, not on every refetch of the same plan.
  const key = JSON.stringify([content.roster, content.signage, content.labels, locale]);
  const stable = useMemo(() => JSON.parse(key) as Shown, [key]);
  const [roster, signage, labels] = stable;
  const latestRoster = useRef(roster);

  useEffect(() => {
    latestRoster.current = roster;
    controllerRef.current?.setRoster(roster);
  }, [roster]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    let created: SceneController | null = null;
    const initial = latestRoster.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    void loadController()
      .then(({ SceneController: Controller }) =>
        Controller.create(canvas, { roster: initial, signage, labels, moreLabel: (n) => t('scene.more', { n }), enter, reducedMotion, interactive: true }),
      )
      .then((controller) => {
        if (cancelled) {
          controller.dispose();
          return;
        }
        created = controller;
        controllerRef.current = controller;
        controller.onSelect = setSelectedId;
        // A refetch while the scene was loading: show the newer roster (this ends the walk-in, which is for the first one).
        if (latestRoster.current !== initial) controller.setRoster(latestRoster.current);
        setState('ready');
      })
      .catch((error: unknown) => {
        console.error('scene failed', error instanceof Error ? error.message : typeof error);
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
      created?.dispose();
      controllerRef.current = null;
    };
    // `enter` is read once: the walk-in is for the first opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signage, labels, locale]);

  // A failed load (a dropped connection while the 3D code came down) leaves the ticket as it is, with a way to try again.
  if (state === 'failed') {
    return (
      <section className="scene scene-failed" aria-label={t('scene.label')} data-id="scene-failed">
        <p>{t('scene.failed')}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.location.reload()} data-id="scene-retry">
          {t('scene.retry')}
        </button>
      </section>
    );
  }

  const selected = roster.find((entry) => entry.id === selectedId) ?? null;
  const counts = groupCounts(roster);

  function toggle(group: SceneGroup): void {
    const next = highlight === group ? null : group;
    setHighlight(next);
    controllerRef.current?.setHighlight(next);
  }

  return (
    <section className="scene" aria-label={t('scene.label')} data-id="scene">
      <div className="scene-stage">
        {/* The canvas is operated by pointer, wheel and the arrow and plus/minus keys; the list below says the same in text. */}
        <canvas ref={canvasRef} className="scene-canvas" tabIndex={0} aria-label={t('scene.canvasLabel')} data-id="scene-canvas" />
        {state === 'loading' && <p className="scene-loading">{t('scene.loading')}</p>}
        {state === 'ready' && (
          <>
            <p className="scene-hint">{t('scene.hint')}</p>
            <div className="scene-zoom">
              <button type="button" aria-label={t('scene.zoomIn')} onClick={() => controllerRef.current?.zoomBy(-ZOOM_STEP)} data-id="scene-zoom-in">
                +
              </button>
              <button type="button" aria-label={t('scene.zoomOut')} onClick={() => controllerRef.current?.zoomBy(ZOOM_STEP)} data-id="scene-zoom-out">
                −
              </button>
            </div>
          </>
        )}
      </div>
      {state === 'ready' && (
        <>
          <div className="scene-info" aria-live="polite" data-id="scene-info">
            {selected ? (
              <>
                <span className="scene-dot" data-group={selected.group} aria-hidden="true" />
                <div>
                  <b>
                    {selected.name} · {t(`scene.group.${selected.group}`)}
                  </b>
                  <span>{selected.say ?? t(`scene.groupDesc.${selected.group}`)}</span>
                </div>
              </>
            ) : (
              <p>{t('scene.pickHint')}</p>
            )}
          </div>
          <div className="scene-groups" data-id="scene-groups">
            <p className="eyebrow">{t('scene.groupsHeading', { n: roster.length })}</p>
            <ul role="group" aria-label={t('scene.groups')}>
              {counts.map(({ group, count }) => (
                <li key={group}>
                  <button type="button" className="group-chip" aria-pressed={highlight === group} onClick={() => toggle(group)} data-id={`scene-group-${group}`}>
                    <span className="scene-dot" data-group={group} aria-hidden="true" />
                    {t(`scene.group.${group}`)} <em>{count}</em>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <ul className="sr-only">
            {roster.map((entry) => (
              <li key={entry.id}>
                {entry.name}: {t(`scene.group.${entry.group}`)}
                {entry.say ? `. ${entry.say}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
