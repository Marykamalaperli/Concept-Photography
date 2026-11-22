import { togglePassword, workspaceSessionKey } from './access-view.js';

const api = document.querySelector('meta[name="concept-api"]')?.content;
const form = document.querySelector('[data-form="login"]');
let ready = false;
let loading;

function loadWorkspace() {
  loading ??= import('./app.js').then(() => { ready = true; }).catch((error) => {
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

if (!api || sessionStorage.getItem(workspaceSessionKey(api))) {
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
    if (ready) return;
    event.preventDefault();
    event.stopPropagation();
    const button = event.submitter;
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await loadWorkspace();
    } catch {
      showLoadError();
      return;
    } finally {
      if (button) button.disabled = false;
    }
    form.requestSubmit(button ?? undefined);
  });
}
