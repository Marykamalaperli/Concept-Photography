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
