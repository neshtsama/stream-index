# StreamIndex API

Accounts, watch progress, and bookmarks/watch-later for the StreamIndex frontend.
Three tables, three route files, one job each:

| Table            | Holds                                              |
|-------------------|-----------------------------------------------------|
| `users`           | email + a bcrypt hash, nothing else                 |
| `watch_progress`  | one row per movie or per episode, keyed like the frontend already keys it locally (`"550"` or `"1399-s1-e3"`) |
| `list_items`      | bookmarks and watch-later, same row shape, distinguished by `list_name` |

No film or show data lives here — just TMDB ids and the handful of fields
(title, poster, year, rating) needed to redraw a card without an extra
lookup. TMDB stays the source of truth.

I can't run this for you inside this environment — no network access and
nothing here stays running between sessions — so this is real, complete code
for you to run yourself, either on your machine or on a small host.

## 1. Run it locally

**Get Postgres.** Easiest is Postgres.app (Mac), the postgres.org installer
(Windows), or `sudo apt install postgresql` (Linux). Once it's running,
create a database:

```bash
createdb streamindex
```

**Install and configure:**

```bash
cd backend
npm install
cp .env.example .env
```

Open `.env` and set:
- `DATABASE_URL` — e.g. `postgres://postgres:yourpassword@localhost:5432/streamindex`
- `JWT_SECRET` — generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `FRONTEND_ORIGIN` — wherever you're serving `index.html`/`watch.html` from, e.g. `http://localhost:5500`

**Create the tables, then start the server:**

```bash
npm run db:setup
npm start
```

You should see `StreamIndex API listening on port 4000`. Confirm it's alive:

```bash
curl http://localhost:4000/api/health
# {"ok":true}
```

## 2. Try it with curl

```bash
# Register
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"something-long-enough"}'
# -> { "token": "...", "user": {...} }

# Save the token, then save some progress
TOKEN="paste-the-token-here"

curl -X PUT http://localhost:4000/api/progress \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"key":"1399-s1-e3","tmdbId":1399,"mediaType":"tv","season":1,"episode":3,"time":420,"duration":2700}'

curl http://localhost:4000/api/progress -H "Authorization: Bearer $TOKEN"
```

## 3. Wire it into the frontend

Everything in `index.html` and `watch.html` already reads and writes through
`store.js`, which has an API mode ready to go — you're not editing any of
the app logic, just telling it where to send requests once you have
somewhere to send them.

**a) Point it at your API**, once, before any other `Store` call. In both
`index.html` and `watch.html`, right after `<script src="store.js">` loads
(top of the boot code is fine):

```js
Store.setBackend('api', { base: 'http://localhost:4000' }); // or your deployed URL
```

**b) Add a login form.** Nothing currently in the app collects an email and
password — that UI doesn't exist yet. `store.js` already has the functions
it needs:

```js
await Store.register(email, password);   // creates the account, logs in
await Store.login(email, password);      // logs into an existing one
Store.logout();                           // clears the saved token, back to local-only
Store.isLoggedIn();                       // true/false, for showing the right button
```

I didn't build that form or wire it into the UI yet since there was nowhere
for it to point until now — say the word and I'll add a proper login/sign-up
modal to `index.html` next, matching the existing dark theme.

**One consequence worth knowing**: once `Store` is in `'api'` mode, anyone
using the site *without* logging in has nowhere for their bookmarks or
progress to go — `getList`/`getAllProgress` would need a logged-out
fallback. The simplest fix, when you get to the login form, is: stay in
`'local'` mode until login succeeds, then switch to `'api'` and merge in
whatever was saved locally. Just flag it for me when we build that part.

## 4. Put it somewhere permanent

Any Node host works; two free tiers that are easy to point at Postgres:

- **[Render](https://render.com)** — "New Web Service" from this repo,
  build command `npm install`, start command `npm start`. Add a Render
  Postgres instance and it hands you a `DATABASE_URL` to paste into your
  environment variables there.
- **[Railway](https://railway.app)** — similar flow; add a Postgres plugin
  from the same project and it injects `DATABASE_URL` automatically.

Either way: set the same variables from `.env` in the host's dashboard
(never commit `.env` itself), run `npm run db:setup` once against the
production database — most hosts let you do this via a one-off shell — and
update `FRONTEND_ORIGIN` to your real frontend URL once you know it.

## Notes on the choices made here

- **bcryptjs, not bcrypt.** The pure-JS version. Slightly slower, but it
  doesn't need a C++ build toolchain to install — one less thing to debug on
  a learning machine.
- **JWT in a header, not a session cookie.** Simpler to reason about when
  your frontend and API are on different origins (a static file host and a
  Node host, say), since cookies bring same-site/CORS rules that are their
  own rabbit hole.
- **No refresh tokens.** `JWT_EXPIRES_IN=30d` means a login lasts a month,
  then the app has to log in again. Fine for a personal project; a product
  with real users would want short-lived tokens plus a refresh flow.
