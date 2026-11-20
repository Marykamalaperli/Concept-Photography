import { workspaceAddress } from './access-view.js';

const form = document.querySelector('#open-workspace');
const input = form.elements.workspaceUrl;
const error = form.querySelector('.form-error');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const url = workspaceAddress(input.value.trim());
    location.assign(url.href);
  } catch {
    error.textContent = 'Enter the complete HTTPS workspace address provided by your studio admin.';
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
});

input.addEventListener('input', () => {
  error.hidden = true;
  input.removeAttribute('aria-invalid');
});
