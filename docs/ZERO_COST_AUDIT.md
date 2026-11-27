# Dependency and cost audit

| Component | Role | License or terms | External account or mandatory subscription |
|---|---|---|---|
| Node.js and built-in SQLite | HTTP, crypto and local database | Node.js MIT with bundled dependencies under their licenses, SQLite public domain | None |
| Native browser Geolocation and service worker APIs | GPS checks, installable mobile access, offline screen | Browser platform APIs | None |
| Inter and Manrope via Fontsource | Self-served type | SIL Open Font License 1.1 | None |
| Lucide Static | Self-served icons | ISC | None |
| esbuild | Builds the optional public launcher | MIT | None |
| Lighthouse via npm | Development and CI performance audit | Apache-2.0 | None for local use |
| GitHub repository, Actions and optional Pages | Version control, review, test runners and static launcher | GitHub plan and usage limits | GitHub account for write operations, usage should stay within its plan |
| Web Push library and browser endpoint | Optional delivery to registered devices when the workspace is closed | web-push MPL-2.0, delivery subject to browser service terms | No paid provider account, browser delivery infrastructure required for this option |
| Google Maps links | Optional convenience for pin import and map navigation | Google Maps public links and terms | No required key, direct coordinates work independently |
| Caddy or operator-selected TLS configuration | Optional HTTPS reverse proxy | Caddy Apache-2.0 | No mandatory subscription, public DNS and network access depend on the office |

The npm lockfile pins the library versions. Review its transitive dependencies and license notices before distributing an updated build. Optional Web Push generates local VAPID keys. On a server that only uses in-app reminders, leave `ENABLE_WEB_PUSH=0` or omit the optional package.

Target additional software subscription cost is ₹0 with suitable existing hardware and connectivity. Hardware, power, ISP fees, public DNS and domain renewal, storage, and maintenance depend on the office.

The lockfile’s optional push dependencies are `agent-base`, `asn1.js`, `bn.js`, `debug`, `http_ece`, `https-proxy-agent`, `jwa`, `jws`, `minimist`, `ms`, `safe-buffer`, and `safer-buffer` under MIT. `inherits` and `minimalistic-assert` use ISC, `buffer-equal-constant-time` uses BSD‑3‑Clause, and `ecdsa-sig-formatter` uses Apache‑2.0. The platform esbuild packages use MIT. These packages require no separate accounts, subscriptions or API credits. Preserve their notices when redistributing.
