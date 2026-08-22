require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");
const OBJECT_CONFIG = require("./objectConfig");

const {
  SF_LOGIN_URL = "https://login.salesforce.com",
  SF_CLIENT_ID,
  SF_CLIENT_SECRET,
  SF_REDIRECT_URI,
  SF_API_VERSION = "v60.0",
  SESSION_SECRET = "change-me-in-prod",
  PORT = 3000,
} = process.env;

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.session.sf || !req.session.sf.access_token) {
    return res.status(401).json({ error: "Not authenticated with Salesforce" });
  }
  next();
}

function sfClient(req) {
  const { access_token, instance_url } = req.session.sf;
  return axios.create({
    baseURL: `${instance_url}/services/data/${SF_API_VERSION}`,
    headers: { Authorization: `Bearer ${access_token}` },
  });
}

// Refresh the access token using the stored refresh_token when Salesforce
// returns a 401 (session expired), then retry the original request once.
async function withAutoRefresh(req, res, requestFn) {
  try {
    return await requestFn(sfClient(req));
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401 && req.session.sf.refresh_token) {
      try {
        const tokenRes = await axios.post(
          `${SF_LOGIN_URL}/services/oauth2/token`,
          new URLSearchParams({
            grant_type: "refresh_token",
            client_id: SF_CLIENT_ID,
            client_secret: SF_CLIENT_SECRET,
            refresh_token: req.session.sf.refresh_token,
          })
        );
        req.session.sf.access_token = tokenRes.data.access_token;
        return await requestFn(sfClient(req));
      } catch (refreshErr) {
        throw refreshErr;
      }
    }
    throw err;
  }
}

function sfErrorPayload(err) {
  if (err.response && err.response.data) return err.response.data;
  return { error: err.message };
}

// -- PKCE helpers -----------------------------------------------------------
// Newer Salesforce orgs require PKCE (Proof Key for Code Exchange) on the
// External Client App's web-server flow and don't allow it to be turned off.
// We generate a random code_verifier, send its SHA-256 hash (code_challenge)
// with the authorize request, then send the original code_verifier back
// when exchanging the code for a token so Salesforce can prove the same
// client made both requests.
function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generatePkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

// ---------------------------------------------------------------------------
// OAuth 2.0 (Web Server Flow) against the External Client App / Connected App
// ---------------------------------------------------------------------------

// Step 1: redirect the browser to Salesforce's authorization screen
app.get("/auth/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();
  req.session.oauthState = state;
  req.session.codeVerifier = codeVerifier;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SF_CLIENT_ID,
    redirect_uri: SF_REDIRECT_URI,
    scope: "api refresh_token offline_access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  res.redirect(`${SF_LOGIN_URL}/services/oauth2/authorize?${params.toString()}`);
});

// Step 2: Salesforce redirects back here with ?code=...&state=...
app.get("/auth/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Salesforce OAuth error: ${error} - ${error_description}`);
  }
  if (!state || state !== req.session.oauthState) {
    return res.status(400).send("Invalid OAuth state. Please try logging in again.");
  }

  const codeVerifier = req.session.codeVerifier;
  if (!codeVerifier) {
    return res.status(400).send("Missing PKCE code_verifier in session. Please try logging in again.");
  }

  try {
    const tokenRes = await axios.post(
      `${SF_LOGIN_URL}/services/oauth2/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: SF_CLIENT_ID,
        client_secret: SF_CLIENT_SECRET,
        redirect_uri: SF_REDIRECT_URI,
        code_verifier: codeVerifier,
      })
    );

    const { access_token, refresh_token, instance_url, id } = tokenRes.data;

    // Fetch basic identity info (name/email) for display in the UI
    let identity = {};
    try {
      const idRes = await axios.get(id, { headers: { Authorization: `Bearer ${access_token}` } });
      identity = { name: idRes.data.display_name, email: idRes.data.email, username: idRes.data.username };
    } catch (e) {
      /* non-fatal */
    }

    req.session.sf = { access_token, refresh_token, instance_url, identity };
    res.redirect("/");
  } catch (err) {
    console.error("Token exchange failed:", sfErrorPayload(err));
    res.status(500).send("OAuth token exchange failed. Check server logs.");
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session.sf || !req.session.sf.access_token) {
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, identity: req.session.sf.identity || {} });
});

// ---------------------------------------------------------------------------
// UI configuration (object list + field metadata) -- no auth required
// ---------------------------------------------------------------------------

app.get("/api/config", (req, res) => {
  const objects = Object.keys(OBJECT_CONFIG).map((key) => ({
    apiName: key,
    label: OBJECT_CONFIG[key].label,
    fields: OBJECT_CONFIG[key].fields,
  }));
  res.json({ objects });
});

// ---------------------------------------------------------------------------
// Generic CRUD endpoints for the configured Standard Objects
// ---------------------------------------------------------------------------

function assertKnownObject(objectName, res) {
  if (!OBJECT_CONFIG[objectName]) {
    res.status(400).json({ error: `Unsupported object: ${objectName}` });
    return false;
  }
  return true;
}

// READ (paginated, 20 records per page via SOQL LIMIT/OFFSET)
app.get("/api/records/:object", requireAuth, async (req, res) => {
  const { object } = req.params;
  if (!assertKnownObject(object, res)) return;

  const pageSize = 20;
  const offset = parseInt(req.query.offset, 10) || 0;
  const cfg = OBJECT_CONFIG[object];
  const fieldNames = ["Id", ...cfg.fields.map((f) => f.name)];
  const soql = `SELECT ${fieldNames.join(", ")} FROM ${object} ORDER BY CreatedDate DESC LIMIT ${pageSize} OFFSET ${offset}`;

  try {
    const result = await withAutoRefresh(req, res, (client) =>
      client.get("/query", { params: { q: soql } })
    );
    res.json({
      records: result.data.records,
      totalSize: result.data.totalSize,
      hasMore: offset + pageSize < result.data.totalSize,
      nextOffset: offset + pageSize,
    });
  } catch (err) {
    console.error(sfErrorPayload(err));
    res.status(err.response ? err.response.status : 500).json(sfErrorPayload(err));
  }
});

// CREATE
app.post("/api/records/:object", requireAuth, async (req, res) => {
  const { object } = req.params;
  if (!assertKnownObject(object, res)) return;

  try {
    const result = await withAutoRefresh(req, res, (client) =>
      client.post(`/sobjects/${object}`, req.body)
    );
    res.status(201).json(result.data);
  } catch (err) {
    console.error(sfErrorPayload(err));
    res.status(err.response ? err.response.status : 500).json(sfErrorPayload(err));
  }
});

// UPDATE
app.patch("/api/records/:object/:id", requireAuth, async (req, res) => {
  const { object, id } = req.params;
  if (!assertKnownObject(object, res)) return;

  try {
    await withAutoRefresh(req, res, (client) =>
      client.patch(`/sobjects/${object}/${id}`, req.body)
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(sfErrorPayload(err));
    res.status(err.response ? err.response.status : 500).json(sfErrorPayload(err));
  }
});

// DELETE
app.delete("/api/records/:object/:id", requireAuth, async (req, res) => {
  const { object, id } = req.params;
  if (!assertKnownObject(object, res)) return;

  try {
    await withAutoRefresh(req, res, (client) => client.delete(`/sobjects/${object}/${id}`));
    res.json({ ok: true });
  } catch (err) {
    console.error(sfErrorPayload(err));
    res.status(err.response ? err.response.status : 500).json(sfErrorPayload(err));
  }
});

app.listen(PORT, () => {
  console.log(`Salesforce CRUD app running on http://localhost:${PORT}`);
});
