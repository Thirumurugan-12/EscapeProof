# Hosted deployment

The public website is https://escapeproof.vercel.app.

## Architecture

Vercel serves the React application. The complete workshop needs the Railway Docker service, which contains Fastify, SQLite, Kane CLI 0.10.4 and Chrome. A single replica owns the persistent `/app/data` volume, including database, evidence and refreshed Kane credentials. Do not add replicas to this SQLite deployment.

`Dockerfile.railway` starts as root only to prepare volume permissions, then runs the application and Chrome as the `node` user. The Chrome wrapper disables its sandbox inside the hosting container and avoids the small shared-memory filesystem. Operator access remains protected by `OPERATOR_TOKEN`, signed secure cookies and origin checks.

Set private service variables `MODEL_API_KEY`, `OPERATOR_TOKEN`, `MUSE_MODEL`, `APP_ORIGIN`, `COOKIE_SECURE=true`, `DATA_DIR=/app/data`, and the Kane executable settings. `KANE_PROFILE_SEED_BASE64` optionally contains the four allowlisted Kane profile files as a base64 JSON map; it seeds missing files once and never overwrites refreshed credentials. Never commit these values.

Vercel proxies `/api/:path*` to `https://escapeproof-workshop-production.up.railway.app/api/:path*`. `APP_ORIGIN=https://escapeproof.vercel.app` ensures browser mutations and Kane preview URLs use the public frontend. The operator workshop is available at `https://escapeproof.vercel.app/#workshop`.

## Free-credit limit

Only existing free Railway credits are authorized. No paid subscription or billing upgrade is authorized. Hosting availability depends on remaining credits and trial restrictions. Keep local copies of important rooms and evidence because trial volumes have limited retention.

## Standalone fallback

The standalone demo handler can serve the handcrafted room independently of Railway. It uses an encrypted 24-hour progress cookie and the private `DEMO_SESSION_SECRET` variable. It explicitly describes workshop generation and verification as local. The fallback does not claim live Kane verification.
