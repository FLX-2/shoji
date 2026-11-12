//! OpenRouter: one account that reaches many providers' models, billed to the person's OpenRouter credit. Shoji
//! connects with OpenRouter's PKCE flow, which hands back a key the person controls on OpenRouter's site, so
//! nobody copies a key by hand. The key is kept in the keychain like any other.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use crate::chatgpt::{challenge, random, wait_for_callback};

const AUTH: &str = "https://openrouter.ai/auth";
const KEYS: &str = "https://openrouter.ai/api/v1/auth/keys";
const MODELS: &str = "https://openrouter.ai/api/v1/models?supported_parameters=tools";
const CONNECT_WAIT: Duration = Duration::from_secs(300);

/// A model OpenRouter lists that can use tools, with its prices in dollars per million tokens.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    pub id: String,
    pub name: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
}

/// OpenRouter's page that asks the person to let Shoji have a key.
pub fn auth_url(callback: &str, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(AUTH).expect("a valid address");
    url.query_pairs_mut()
        .append_pair("callback_url", callback)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("key_label", "Shoji")
        .append_pair("state", state);
    url.into()
}

/// Connects in the browser and returns the key OpenRouter made for Shoji. OpenRouter calls back on localhost,
/// which a browser may reach on either address, so Shoji listens on both.
pub async fn connect(open: impl FnOnce(&str) -> Result<(), String>) -> Result<String, String> {
    let v4 = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = v4.local_addr().map_err(|e| e.to_string())?.port();
    let v6 = TcpListener::bind(("::1", port)).await.ok();
    let verifier = random(32);
    let state = random(16);
    open(&auth_url(
        &format!("http://localhost:{port}/auth/callback"),
        &challenge(&verifier),
        &state,
    ))?;
    let deadline = Instant::now() + CONNECT_WAIT;
    let query = match &v6 {
        Some(v6) => tokio::select! {
            found = wait_for_callback(&v4, deadline) => found,
            found = wait_for_callback(v6, deadline) => found,
        },
        None => wait_for_callback(&v4, deadline).await,
    }?;
    if query.get("state") != Some(&state) {
        return Err("That answer didn't come from OpenRouter. Try connecting again.".into());
    }
    let code = query
        .get("code")
        .ok_or("OpenRouter didn't connect Shoji. Try again.")?;
    #[derive(Deserialize)]
    struct Made {
        key: String,
    }
    let answer = reqwest::Client::new()
        .post(KEYS)
        .json(&serde_json::json!({ "code": code, "code_verifier": verifier, "code_challenge_method": "S256" }))
        .send()
        .await
        .map_err(|_| "Shoji couldn't reach OpenRouter. Check your internet connection, then try again.".to_string())?;
    if !answer.status().is_success() {
        return Err(format!(
            "OpenRouter didn't hand Shoji a key ({}). Try connecting again.",
            answer.status()
        ));
    }
    let made: Made = answer.json().await.map_err(|e| e.to_string())?;
    Ok(made.key)
}

/// Every model OpenRouter lists that can use tools, cheapest last. OpenRouter's list is public.
pub async fn models() -> Result<Vec<Listed>, String> {
    let answer = reqwest::Client::new()
        .get(MODELS)
        .send()
        .await
        .map_err(|_| "Shoji couldn't reach OpenRouter.".to_string())?;
    let value: serde_json::Value = answer.json().await.map_err(|e| e.to_string())?;
    Ok(listed(&value))
}

/// The models in OpenRouter's answer that Shoji can price. A router with no fixed price is left out, since the
/// spending limits rest on prices.
pub fn listed(value: &serde_json::Value) -> Vec<Listed> {
    let per_million = |pricing: &serde_json::Value, field: &str| -> Option<f64> {
        let price: f64 = pricing.get(field)?.as_str()?.parse().ok()?;
        (price >= 0.0).then_some(price * 1e6)
    };
    let mut models: Vec<Listed> = value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let pricing = &model["pricing"];
            let input = per_million(pricing, "prompt")?;
            let output = per_million(pricing, "completion")?;
            Some(Listed {
                id: model["id"].as_str()?.to_string(),
                name: model["name"]
                    .as_str()
                    .unwrap_or_else(|| model["id"].as_str().unwrap_or(""))
                    .to_string(),
                input,
                output,
                cache_read: per_million(pricing, "input_cache_read").unwrap_or(input),
            })
        })
        .collect();
    models.sort_by(|a, b| {
        b.output
            .total_cmp(&a.output)
            .then_with(|| a.name.cmp(&b.name))
    });
    models
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn asks_for_a_key_with_pkce_and_names_it_shoji() {
        let url = url::Url::parse(&auth_url(
            "http://localhost:4242/auth/callback",
            "abc",
            "xyz",
        ))
        .unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("openrouter.ai"));
        assert_eq!(query["callback_url"], "http://localhost:4242/auth/callback");
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["key_label"], "Shoji");
        assert_eq!(query["state"], "xyz");
    }

    #[test]
    fn prices_models_per_million_tokens_and_leaves_out_ones_without_a_price() {
        let answer = json!({ "data": [
            { "id": "vendor/small", "name": "Vendor: Small", "pricing": { "prompt": "0.0000001", "completion": "0.0000004" } },
            { "id": "vendor/large", "name": "Vendor: Large", "pricing": { "prompt": "0.000003", "completion": "0.000015", "input_cache_read": "0.0000003" } },
            { "id": "openrouter/auto", "name": "Auto Router", "pricing": { "prompt": "-1", "completion": "-1" } },
            { "id": "vendor/free:free", "name": "Vendor: Free", "pricing": { "prompt": "0", "completion": "0" } }
        ]});
        let models = listed(&answer);
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["vendor/large", "vendor/small", "vendor/free:free"]
        );
        assert!((models[0].input - 3.0).abs() < 1e-9);
        assert!((models[0].output - 15.0).abs() < 1e-9);
        assert!((models[0].cache_read - 0.3).abs() < 1e-9);
        // No cache price listed: a cached token costs what any input token does.
        assert!((models[1].cache_read - models[1].input).abs() < 1e-12);
    }
}
