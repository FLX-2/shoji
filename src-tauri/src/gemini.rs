//! Google's Gemini models on the person's own API key from Google AI Studio.

use serde::Serialize;

/// Google's list of the models a key can use.
const MODELS: &str = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";

/// A Gemini model the key can use for a conversation: its id and Google's name for it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Listed {
    pub id: String,
    pub name: String,
}

/// Words in the ids of Gemini models made for something other than a conversation with tools.
const NOT_FOR_TASKS: &[&str] = &[
    "image",
    "tts",
    "embedding",
    "live",
    "audio",
    "robotics",
    "computer-use",
    "veo",
];

/// The Gemini models this key can use for a task.
pub async fn models(key: &str) -> Result<Vec<Listed>, String> {
    let answer = reqwest::Client::new()
        .get(MODELS)
        .header("x-goog-api-key", key)
        .send()
        .await
        .map_err(|_| "Shoji couldn't reach Google.".to_string())?;
    let status = answer.status();
    if status == reqwest::StatusCode::BAD_REQUEST
        || status == reqwest::StatusCode::FORBIDDEN
        || status == reqwest::StatusCode::UNAUTHORIZED
    {
        return Err(
            "Google didn't accept your Gemini key. Check it in Google AI Studio.".to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!(
            "Google couldn't list its models just now ({status}). Try again in a minute."
        ));
    }
    let value: serde_json::Value = answer.json().await.map_err(|e| e.to_string())?;
    Ok(listed(&value))
}

/// The models in Google's answer that hold a conversation, by their ids without "models/".
pub fn listed(value: &serde_json::Value) -> Vec<Listed> {
    value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model["name"].as_str()?.strip_prefix("models/")?;
            let converses = model["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|methods| {
                    methods
                        .iter()
                        .any(|m| m.as_str() == Some("generateContent"))
                });
            (id.starts_with("gemini-")
                && converses
                && !NOT_FOR_TASKS.iter().any(|word| id.contains(word)))
            .then(|| Listed {
                id: id.to_string(),
                name: model["displayName"].as_str().unwrap_or(id).to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lists_the_gemini_models_that_hold_a_conversation() {
        let answer = json!({ "models": [
            { "name": "models/gemini-3.5-flash", "displayName": "Gemini 3.5 Flash", "supportedGenerationMethods": ["generateContent", "countTokens"] },
            { "name": "models/gemini-2.5-flash-image", "displayName": "Nano Banana", "supportedGenerationMethods": ["generateContent"] },
            { "name": "models/gemini-embedding-001", "displayName": "Embedding", "supportedGenerationMethods": ["embedContent"] },
            { "name": "models/gemma-4-26b-it", "displayName": "Gemma 4", "supportedGenerationMethods": ["generateContent"] },
            { "name": "models/gemini-2.5-flash-preview-tts", "displayName": "TTS", "supportedGenerationMethods": ["generateContent"] }
        ]});
        assert_eq!(
            listed(&answer),
            vec![Listed {
                id: "gemini-3.5-flash".into(),
                name: "Gemini 3.5 Flash".into()
            }]
        );
    }
}
