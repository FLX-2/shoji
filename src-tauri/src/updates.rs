//! Shoji updating itself from its GitHub releases.
//!
//! Each release carries `latest.json`, which names the newest version and, per system, the installer and its
//! signature. The updater checks the signature against the public key in tauri.conf.json before installing, so
//! only a build signed with the project's private key can replace this one. With no public key set, there is
//! nothing to check against, and Shoji never looks for updates.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Available {
    /// The new version, such as "0.1.1".
    pub version: String,
    /// The release's notes, as written on GitHub.
    pub notes: Option<String>,
}

/// The public key the updater checks signatures with, from tauri.conf.json, when one is set.
fn pubkey<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(String::from)
}

/// Updates are on only when the build carries a public key, since without one no download could be trusted.
pub fn enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    pubkey(app).is_some()
}

/// Asks GitHub whether a newer release exists. Nothing about the person or their work is sent: the request is
/// for the release's `latest.json`, with the app's version and system in its user agent.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<Available>, String> {
    if !enabled(&app) {
        return Ok(None);
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(update) => Ok(update.map(|u| Available {
            version: u.version,
            notes: u.body,
        })),
        // No release yet, or one without updates for this system, reads the same as no update.
        Err(e) => {
            eprintln!("update check: {e}");
            Ok(None)
        }
    }
}

/// Downloads the newer release, checks its signature, installs it and opens the new Shoji. On Windows the
/// installer closes Shoji itself.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if !enabled(&app) {
        return Err("This build of Shoji can't update itself.".into());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|_| {
            "Shoji couldn't reach GitHub to update. Check your internet connection, then try again."
                .to_string()
        })?
        .ok_or_else(|| "There's no newer Shoji to install.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Shoji couldn't install the update: {e}"))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    /// The updater plugin reads its settings when Shoji starts, and settings it can't read stop Shoji opening.
    #[test]
    fn the_updater_settings_can_be_read() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = conf["plugins"]["updater"].clone();
        let config: tauri_plugin_updater::Config = serde_json::from_value(updater).unwrap();
        assert_eq!(
            config
                .endpoints
                .iter()
                .map(|u| u.as_str())
                .collect::<Vec<_>>(),
            ["https://github.com/FLX-2/shoji/releases/latest/download/latest.json"]
        );
    }
}
