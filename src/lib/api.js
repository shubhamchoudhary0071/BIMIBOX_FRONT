// src/lib/api.js
import axios from "axios";

const APS_CLIENT_ID = import.meta.env.VITE_APS_CLIENT_ID;
const APS_CLIENT_SECRET = import.meta.env.VITE_APS_CLIENT_SECRET;
const APS_BASE = "https://developer.api.autodesk.com";

/* -------------------------------------------------
   Token cache – avoids a request on every call
   ------------------------------------------------- */
let _cachedToken = null;
let _expiresAt = 0;

/* -------------------------------------------------
   Helper – refresh token if needed
   ------------------------------------------------- */
async function ensureToken(scopes = ["data:read", "viewables:read"]) {
  const now = Date.now();

  // If we have a valid token, reuse it
  if (_cachedToken && now < _expiresAt) {
    return _cachedToken;
  }

  if (!APS_CLIENT_ID || !APS_CLIENT_SECRET) {
    throw new Error("Missing VITE_APS_CLIENT_ID or VITE_APS_CLIENT_SECRET in .env");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: APS_CLIENT_ID,
    client_secret: APS_CLIENT_SECRET,
    scope: scopes.join(" "),
  });

  const { data } = await axios.post(
    `${APS_BASE}/authentication/v2/token`,
    body,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  // Cache for (expires_in - 30s) to be safe
  _cachedToken = data;
  _expiresAt = now + (data.expires_in - 30) * 1000;

  console.log("[APS] New token obtained – expires in", data.expires_in, "s");
  return data;
}

/* -------------------------------------------------
   Public: getOAuthToken
   ------------------------------------------------- */
export async function getOAuthToken(scopes = ["data:read", "viewables:read"]) {
  return ensureToken(scopes);
}

/* -------------------------------------------------
   Public: getUnits (real endpoint – no client-credentials in query)
   ------------------------------------------------- */
export async function getUnits() {
  const token = await ensureToken(["data:read"]);

  const { data } = await axios.get(`${APS_BASE}/parameters/v1/units`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

  return data; // { units: [...] }
}

/* -------------------------------------------------
   Optional: expose raw token for debugging
   ------------------------------------------------- */
export const debugToken = () => _cachedToken;