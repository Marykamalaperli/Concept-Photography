function accessIcon(name) {
  return `<i class="icon" aria-hidden="true" style="--icon:url('./icons/${name}.svg')"></i>`;
}

export function workspaceAddress(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Enter the complete HTTPS workspace address.');
  }
  return url;
}

export async function workspaceRequest(path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  let payload;
  try {
    response = await fetch(`/api/${path}`, {
      headers,
      ...(['login', 'session', 'state', 'attendance'].includes(path) ? { signal: AbortSignal.timeout(12000) } : {}),
      credentials: 'same-origin',
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    payload = await response.json();
  } catch {
    throw new Error('The studio workspace could not be reached. Try again.');
  }
  if (!response.ok) {
    const error = new Error(payload?.error || 'The workspace could not complete the request. Try again.');
    error.status = response.status;
    if (Array.isArray(payload?.conflicts)) error.conflicts = payload.conflicts;
    throw error;
  }
  return payload;
}

export function accessView({ title, description, content }) {
  return `<div class="auth-layout">
    <section class="auth-aside" aria-label="Concept Photography">
      <picture class="auth-photo">
        <source type="image/avif" srcset="./sign-in.avif">
        <img src="./sign-in.webp" width="600" height="750" alt="" fetchpriority="high">
      </picture>
      <img class="auth-brand" src="./sign-in-logo.png" width="108" height="154" alt="" fetchpriority="low">
      <div class="auth-aside-copy"><h2>Concept Photography</h2></div>
    </section>
    <section class="auth-content" aria-labelledby="access-title">
      <div class="auth-form">
        <div class="auth-mark">${accessIcon('key-round')}</div>
        <h1 id="access-title">${title}</h1>
        <p class="auth-description">${description}</p>
        ${content}
      </div>
    </section>
  </div>`;
}

export function passwordField({ id, label = 'Password', name = 'password', newPassword = false, required = true }) {
  return `<div class="auth-password full">
    <label for="${id}">${label}</label>
    <span class="auth-input with-toggle">${accessIcon('lock-keyhole')}
      <input id="${id}" name="${name}" type="password" autocomplete="${newPassword ? 'new-password' : 'current-password'}"
        maxlength="128" ${newPassword ? 'minlength="12"' : 'placeholder="Enter your password"'}
        autocapitalize="none" spellcheck="false" ${required ? 'required' : ''}>
      <button type="button" class="password-toggle" data-password-toggle aria-controls="${id}"
        aria-label="Show password" title="Show password">${accessIcon('eye')}</button>
    </span>
  </div>`;
}

export function togglePassword(button) {
  const field = document.getElementById(button.getAttribute('aria-controls'));
  if (!(field instanceof HTMLInputElement)) return;
  const visible = field.type === 'password';
  field.type = visible ? 'text' : 'password';
  const label = visible ? 'Hide password' : 'Show password';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = accessIcon(visible ? 'eye-off' : 'eye');
}

export function loginView() {
  return accessView({
    title: 'Sign in',
    description: 'Use your company email and password.',
    content: `<form class="sign-in-fields" method="dialog" data-form="login">
      <label>Email address
        <span class="auth-input">${accessIcon('mail')}<input name="email" type="email" autocomplete="username" maxlength="254" placeholder="you@company.com" required></span>
      </label>
      ${passwordField({ id: 'sign-in-password' })}
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn primary auth-submit"><span>Sign in</span>${accessIcon('arrow-right')}</button>
    </form>
    <noscript><p class="auth-help">Enable JavaScript to sign in to the workspace.</p></noscript>
    <div class="auth-connection" data-auth-connection hidden>
      <p role="status"></p>
      <button type="button" class="text-link" data-auth-retry>Retry connection</button>
    </div>
    <p class="auth-help">Need access or a password reset? <strong>Contact your studio admin.</strong></p>`,
  });
}
