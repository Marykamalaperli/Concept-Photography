import { togglePassword, workspaceRequest } from './access-view.js';

const existingSession = Boolean(document.querySelector('meta[name="concept-session"]'));
const appUrl = new URL('./app.js', document.baseURI);
const form = document.querySelector('[data-form="login"]');
let ready = false;
let loading;
let dashboardStyles;

function loadDashboardStyles() {
  dashboardStyles ??= new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './styles.css';
    link.onload = resolve;
    link.onerror = () => {
      dashboardStyles = undefined;
      link.remove();
      reject(new Error('Workspace styles could not load.'));
    };
    document.head.append(link);
  });
  return dashboardStyles;
}

function loadWorkspace() {
  loading ??= Promise.all([loadDashboardStyles(), import(appUrl.href)]).then(([, workspace]) => {
    workspace.startWorkspace({ restore: existingSession });
    ready = true;
    return workspace;
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

function showLoadError() {
  const notice = form.querySelector('.form-error');
  notice.textContent = 'The workspace could not load. Refresh the page to try again.';
  notice.hidden = false;
}

if (existingSession) {
  loadWorkspace().catch(showLoadError);
} else {
  form.addEventListener('focusin', () => loadWorkspace().catch(() => {}), { once: true });
  form.addEventListener('click', (event) => {
    if (ready) return;
    const button = event.target.closest('[data-password-toggle]');
    if (button) {
      event.stopPropagation();
      togglePassword(button);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const button = event.submitter ?? form.querySelector('[type="submit"]');
    if (button.disabled) return;
    const notice = form.querySelector('.form-error');
    const label = button.querySelector('span');
    const originalLabel = label.textContent;
    notice.hidden = true;
    button.disabled = true;
    label.textContent = 'Signing in…';
    form.setAttribute('aria-busy', 'true');
    try {
      const credentials = Object.fromEntries(new FormData(form));
      const [loggedIn, { finishSignIn }] = await Promise.all([
        workspaceRequest('login', credentials),
        loadWorkspace().catch(() => {
          throw new Error('The workspace could not load. Refresh the page to try again.');
        }),
      ]);
      await finishSignIn(loggedIn);
    } catch (error) {
      notice.textContent = error.message;
      notice.hidden = false;
    } finally {
      button.disabled = false;
      label.textContent = originalLabel;
      form.removeAttribute('aria-busy');
    }
  });
}
