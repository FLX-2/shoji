//! LM Studio and llama.cpp's server on this computer: which one is running, and the models it has loaded. Both
//! speak OpenAI's Chat Completions, and the runtime finds the same server for each model's calls.

use serde::Serialize;

use crate::ollama::{address, exchange};

/// A local server that answered, and the models it lists.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// As the person knows it: "LM Studio", "llama.cpp", or "your local server" for one SHOJI_LOCAL_URL names.
    pub name: String,
    pub models: Vec<String>,
}

/// Where each server listens unless SHOJI_LOCAL_URL, which the runtime reads too, names another.
fn servers(given: Option<&str>) -> Vec<(String, (String, u16))> {
    match given.map(str::trim).filter(|g| !g.is_empty()) {
        Some(url) => vec![("your local server".into(), address(Some(url.trim_end_matches('/').trim_end_matches("/v1"))))],
        None => vec![
            ("LM Studio".into(), ("127.0.0.1".into(), 1234)),
            ("llama.cpp".into(), ("127.0.0.1".into(), 8080)),
        ],
    }
}

/// The ids a /v1/models answer lists, leaving out models made for embeddings, which can't hold a conversation.
fn listed(body: &str) -> Vec<String> {
    let value: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str().map(str::to_string))
        .filter(|id| !id.to_lowercase().contains("embed"))
        .collect()
}

/// The first local server that answers with a model, or an error saying none did.
pub fn found(given: Option<&str>) -> Result<Found, String> {
    for (name, host) in servers(given) {
        if let Ok(body) = exchange(&host, "GET", "/v1/models", "") {
            let models = listed(&body);
            if !models.is_empty() {
                return Ok(Found { name, models });
            }
        }
    }
    Err("No local server with a model loaded is running on this computer.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn looks_where_each_server_listens_unless_told() {
        let usual = servers(None);
        assert_eq!(usual[0], ("LM Studio".into(), ("127.0.0.1".into(), 1234)));
        assert_eq!(usual[1], ("llama.cpp".into(), ("127.0.0.1".into(), 8080)));
        assert_eq!(servers(Some("http://127.0.0.1:5001/v1/")), vec![("your local server".into(), ("127.0.0.1".into(), 5001))]);
    }

    #[test]
    fn lists_the_models_a_server_has_without_embeddings() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let mut stream = listener.incoming().next().unwrap().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let body = r#"{"object":"list","data":[{"id":"qwen/qwen3-coder-30b"},{"id":"text-embedding-nomic-embed-text-v1.5"}]}"#;
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            stream.write_all(reply.as_bytes()).unwrap();
        });
        let found = found(Some(&format!("http://127.0.0.1:{port}"))).unwrap();
        assert_eq!(found, Found { name: "your local server".into(), models: vec!["qwen/qwen3-coder-30b".into()] });
    }

    #[test]
    fn says_when_no_server_answers() {
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(found(Some(&format!("127.0.0.1:{free}"))).is_err());
    }
}
