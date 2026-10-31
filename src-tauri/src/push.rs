//! Pushing a committed thread's branch, which only the person's button does, and finding the page
//! where they open a pull request for it.

use std::process::Command;

use serde::Serialize;

use super::git;

#[derive(Serialize, Debug, PartialEq)]
pub struct Pushed {
    /// The remote the branch went to, such as "origin".
    pub remote: String,
    /// The page that opens a pull request for the branch, when the host is one Shoji knows or it named one.
    pub url: Option<String>,
}

/// The remote to push to: origin, or else the only one there is.
fn remote(repo: &str) -> Result<String, String> {
    let remotes: Vec<String> = git(repo, &["remote"])?.lines().map(str::to_string).collect();
    if remotes.iter().any(|r| r == "origin") {
        return Ok("origin".into());
    }
    match remotes.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err("The project has no remote to push to. Add one with git remote add, then push again.".into()),
        _ => Err(format!("The project has several remotes and none is called origin: {}.", remotes.join(", "))),
    }
}

/// A page the host printed while taking the push, such as GitHub's "Create a pull request … by visiting".
fn printed_url(said: &str) -> Option<String> {
    said.lines()
        .filter_map(|line| line.strip_prefix("remote:"))
        .filter_map(|line| line.split_whitespace().find(|word| word.starts_with("https://")))
        .find(|url| url.contains("pull") || url.contains("merge_request"))
        .map(str::to_string)
}

/// The host and path of a remote's address, from its https, ssh or scp-like form.
fn host_and_path(address: &str) -> Option<(String, String)> {
    let address = address.trim().trim_end_matches('/').trim_end_matches(".git");
    let rest = if let Some(rest) = address.split_once("://").map(|(_, rest)| rest) {
        rest.to_string()
    } else {
        // user@host:owner/repo
        let (host, path) = address.split_once(':')?;
        format!("{host}/{path}")
    };
    let rest = rest.rsplit_once('@').map_or(rest.as_str(), |(_, after)| after);
    let (host, path) = rest.split_once('/')?;
    let host = host.split(':').next()?;
    (!host.is_empty() && path.contains('/')).then(|| (host.to_string(), path.to_string()))
}

/// The page that opens a pull request for a branch on GitHub, GitLab or Bitbucket.
fn new_pull_request(address: &str, branch: &str) -> Option<String> {
    let (host, path) = host_and_path(address)?;
    if host.contains("github") {
        Some(format!("https://{host}/{path}/compare/{branch}?expand=1"))
    } else if host.contains("gitlab") {
        Some(format!("https://{host}/{path}/-/merge_requests/new?merge_request%5Bsource_branch%5D={branch}"))
    } else if host.contains("bitbucket") {
        Some(format!("https://{host}/{path}/pull-requests/new?source={branch}"))
    } else {
        None
    }
}

/// Pushes the branch to the project's remote with the person's own git sign-in, and finds the pull request page.
pub fn push(repo: &str, branch: &str) -> Result<Pushed, String> {
    let remote = remote(repo)?;
    let mut command = Command::new("git");
    command
        .args(["push", "--set-upstream", &remote, branch])
        .current_dir(repo)
        // A sign-in git would ask for in a terminal fails instead, rather than waiting for one that isn't there.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("SHOJI_API_KEY");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let out = command.output().map_err(|e| format!("Couldn't run git: {e}"))?;
    let said = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(said.trim().to_string());
    }
    let address = git(repo, &["remote", "get-url", &remote]).unwrap_or_default();
    let url = printed_url(&said).or_else(|| new_pull_request(&address, branch));
    Ok(Pushed { remote, url })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_the_pull_request_page_for_each_host() {
        let page = |address: &str| new_pull_request(address, "shoji/add-a-faq");
        assert_eq!(
            page("git@github.com:FLX-2/shoji.git").as_deref(),
            Some("https://github.com/FLX-2/shoji/compare/shoji/add-a-faq?expand=1")
        );
        assert_eq!(
            page("https://bob@github.com/FLX-2/shoji").as_deref(),
            Some("https://github.com/FLX-2/shoji/compare/shoji/add-a-faq?expand=1")
        );
        assert_eq!(
            page("ssh://git@gitlab.com:2222/team/app.git").as_deref(),
            Some("https://gitlab.com/team/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=shoji/add-a-faq")
        );
        assert_eq!(
            page("https://bitbucket.org/team/app.git").as_deref(),
            Some("https://bitbucket.org/team/app/pull-requests/new?source=shoji/add-a-faq")
        );
        assert_eq!(page("/srv/git/app.git"), None);
        assert_eq!(page("https://git.example.com/team/app.git"), None);
    }

    #[test]
    fn takes_the_page_the_host_prints() {
        let said = "remote: \nremote: Create a pull request for 'shoji/x' on GitHub by visiting:\nremote:      https://github.com/a/b/pull/new/shoji/x        \nremote: \n";
        assert_eq!(printed_url(said).as_deref(), Some("https://github.com/a/b/pull/new/shoji/x"));
        assert_eq!(printed_url("To github.com:a/b.git\n * [new branch] x -> x\n"), None);
    }

    #[test]
    fn pushes_the_branch_and_sets_its_upstream() {
        let dir = std::env::temp_dir().join(format!("shoji-push-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let (repo, bare) = (dir.join("app"), dir.join("remote.git"));
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("a.txt"), "a\n").unwrap();
        let root = repo.display().to_string();
        git(&dir.display().to_string(), &["init", "--quiet", "--bare", &bare.display().to_string()]).unwrap();
        assert!(push(&root, "main").is_err());
        for args in [
            &["init", "--quiet", "-b", "main"][..],
            &["-c", "user.email=t@t", "-c", "user.name=t", "add", "."],
            &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--quiet", "-m", "start"],
            &["branch", "shoji/add-a-faq"],
        ] {
            git(&root, args).unwrap();
        }
        assert!(push(&root, "shoji/add-a-faq").unwrap_err().contains("no remote"));
        git(&root, &["remote", "add", "origin", &bare.display().to_string()]).unwrap();

        let pushed = push(&root, "shoji/add-a-faq").unwrap();
        assert_eq!(pushed, Pushed { remote: "origin".into(), url: None });
        let bare = bare.display().to_string();
        assert!(git(&bare, &["rev-parse", "--verify", "--quiet", "refs/heads/shoji/add-a-faq"]).is_ok());
        assert_eq!(git(&root, &["config", "branch.shoji/add-a-faq.remote"]).unwrap().trim(), "origin");
    }
}
