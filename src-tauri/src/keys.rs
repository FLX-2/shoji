//! The person's API keys, one per provider, in the system keychain, and how a run is handed them.

use keyring::Entry;

/// Where the keys live in the system keychain. Each provider's key is its own entry, named by the provider.
const SERVICE: &str = "app.shoji.desktop";

/// A provider that takes an API key: its id, as model ids name it, its name for messages, and where a run
/// reads its key. Anthropic's entry and variable keep the names Shoji has always used.
pub struct Keyed {
    pub id: &'static str,
    pub name: &'static str,
    /// The variable a run reads the key from.
    pub run_env: &'static str,
    /// Variables a key may come from in the shell, for development.
    pub shell_env: &'static [&'static str],
}

pub const KEYED: &[Keyed] = &[
    Keyed {
        id: "anthropic",
        name: "Anthropic",
        run_env: "SHOJI_API_KEY",
        shell_env: &["SHOJI_API_KEY", "ANTHROPIC_API_KEY"],
    },
    Keyed {
        id: "openai",
        name: "OpenAI",
        run_env: "SHOJI_OPENAI_KEY",
        shell_env: &["SHOJI_OPENAI_KEY", "OPENAI_API_KEY"],
    },
];

pub fn keyed(provider: &str) -> Result<&'static Keyed, String> {
    KEYED
        .iter()
        .find(|k| k.id == provider)
        .ok_or_else(|| format!("Shoji doesn't keep a key for {provider}."))
}

fn entry(keyed: &Keyed) -> keyring::Result<Entry> {
    Entry::new(SERVICE, keyed.id)
}

pub fn saved(keyed: &Keyed) -> Option<String> {
    entry(keyed).and_then(|entry| entry.get_password()).ok()
}

/// A key from the shell, for development. An app opened from the Dock or Start menu won't see one.
pub fn from_shell(keyed: &Keyed) -> Option<String> {
    keyed
        .shell_env
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.trim().is_empty()))
}

pub fn save(keyed: &Keyed, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Paste a key first.".into());
    }
    entry(keyed)
        .and_then(|entry| entry.set_password(key))
        .map_err(|e| e.to_string())
}

pub fn forget(keyed: &Keyed) -> Result<(), String> {
    match entry(keyed).and_then(|entry| entry.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The provider a model id belongs to: the name before its first slash, or Anthropic for a bare id.
pub fn provider_of(model: &str) -> &str {
    model.split_once('/').map_or("anthropic", |(provider, _)| provider)
}

/// Every model a stack names, as the runtime's --stack-json takes it.
fn models_of(stack: &serde_json::Value) -> Vec<&str> {
    stack
        .as_object()
        .into_iter()
        .flat_map(|roles| roles.values())
        .filter_map(|seat| seat.get("model").and_then(|model| model.as_str()))
        .collect()
}

/// The variables a run of this stack gets its keys in: every key the person has, so a role can use any of
/// them. A stack that needs a key the person hasn't added stops here, before anything is made.
pub fn run_env(stack: &serde_json::Value, key: impl Fn(&Keyed) -> Option<String>) -> Result<Vec<(String, String)>, String> {
    for model in models_of(stack) {
        if let Some(needed) = KEYED.iter().find(|k| k.id == provider_of(model)) {
            if key(needed).is_none() {
                return Err(format!("Add your {} API key in Settings first.", needed.name));
            }
        }
    }
    Ok(KEYED
        .iter()
        .filter_map(|k| key(k).map(|value| (k.run_env.to_string(), value)))
        .collect())
}

/// A key the person saved, or else one from the shell.
pub fn any(keyed: &Keyed) -> Option<String> {
    saved(keyed).or_else(|| from_shell(keyed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stack(model: &str) -> serde_json::Value {
        let seat = json!({ "model": model, "effort": "low" });
        json!({ "scout": seat, "plan": seat, "build": seat, "review": seat })
    }

    #[test]
    fn reads_the_provider_from_the_model_id() {
        assert_eq!(provider_of("claude-haiku-5-5"), "anthropic");
        assert_eq!(provider_of("ollama/gemma4:31b"), "ollama");
        assert_eq!(provider_of("openrouter/vendor/model"), "openrouter");
    }

    #[test]
    fn hands_a_run_every_key_and_stops_on_a_missing_one() {
        let have = |k: &Keyed| (k.id == "anthropic").then(|| "sk-test".to_string());
        let none = |_: &Keyed| None;
        assert_eq!(
            run_env(&stack("claude-haiku-5-5"), have).unwrap(),
            vec![("SHOJI_API_KEY".to_string(), "sk-test".to_string())]
        );
        assert_eq!(
            run_env(&stack("claude-haiku-5-5"), none).unwrap_err(),
            "Add your Anthropic API key in Settings first."
        );
        // A provider without a key, such as Ollama on this computer, needs none.
        assert!(run_env(&stack("ollama/gemma4"), none).unwrap().is_empty());
        assert_eq!(
            run_env(&stack("openai/gpt-6.1-sol"), have).unwrap_err(),
            "Add your OpenAI API key in Settings first."
        );
    }

    #[test]
    fn keeps_the_anthropic_entry_where_earlier_versions_saved_it() {
        assert_eq!(keyed("anthropic").unwrap().id, "anthropic");
        assert_eq!(keyed("openai").unwrap().run_env, "SHOJI_OPENAI_KEY");
        assert!(keyed("nobody").is_err());
    }
}
