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

export function accessView({ title, description, content }) {
  return `<div class="auth-layout">
    <section class="auth-aside" aria-label="Concept Photography">
      <div class="brand">
        <span class="brand-mark">${accessIcon('camera')}</span>
        <span><strong>Concept</strong><small>Photography</small></span>
      </div>
      <div class="auth-aside-copy"><h2>Studio workspace</h2></div>
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

export function loginView() {
  return accessView({
    title: 'Sign in',
    description: 'Use your company email and password.',
    content: `<form class="sign-in-fields" method="dialog" data-form="login">
      <label>Email address
        <span class="auth-input">${accessIcon('mail')}<input name="email" type="email" autocomplete="username" maxlength="254" placeholder="you@company.com" required></span>
      </label>
      <div class="auth-password">
        <label for="sign-in-password">Password</label>
        <span class="auth-input with-toggle">${accessIcon('lock-keyhole')}
          <input id="sign-in-password" name="password" type="password" autocomplete="current-password"
            maxlength="128" placeholder="Enter your password" required>
          <button type="button" class="password-toggle" data-password-toggle aria-controls="sign-in-password"
            aria-label="Show password" title="Show password">${accessIcon('eye')}</button>
        </span>
      </div>
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
