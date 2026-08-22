# Salesforce Data Console

A web app that performs CRUD (Create, Read, Update, Delete) on five Salesforce
standard objects — **Account, Opportunity, Lead, Contact, Case** — through a
single UI, authenticated with **OAuth 2.0** via a Salesforce **External
Client App**, and talking to Salesforce entirely through the **REST API**
(no native Salesforce UI involved).

Stack: **Node.js + Express** backend (OAuth 2.0 web-server flow, session
storage, REST proxy) and a **vanilla HTML/CSS/JS** frontend (no build step,
so it deploys anywhere Node runs).

---

## 1. Create a Salesforce Developer Org

1. Go to <https://developer.salesforce.com/signup> and sign up for a free
   Developer Edition org.
2. Verify your email and log in at `https://login.salesforce.com`.

## 2. Create an External Client App (the OAuth bridge)

1. In Setup, search for **External Client Apps** → **External Client App
   Manager** → **New External Client App**.
2. Fill in Basic Information (name, API name, contact email).
3. Under **API (Enable OAuth Settings)**:
   - Check **Enable OAuth**.
   - **Callback URL**: add both, one per line:
     ```
     http://localhost:3000/auth/callback
     https://YOUR-DEPLOYED-DOMAIN/auth/callback
     ```
   - **OAuth Scopes**: add `Manage user data via APIs (api)`,
     `Perform requests at any time (refresh_token, offline_access)`.
   - Enable **Require Proof Key for Code Exchange (PKCE)** = off (this app
     uses the classic confidential Client Secret flow), leave
     **Require Secret for Web Server Flow** checked.
4. Save. Creation of the OAuth settings takes a few minutes to propagate.
5. Under **Settings → OAuth Settings**, click **Manage Consumer Details**
   (you'll need to verify via email/2FA) to reveal the **Consumer Key**
   (= `SF_CLIENT_ID`) and **Consumer Secret** (= `SF_CLIENT_SECRET`).
6. Under **Policies**, set the **Permitted Users** to "All users may
   self-authorize" (simplest for a dev/demo org).

## 3. Configure the app

```bash
cp .env.example .env
```

Edit `.env`:

```
SF_LOGIN_URL=https://login.salesforce.com
SF_CLIENT_ID=<Consumer Key from step 2>
SF_CLIENT_SECRET=<Consumer Secret from step 2>
SF_REDIRECT_URI=http://localhost:3000/auth/callback
SF_API_VERSION=v60.0
SESSION_SECRET=<any long random string>
PORT=3000
```

## 4. Run locally

```bash
npm install
npm start
```

Open <http://localhost:3000>, click **Log in with Salesforce**, approve the
OAuth consent screen, and you'll land back in the app authenticated.

---

## How it works

### OAuth 2.0 (Web Server Flow)

- `GET /auth/login` redirects the browser to Salesforce's
  `/services/oauth2/authorize` endpoint with `response_type=code`.
- Salesforce redirects back to `GET /auth/callback?code=...`.
- The server exchanges the code for an `access_token` + `refresh_token` at
  `/services/oauth2/token` and stores them server-side in an
  `express-session`. No token ever reaches the browser directly.
- If a Salesforce call returns `401` (expired session), the server silently
  uses the stored `refresh_token` to get a new `access_token` and retries
  once (`withAutoRefresh` in `server.js`).

### Dynamic object + field selection

`objectConfig.js` defines the 5 standard objects exposed in the dropdown and
5–10 fields per object. `GET /api/config` serves this to the frontend, which
builds the table columns and the create/edit form fields dynamically — no
per-object frontend code.

### CRUD against the Salesforce REST API

| UI action     | Backend route                              | Salesforce REST call                                  |
|---------------|---------------------------------------------|---------------------------------------------------------|
| List (page)   | `GET /api/records/:object?offset=N`         | `GET /query?q=SELECT ... LIMIT 20 OFFSET N`             |
| Create        | `POST /api/records/:object`                 | `POST /sobjects/:object`                                |
| Update        | `PATCH /api/records/:object/:id`            | `PATCH /sobjects/:object/:id`                            |
| Delete        | `DELETE /api/records/:object/:id`           | `DELETE /sobjects/:object/:id`                            |

### Pagination / infinite scroll

The frontend requests 20 records at a time (`LIMIT 20 OFFSET offset`). A
`scroll` listener checks distance from the bottom of the page and calls the
next page automatically, appending rows to the existing table.

---

## 5. Deploy for free

Any Node-friendly host works since this is a single Express server with no
build step. **Render.com** (used below) has a free web-service tier.

1. Push this project to a **public GitHub repo**.
2. On [render.com](https://render.com) → **New → Web Service** → connect
   the repo.
3. Build command: `npm install`  Start command: `npm start`.
4. Add the environment variables from `.env` in the Render dashboard
   (**Environment** tab), setting `SF_REDIRECT_URI` to
   `https://<your-render-subdomain>.onrender.com/auth/callback`.
5. Deploy, then go back to the External Client App in Salesforce Setup and
   add that same URL to **Callback URL**.
6. Visit your Render URL and log in.

(Railway, Fly.io, Cyclic, or a small VM work the same way — set the same
env vars and matching callback URL.)

---

## Project structure

```
sf-crud-app/
├── server.js            # Express app: OAuth routes + CRUD REST proxy
├── objectConfig.js       # Object/field definitions used by both routes and UI
├── package.json
├── .env.example
└── public/
    ├── index.html        # Login screen, object dropdown, table, modals
    ├── style.css
    └── app.js             # Fetch config, render table, infinite scroll, CRUD modals
```
