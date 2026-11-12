//! The models pulled into Ollama on this computer, for Stack to offer. Only the ones that can call tools are
//! listed, since every step of a thread uses tools.
//!
//! Asked from here rather than the window, since Ollama only answers pages from the origins it trusts.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pulled {
    /// Ollama's name for the model, such as gemma4:31b.
    pub name: String,
    /// Bytes on disk, which says roughly how strong and how slow it is.
    pub size: u64,
}

/// Where Ollama listens: OLLAMA_HOST, as Ollama itself reads it, or its usual port on this computer.
pub fn address(host: Option<&str>) -> (String, u16) {
    let given = host
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .unwrap_or("127.0.0.1:11434");
    let bare = given
        .split_once("://")
        .map_or(given, |(_, rest)| rest)
        .trim_end_matches('/');
    let (name, port) = match bare.rsplit_once(':') {
        Some((name, port)) if !name.ends_with(']') || bare.starts_with('[') => match port.parse() {
            Ok(port) => (name, port),
            Err(_) => (bare, 11434),
        },
        _ => (bare, 11434),
    };
    let name = name.trim_start_matches('[').trim_end_matches(']');
    let name = if name == "0.0.0.0" || name == "::" || name.is_empty() {
        "127.0.0.1"
    } else {
        name
    };
    (name.to_string(), port)
}

/// One plain HTTP/1.0 exchange, so the answer comes whole with no chunking, and its body if it's a 200.
fn exchange(host: &(String, u16), method: &str, path: &str, body: &str) -> Result<String, String> {
    let gone = || "Ollama isn't running on this computer.".to_string();
    let addr = (host.0.as_str(), host.1)
        .to_socket_addrs()
        .map_err(|_| gone())?
        .next()
        .ok_or_else(gone)?;
    let mut stream =
        TcpStream::connect_timeout(&addr, Duration::from_millis(800)).map_err(|_| gone())?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let request = format!(
        "{method} {path} HTTP/1.0\r\nHost: {}:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        host.0,
        host.1,
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut answer = String::new();
    stream
        .read_to_string(&mut answer)
        .map_err(|e| e.to_string())?;
    let (head, body) = answer
        .split_once("\r\n\r\n")
        .ok_or("Ollama's answer was cut short.")?;
    if !head
        .lines()
        .next()
        .is_some_and(|status| status.split(' ').nth(1) == Some("200"))
    {
        return Err("Ollama didn't answer as expected.".into());
    }
    Ok(body.to_string())
}

/// The names and sizes in Ollama's /api/tags answer.
fn tags(body: &str) -> Vec<(String, u64)> {
    let value: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            Some((
                m["name"].as_str()?.to_string(),
                m["size"].as_u64().unwrap_or(0),
            ))
        })
        .collect()
}

/// Whether /api/show says the model can call tools.
fn uses_tools(body: &str) -> bool {
    let value: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    value["capabilities"]
        .as_array()
        .is_some_and(|caps| caps.iter().any(|c| c.as_str() == Some("tools")))
}

/// The pulled models that can call tools, largest first.
pub fn pulled(host: Option<&str>) -> Result<Vec<Pulled>, String> {
    let host = address(host);
    let mut found: Vec<Pulled> = tags(&exchange(&host, "GET", "/api/tags", "")?)
        .into_iter()
        .filter(|(name, _)| {
            let ask = serde_json::json!({ "model": name }).to_string();
            exchange(&host, "POST", "/api/show", &ask).is_ok_and(|body| uses_tools(&body))
        })
        .map(|(name, size)| Pulled { name, size })
        .collect();
    found.sort_by(|a, b| b.size.cmp(&a.size).then(a.name.cmp(&b.name)));
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn reads_ollama_host_as_ollama_does() {
        assert_eq!(address(None), ("127.0.0.1".into(), 11434));
        assert_eq!(address(Some("0.0.0.0")), ("127.0.0.1".into(), 11434));
        assert_eq!(address(Some("0.0.0.0:8080")), ("127.0.0.1".into(), 8080));
        assert_eq!(
            address(Some("http://192.168.1.20:11500/")),
            ("192.168.1.20".into(), 11500)
        );
        assert_eq!(address(Some("[::1]:11434")), ("::1".into(), 11434));
    }

    /// A stand-in Ollama that answers each request from a list, in order.
    fn ollama(answers: Vec<&'static str>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for (answer, stream) in answers.into_iter().zip(listener.incoming()) {
                let mut stream = stream.unwrap();
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{answer}",
                    answer.len()
                );
                stream.write_all(reply.as_bytes()).unwrap();
            }
        });
        format!("127.0.0.1:{port}")
    }

    #[test]
    fn lists_only_the_models_that_can_call_tools_largest_first() {
        let host = ollama(vec![
            r#"{"models":[{"name":"tiny:1b","size":800},{"name":"embed:latest","size":300},{"name":"gemma4:31b","size":19000}]}"#,
            r#"{"capabilities":["completion","tools"]}"#,
            r#"{"capabilities":["embedding"]}"#,
            r#"{"capabilities":["completion","tools","thinking"]}"#,
        ]);
        let found = pulled(Some(&host)).unwrap();
        assert_eq!(
            found,
            vec![
                Pulled {
                    name: "gemma4:31b".into(),
                    size: 19000
                },
                Pulled {
                    name: "tiny:1b".into(),
                    size: 800
                }
            ]
        );
    }

    #[test]
    fn says_when_ollama_isnt_running() {
        let free = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        assert_eq!(
            pulled(Some(&format!("127.0.0.1:{free}"))).unwrap_err(),
            "Ollama isn't running on this computer."
        );
    }
}
