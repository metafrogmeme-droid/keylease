//! Input rules for keys and leases. Pure functions, unit-tested; the contract panics with the message.

/// Most endpoints one lease may list.
pub const MAX_ENDPOINTS: usize = 16;
/// Longest endpoint path.
pub const MAX_ENDPOINT_LEN: usize = 128;
/// Longest base URL.
pub const MAX_BASE_URL_LEN: usize = 200;
/// Longest key label.
pub const MAX_LABEL_LEN: usize = 64;
/// Most calls one lease may grant.
pub const MAX_CALLS: u32 = 1_000_000;
/// Longest lease: 365 days in nanoseconds.
pub const MAX_LEASE_NS: u64 = 365 * 24 * 60 * 60 * 1_000_000_000;

/// The provider base URL: `https://host[:port][/prefix]`, no user info, query, fragment or dot segments.
pub fn base_url(url: &str) -> Result<(), &'static str> {
    let rest = url
        .strip_prefix("https://")
        .ok_or("base_url must start with https://")?;
    if url.len() > MAX_BASE_URL_LEN {
        return Err("base_url is too long");
    }
    let host = rest.split('/').next().unwrap_or_default();
    if host.is_empty() {
        return Err("base_url has no host");
    }
    if !host
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-.:".contains(&b))
    {
        return Err("base_url host must be lowercase letters, digits, '-', '.', ':'");
    }
    if url.ends_with('/') {
        return Err("base_url must not end with '/'");
    }
    path_chars(&rest[host.len()..]).map_err(|()| "base_url path has a forbidden character or segment")
}

/// One endpoint: an exact path such as `/v1/chat/completions`.
pub fn endpoint(path: &str) -> Result<(), &'static str> {
    if !path.starts_with('/') {
        return Err("endpoint must start with '/'");
    }
    if path.len() > MAX_ENDPOINT_LEN {
        return Err("endpoint is too long");
    }
    path_chars(path).map_err(|()| "endpoint has a forbidden character or segment")
}

/// Shared path rule: ASCII letters, digits and `-._~/`; no empty, `.` or `..` segment after the first `/`.
fn path_chars(path: &str) -> Result<(), ()> {
    if path.is_empty() {
        return Ok(());
    }
    let ok_bytes = path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"-._~/".contains(&b));
    let ok_segments = path
        .split('/')
        .skip(1)
        .all(|s| !s.is_empty() && s != "." && s != "..");
    if ok_bytes && ok_segments {
        Ok(())
    } else {
        Err(())
    }
}

/// The endpoint list of a lease: 1..=16 valid, distinct paths.
pub fn endpoints(list: &[String]) -> Result<(), &'static str> {
    if list.is_empty() {
        return Err("a lease needs at least one endpoint");
    }
    if list.len() > MAX_ENDPOINTS {
        return Err("too many endpoints in one lease");
    }
    for (i, e) in list.iter().enumerate() {
        endpoint(e)?;
        if list[..i].contains(e) {
            return Err("endpoint listed twice");
        }
    }
    Ok(())
}

/// Call quota: 1..=1,000,000.
pub fn calls(n: u32) -> Result<(), &'static str> {
    if n == 0 || n > MAX_CALLS {
        Err("calls must be between 1 and 1000000")
    } else {
        Ok(())
    }
}

/// Expiry: in the future and at most 365 days away.
pub fn expiry(expires_at_ns: u64, now_ns: u64) -> Result<(), &'static str> {
    if expires_at_ns <= now_ns {
        return Err("expiry must be in the future");
    }
    if expires_at_ns - now_ns > MAX_LEASE_NS {
        return Err("expiry must be at most 365 days away");
    }
    Ok(())
}

/// Labels and profile names: 1..=64 printable ASCII characters.
pub fn label(s: &str) -> Result<(), &'static str> {
    if s.is_empty() || s.len() > MAX_LABEL_LEN || !s.bytes().all(|b| (0x20..0x7f).contains(&b)) {
        Err("label must be 1-64 printable ASCII characters")
    } else {
        Ok(())
    }
}

/// OutLayer secret profile: 1-64 bytes of letters, digits, `-` or `_` (OutLayer's own rule).
pub fn profile(s: &str) -> Result<(), &'static str> {
    if s.is_empty()
        || s.len() > 64
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Err("secret_profile must be 1-64 letters, digits, '-' or '_'")
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn base_urls() {
        for ok in [
            "https://api.openai.com",
            "https://cloud-api.near.ai/v1",
            "https://localhost:8443",
        ] {
            assert_eq!(base_url(ok), Ok(()), "{ok}");
        }
        for bad in [
            "http://api.openai.com",
            "https://",
            "https://API.example.com",
            "https://user@evil.example",
            "https://a.example/",
            "https://a.example/v1?x=1",
            "https://a.example/v1/../admin",
            "https://a.example//v1",
            "https://a.example/v1#frag",
        ] {
            assert!(base_url(bad).is_err(), "{bad}");
        }
        assert!(base_url(&format!("https://{}.example", "a".repeat(200))).is_err());
    }

    #[test]
    fn endpoint_paths() {
        for ok in ["/v1/chat/completions", "/echo", "/v1/models"] {
            assert_eq!(endpoint(ok), Ok(()), "{ok}");
        }
        for bad in [
            "v1/chat",
            "/",
            "/v1/",
            "/v1//chat",
            "/v1/../keys",
            "/./x",
            "/v1?q=1",
            "/v1 x",
            "/v1/%2e%2e",
        ] {
            assert!(endpoint(bad).is_err(), "{bad}");
        }
        assert!(endpoint(&format!("/{}", "a".repeat(MAX_ENDPOINT_LEN))).is_err());
    }

    #[test]
    fn endpoint_lists() {
        assert_eq!(endpoints(&v(&["/a", "/b"])), Ok(()));
        assert!(endpoints(&[]).is_err());
        assert!(endpoints(&v(&["/a", "/a"])).is_err());
        let many: Vec<String> = (0..=MAX_ENDPOINTS).map(|i| format!("/e{i}")).collect();
        assert!(endpoints(&many).is_err());
        assert_eq!(endpoints(&many[..MAX_ENDPOINTS]), Ok(()));
    }

    #[test]
    fn quotas_and_expiry() {
        assert!(calls(0).is_err());
        assert_eq!(calls(1), Ok(()));
        assert_eq!(calls(MAX_CALLS), Ok(()));
        assert!(calls(MAX_CALLS + 1).is_err());
        assert!(expiry(10, 10).is_err());
        assert_eq!(expiry(11, 10), Ok(()));
        assert_eq!(expiry(10 + MAX_LEASE_NS, 10), Ok(()));
        assert!(expiry(11 + MAX_LEASE_NS, 10).is_err());
    }

    #[test]
    fn labels_and_profiles() {
        assert_eq!(label("My agent key"), Ok(()));
        assert!(label("").is_err());
        assert!(label("tab\there").is_err());
        assert!(label(&"x".repeat(65)).is_err());
        assert_eq!(profile("openai_main-1"), Ok(()));
        assert!(profile("has space").is_err());
        assert!(profile("").is_err());
    }
}
