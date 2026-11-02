import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import './ui/tokens.css';
// The shared account menu's rules (shell-* classes only); app.css dresses them in the app's look.
import '@achoo254/app-shell/app-shell.css';
import './ui/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type PageModules, loadPageModules } from './app';
import { I18nProvider } from './i18n/i18n';

/** Renders the app. Pages outside the main bundle (legal) load first; if that fails, the page says so. */
async function start(root: HTMLElement): Promise<void> {
  let modules: PageModules | undefined;
  try {
    modules = await loadPageModules(window.location.pathname);
  } catch (error) {
    console.error('page code failed to load', error instanceof Error ? error.message : typeof error);
  }
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <App pathname={window.location.pathname} modules={modules} />
      </I18nProvider>
    </StrictMode>,
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');
void start(root);
