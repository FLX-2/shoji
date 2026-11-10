//! Sign in with ChatGPT: a ChatGPT Plus or Pro subscriber runs OpenAI's models in Shoji on their own plan, with
//! no API key. This is OpenAI's path for open-source apps that run on the person's computer
//! (https://developers.openai.com/siwc): Shoji registers itself at the first sign-in and gets its own client
//! ID back, the browser hands the sign-in to a listener on 127.0.0.1, and the tokens stay on this computer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// ChatGPT's settings, where the person manages their plan's usage.
pub const USAGE_PAGE: &str = "https://chatgpt.com/#settings";
const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const DISCOVERY: &str = "https://auth.openai.com/.well-known/openid-configuration";
const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The scope that lets Shoji use the plan. A sign-in without it proves who the person is, nothing more.
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
/// The client ID of a first sign-in, which registers Shoji and gets its own ID back.
const FIRST_CLIENT: &str = "dynamic_agent_client";
/// The name the person sees when they allow Shoji. It must stay the same everywhere.
const APP_NAME: &str = "Shoji";
/// How long the browser has to come back.
const SIGN_IN_WAIT: Duration = Duration::from_secs(300);
/// A token this close to its end is renewed before it's handed out.
const RENEW_BEFORE_MS: i64 = 5 * 60 * 1000;

/// One signed-in account's tokens.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Session {
    pub sub: String,
    pub access_token: String,
    pub refresh_token: String,
    /// When the access token ends, in ms since 1970.
    pub expires_at: i64,
    pub id_token: String,
    pub scopes: Vec<String>,
}

/// What Shoji keeps about the sign-in, in a file only this person can read.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Saved {
    /// This computer, to OpenAI: a random ID made once, never anything about the person.
    pub host_id: String,
    /// The client ID OpenAI issued at the first sign-in, used for every sign-in after.
    pub client_id: Option<String>,
    pub email: Option<String>,
    pub session: Option<Session>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub signed_in: bool,
    pub email: Option<String>,
}

/// A model on the person's plan, as OpenAI lists it for them.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanModel {
    pub slug: String,
    pub display_name: String,
}

/// Where the sign-in lives. Renewals and writes take turns, so two runs never race a rotating refresh token.
pub struct Store {
    path: PathBuf,
    turn: tokio::sync::Mutex<()>,
    http: reqwest::Client,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

pub(crate) fn random(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("the system has no randomness");
    URL_SAFE_NO_PAD.encode(buf)
}

/// A version 4 UUID, as OpenAI's urn:uuid host IDs take it.
fn uuid() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("the system has no randomness");
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// The PKCE challenge for a verifier.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Store { path, turn: tokio::sync::Mutex::new(()), http: reqwest::Client::new() }
    }

    pub fn load(&self) -> Saved {
        load(&self.path)
    }

    pub fn status(&self) -> Status {
        let saved = self.load();
        Status { signed_in: saved.session.is_some(), email: saved.session.and(saved.email) }
    }

    /// Opens the browser at OpenAI, waits for the person to allow Shoji, and keeps the tokens.
    pub async fn sign_in(&self, open: impl FnOnce(&str) -> Result<(), String>) -> Result<Status, String> {
        let _turn = self.turn.lock().await;
        let mut saved = self.load();
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let redirect = format!("http://127.0.0.1:{port}/auth/callback");
        let (state, nonce, verifier) = (random(24), random(24), random(48));
        let url = authorize_url(&saved, &redirect, &state, &nonce, &challenge(&verifier));
        open(&url)?;

        let back = wait_for_callback(&listener, Instant::now() + SIGN_IN_WAIT).await?;
        if back.get("state") != Some(&state) {
            return Err("The sign-in came back for another attempt. Try again.".into());
        }
        if let Some(error) = back.get("error") {
            return Err(if error == "access_denied" {
                "You didn't allow Shoji to use your ChatGPT plan.".into()
            } else {
                format!("ChatGPT didn't finish the sign-in: {error}.")
            });
        }
        let code = back.get("code").ok_or("ChatGPT sent no sign-in code. Try again.")?;
        let client_id = match (&saved.client_id, back.get("client_id")) {
            (Some(kept), Some(given)) if kept != given => {
                return Err("ChatGPT answered for another app. Try again.".into())
            }
            (_, Some(given)) => given.clone(),
            (Some(kept), None) => kept.clone(),
            (None, None) => return Err("ChatGPT didn't register Shoji. Try again.".into()),
        };

        let form = [
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("resource", RESOURCE),
        ];
        let tokens = self.token_request(&form).await?;
        let claims = self.verify(&tokens.id_token, &client_id, &nonce).await?;
        if !tokens.scopes().iter().any(|s| s == PLAN_SCOPE) {
            return Err("ChatGPT didn't let Shoji use your plan. Sign in again and allow it.".into());
        }
        saved.client_id = Some(client_id);
        saved.email = claims.email.or(saved.email);
        saved.session = Some(tokens.session(claims.sub)?);
        save(&self.path, &saved)?;
        Ok(Status { signed_in: true, email: saved.email })
    }

    /// A current access token and when it ends, renewed first when it's near its end. None once signed out.
    pub async fn token(&self) -> Result<Option<(String, i64)>, String> {
        let _turn = self.turn.lock().await;
        let mut saved = self.load();
        let Some(session) = saved.session.clone() else { return Ok(None) };
        if session.expires_at - now_ms() > RENEW_BEFORE_MS {
            return Ok(Some((session.access_token, session.expires_at)));
        }
        let client_id = saved.client_id.clone().ok_or("Shoji has no client ID for ChatGPT.")?;
        let form = [
            ("grant_type", "refresh_token"),
            ("client_id", client_id.as_str()),
            ("refresh_token", session.refresh_token.as_str()),
            ("resource", RESOURCE),
        ];
        match self.token_request(&form).await {
            Ok(tokens) => {
                // The new refresh token replaces the old one, which can't be used again.
                saved.session = Some(Session {
                    access_token: tokens.access_token.clone(),
                    refresh_token: tokens.refresh_token.clone().unwrap_or(session.refresh_token),
                    expires_at: now_ms() + tokens.expires_in.unwrap_or(3600) * 1000,
                    id_token: if tokens.id_token.is_empty() { session.id_token } else { tokens.id_token.clone() },
                    scopes: if tokens.scope.is_some() { tokens.scopes() } else { session.scopes },
                    sub: session.sub,
                });
                save(&self.path, &saved)?;
                Ok(saved.session.map(|s| (s.access_token, s.expires_at)))
            }
            Err(e) if e.starts_with("refused:") => {
                // The sign-in can't be renewed: it ended, or was revoked. Keep the client ID for next time.
                saved.session = None;
                save(&self.path, &saved)?;
                Ok(None)
            }
            Err(e) => Err(e),
        }
    }

    /// Ends the sign-in here and asks OpenAI to end it too. Returns a note when OpenAI didn't confirm that.
    pub async fn sign_out(&self) -> Result<Option<String>, String> {
        let _turn = self.turn.lock().await;
        let mut saved = self.load();
        let Some(session) = saved.session.take() else { return Ok(None) };
        save(&self.path, &saved)?;
        let revoked = match (&saved.client_id, self.discovery().await) {
            (Some(client_id), Ok(found)) => match found["revocation_endpoint"].as_str() {
                Some(endpoint) => self
                    .http
                    .post(endpoint)
                    .form(&[
                        ("token", session.refresh_token.as_str()),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", client_id.as_str()),
                    ])
                    .send()
                    .await
                    .is_ok_and(|r| r.status().is_success()),
                None => false,
            },
            _ => false,
        };
        Ok((!revoked).then(|| {
            "Signed out here, but ChatGPT didn't confirm it. Disconnect Shoji in ChatGPT's settings to be sure.".into()
        }))
    }

    /// The models the person's plan offers, by OpenAI's names for them.
    pub async fn models(&self) -> Result<Vec<PlanModel>, String> {
        let Some((token, _)) = self.token().await? else { return Ok(vec![]) };
        let answer = self
            .http
            .get(format!("{RESOURCE}/models"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "Shoji couldn't reach ChatGPT.".to_string())?;
        if !answer.status().is_success() {
            return Err(format!("ChatGPT didn't list your plan's models ({}).", answer.status().as_u16()));
        }
        let value: serde_json::Value = answer.json().await.map_err(|e| e.to_string())?;
        Ok(plan_models(&value))
    }

    async fn discovery(&self) -> Result<serde_json::Value, String> {
        let answer = self.http.get(DISCOVERY).send().await.map_err(|e| e.to_string())?;
        answer.json().await.map_err(|e| e.to_string())
    }

    async fn token_request(&self, form: &[(&str, &str)]) -> Result<Tokens, String> {
        let answer = self
            .http
            .post(TOKEN)
            .form(form)
            .send()
            .await
            .map_err(|_| "Shoji couldn't reach ChatGPT. Check your internet connection.".to_string())?;
        let status = answer.status();
        let value: serde_json::Value = answer.json().await.unwrap_or_default();
        if !status.is_success() {
            let error = value["error"].as_str().unwrap_or("unknown");
            if status.as_u16() == 400 || status.as_u16() == 401 {
                return Err(format!("refused: {error}"));
            }
            return Err(format!("ChatGPT couldn't sign Shoji in right now ({error}). Try again in a few minutes."));
        }
        serde_json::from_value(value).map_err(|e| e.to_string())
    }

    /// Checks the ID token against OpenAI's published keys: its signer, issuer, audience, time and nonce.
    async fn verify(&self, id_token: &str, client_id: &str, nonce: &str) -> Result<Claims, String> {
        let found = self.discovery().await?;
        let jwks_uri = found["jwks_uri"].as_str().ok_or("ChatGPT published no signing keys.")?;
        let keys: jsonwebtoken::jwk::JwkSet = self
            .http
            .get(jwks_uri)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        verify_with(id_token, client_id, nonce, &keys)
    }
}

#[derive(Deserialize, Debug)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: String,
    expires_in: Option<i64>,
    scope: Option<String>,
}

impl Tokens {
    fn scopes(&self) -> Vec<String> {
        self.scope.as_deref().unwrap_or("").split_whitespace().map(String::from).collect()
    }

    fn session(self, sub: String) -> Result<Session, String> {
        let scopes = self.scopes();
        Ok(Session {
            sub,
            access_token: self.access_token,
            refresh_token: self.refresh_token.ok_or("ChatGPT gave Shoji no way to stay signed in. Try again.")?,
            expires_at: now_ms() + self.expires_in.unwrap_or(3600) * 1000,
            id_token: self.id_token,
            scopes,
        })
    }
}

#[derive(Deserialize, Debug)]
pub struct Claims {
    sub: String,
    email: Option<String>,
    nonce: Option<String>,
}

pub fn verify_with(id_token: &str, client_id: &str, nonce: &str, keys: &jsonwebtoken::jwk::JwkSet) -> Result<Claims, String> {
    let bad = |_| "ChatGPT's sign-in couldn't be checked. Try again.".to_string();
    let header = jsonwebtoken::decode_header(id_token).map_err(bad)?;
    let jwk = match &header.kid {
        Some(kid) => keys.find(kid),
        None => keys.keys.first(),
    }
    .ok_or("ChatGPT signed the sign-in with a key it doesn't publish.")?;
    let key = jsonwebtoken::DecodingKey::from_jwk(jwk).map_err(bad)?;
    let mut rules = jsonwebtoken::Validation::new(header.alg);
    rules.set_issuer(&[ISSUER]);
    rules.set_audience(&[client_id]);
    let claims = jsonwebtoken::decode::<Claims>(id_token, &key, &rules).map_err(bad)?.claims;
    if claims.nonce.as_deref() != Some(nonce) {
        return Err("The sign-in came back for another attempt. Try again.".into());
    }
    Ok(claims)
}

/// The address the browser opens: a first sign-in registers Shoji, and later ones reuse its client ID.
pub fn authorize_url(saved: &Saved, redirect: &str, state: &str, nonce: &str, challenge: &str) -> String {
    let mut url = url::Url::parse(AUTHORIZE).expect("a fixed address");
    {
        let mut q = url.query_pairs_mut();
        match &saved.client_id {
            Some(id) => {
                q.append_pair("client_id", id);
                if let Some(email) = &saved.email {
                    q.append_pair("login_hint", email);
                }
            }
            None => {
                q.append_pair("client_id", FIRST_CLIENT);
                q.append_pair("agent_name_hint", APP_NAME);
            }
        }
        q.append_pair("ext_agent_host_id", &saved.host_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", redirect)
            .append_pair("scope", SCOPE)
            .append_pair("resource", RESOURCE)
            .append_pair("state", state)
            .append_pair("nonce", nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", challenge);
    }
    url.into()
}

/// The models a plan offers, from OpenAI's /models answer for it: only the ones it lists for picking.
pub fn plan_models(value: &serde_json::Value) -> Vec<PlanModel> {
    value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"].as_str() == Some("list"))
        .filter_map(|m| {
            let slug = m["slug"].as_str()?.to_string();
            let display_name = m["display_name"].as_str().unwrap_or(&slug).to_string();
            Some(PlanModel { slug, display_name })
        })
        .collect()
}

/// The query of a request to the callback, or None for any other request, such as the browser's icon.
pub fn callback_query(request: &str) -> Option<HashMap<String, String>> {
    let target = request.lines().next()?.split(' ').nth(1)?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    (url.path() == "/auth/callback").then(|| url.query_pairs().into_owned().collect())
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Shoji</title><body style=\"font:16px system-ui;margin:48px;background:#141413;color:#f2efe9\"><p>You can close this tab and go back to Shoji.</p>";

pub(crate) async fn wait_for_callback(listener: &TcpListener, deadline: Instant) -> Result<HashMap<String, String>, String> {
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let (mut stream, _) = tokio::time::timeout(left, listener.accept())
            .await
            .map_err(|_| "The sign-in took too long. Try again.".to_string())?
            .map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 16 * 1024];
        let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf)).await.unwrap_or(Ok(0)).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..read]);
        let found = callback_query(&request);
        let (status, body) = if found.is_some() { ("200 OK", DONE_PAGE) } else { ("404 Not Found", "") };
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(reply.as_bytes()).await;
        if let Some(query) = found {
            return Ok(query);
        }
    }
}

pub fn load(path: &Path) -> Saved {
    let mut saved: Saved = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if saved.host_id.is_empty() {
        saved.host_id = format!("urn:uuid:{}", uuid());
    }
    saved
}

/// Writes the whole file at once, readable only by this person.
pub fn save(path: &Path, saved: &Saved) -> Result<(), String> {
    let text = serde_json::to_string(saved).map_err(|e| e.to_string())?;
    let partial = path.with_extension("json.part");
    {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        use std::io::Write;
        let mut file = options.open(&partial).map_err(|e| e.to_string())?;
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&partial, path).map_err(|e| e.to_string())
}

/// Whether a stack, as the runtime's --stack-json takes it, has a role on the ChatGPT plan.
pub fn uses_plan(stack: &serde_json::Value) -> bool {
    stack
        .as_object()
        .is_some_and(|roles| roles.values().any(|seat| seat["model"].as_str().is_some_and(|m| m.starts_with("chatgpt/"))))
}

/// What a run on the plan is handed: the saved token and its end. A token near its end is renewed by the run
/// asking, so starting a run never waits on the network.
pub fn run_env(saved: &Saved) -> Result<Vec<(String, String)>, String> {
    let session = saved.session.as_ref().ok_or("Sign in with ChatGPT in Settings first.")?;
    Ok(vec![
        ("SHOJI_CHATGPT_TOKEN".into(), session.access_token.clone()),
        ("SHOJI_CHATGPT_EXPIRES".into(), session.expires_at.to_string()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(client: Option<&str>) -> Saved {
        Saved {
            host_id: "urn:uuid:7c3c5b0e-2f4c-4a8e-9a55-2c7f5e1b9d10".into(),
            client_id: client.map(String::from),
            email: client.map(|_| "bob@example.com".into()),
            session: None,
        }
    }

    fn query(url: &str) -> HashMap<String, String> {
        url::Url::parse(url).unwrap().query_pairs().into_owned().collect()
    }

    #[test]
    fn registers_shoji_on_the_first_sign_in_and_reuses_its_client_id_after() {
        let first = query(&authorize_url(&saved(None), "http://127.0.0.1:5000/auth/callback", "s", "n", "c"));
        assert_eq!(first["client_id"], "dynamic_agent_client");
        assert_eq!(first["agent_name_hint"], "Shoji");
        assert_eq!(first["scope"], "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
        assert_eq!(first["resource"], "https://api.openai.com/v1");
        assert_eq!(first["redirect_uri"], "http://127.0.0.1:5000/auth/callback");
        assert_eq!(first["code_challenge_method"], "S256");
        assert_eq!(first["ext_agent_host_id"], "urn:uuid:7c3c5b0e-2f4c-4a8e-9a55-2c7f5e1b9d10");
        let again = query(&authorize_url(&saved(Some("oaiapp_1")), "http://127.0.0.1:5001/auth/callback", "s", "n", "c"));
        assert_eq!(again["client_id"], "oaiapp_1");
        assert_eq!(again["login_hint"], "bob@example.com");
        assert!(!again.contains_key("agent_name_hint"));
    }

    #[test]
    fn makes_the_pkce_challenge_as_rfc_7636_does() {
        // RFC 7636, appendix B.
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn reads_only_the_callback() {
        let back = callback_query("GET /auth/callback?code=abc&state=xyz&client_id=oaiapp_1 HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        assert_eq!((back["code"].as_str(), back["state"].as_str(), back["client_id"].as_str()), ("abc", "xyz", "oaiapp_1"));
        assert!(callback_query("GET /favicon.ico HTTP/1.1\r\n").is_none());
    }

    #[test]
    fn lists_only_the_models_a_plan_offers_for_picking() {
        let value = serde_json::json!({ "models": [
            { "slug": "gpt-6", "display_name": "GPT-6", "visibility": "list" },
            { "slug": "internal", "display_name": "Internal", "visibility": "hide" },
        ]});
        assert_eq!(plan_models(&value), vec![PlanModel { slug: "gpt-6".into(), display_name: "GPT-6".into() }]);
    }

    #[test]
    fn keeps_the_sign_in_in_a_file_only_this_person_reads() {
        let dir = std::env::temp_dir().join(format!("shoji-chatgpt-{}", random(6)));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chatgpt.json");
        let first = load(&path);
        assert!(first.host_id.starts_with("urn:uuid:"));
        let mut kept = first.clone();
        kept.session = Some(Session {
            sub: "user-1".into(),
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: 1,
            id_token: "i".into(),
            scopes: vec![PLAN_SCOPE.into()],
        });
        save(&path, &kept).unwrap();
        assert_eq!(load(&path), kept);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(run_env(&kept).unwrap()[0], ("SHOJI_CHATGPT_TOKEN".into(), "a".into()));
        assert_eq!(run_env(&first).unwrap_err(), "Sign in with ChatGPT in Settings first.");
    }

    #[test]
    fn sees_a_stack_with_a_role_on_the_plan() {
        let seat = |m: &str| serde_json::json!({ "model": m, "effort": "low" });
        assert!(uses_plan(&serde_json::json!({ "scout": seat("claude-haiku-5-5"), "build": seat("chatgpt/gpt-6") })));
        assert!(!uses_plan(&serde_json::json!({ "scout": seat("claude-haiku-5-5") })));
    }
}
