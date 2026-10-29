//! Desktop shell for the agent-kit dashboard. It holds no keys and exposes no
//! commands: remote pages get no IPC. Pop-ups (the dashboard's "Open in browser
//! to sign") go to the system browser, where the user's wallet extension lives.
use url::Url;

/// What to do with a `window.open` request from the page.
#[derive(Debug, PartialEq, Eq)]
pub enum Popup {
    /// Hand to the system browser.
    External(String),
    /// Drop it.
    Ignore,
}

pub fn route_popup(url: &Url) -> Popup {
    match url.scheme() {
        "https" | "http" => Popup::External(url.to_string()),
        _ => Popup::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn web_urls_go_to_the_browser() {
        let u = Url::parse("https://agents.example.com/?tab=mint").unwrap();
        assert_eq!(route_popup(&u), Popup::External("https://agents.example.com/?tab=mint".into()));
    }
    #[test]
    fn other_schemes_are_dropped() {
        for s in ["file:///etc/passwd", "javascript:alert(1)", "tauri://localhost/x", "solana:abc"] {
            assert_eq!(route_popup(&Url::parse(s).unwrap()), Popup::Ignore, "{s}");
        }
    }
}
