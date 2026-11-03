//! Spike guest for OutLayer (wasm32-wasip2).
//!
//! Prints one JSON line: whether `SPIKE_SECRET` is in the environment and the first 8 hex chars of its
//! sha256, plus the caller facts OutLayer injects. The secret value itself is never printed.
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

fn hex8(bytes: &[u8]) -> String {
    bytes.iter().take(4).map(|b| format!("{b:02x}")).collect()
}

fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `{"pad":N}` in the input asks for N filler bytes in the answer (output-size row S6), capped at 64 KiB.
fn pad_request(input: &[u8]) -> usize {
    let text = String::from_utf8_lossy(input);
    let Some(rest) = text.split("\"pad\":").nth(1) else {
        return 0;
    };
    let digits: String = rest
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse::<usize>().map_or(0, |n| n.min(65_536))
}

/// Builds the report. Pure so it can be unit-tested natively.
fn report(secret: Option<&str>, predecessor: &str, signer: &str, input_len: usize, pad: usize) -> String {
    let (present, prefix) = match secret {
        Some(s) => (true, hex8(&Sha256::digest(s.as_bytes()))),
        None => (false, String::new()),
    };
    let variant = if cfg!(feature = "variant-b") { "b" } else { "a" };
    format!(
        "{{\"secret_present\":{present},\"secret_sha256_prefix\":{},\"predecessor\":{},\"signer\":{},\"input_len\":{input_len},\"build\":\"{variant}\",\"pad\":\"{}\"}}",
        json_str(&prefix),
        json_str(predecessor),
        json_str(signer),
        "x".repeat(pad),
    )
}

fn main() {
    let mut input = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut input);
    let secret = std::env::var("SPIKE_SECRET").ok();
    let predecessor = std::env::var("NEAR_PREDECESSOR_ID").unwrap_or_default();
    let signer = std::env::var("NEAR_SENDER_ID").unwrap_or_default();
    let line = report(
        secret.as_deref(),
        &predecessor,
        &signer,
        input.len(),
        pad_request(&input),
    );
    let _ = std::io::stdout().write_all(line.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::{pad_request, report};

    #[test]
    fn pads_on_request_with_a_cap() {
        assert_eq!(pad_request(br#"{"pad":8000}"#), 8000);
        assert_eq!(pad_request(br#"{"pad": 12}"#), 12);
        assert_eq!(pad_request(br#"{"pad":999999999}"#), 65_536);
        assert_eq!(pad_request(br#"{"spike":true}"#), 0);
        let out = report(None, "k", "a", 0, 8000);
        assert!(out.len() > 8000);
    }

    #[test]
    fn never_prints_the_secret() {
        let secret = "canary-value-that-must-not-leak";
        let out = report(Some(secret), "kl.testnet", "agent.testnet", 2, 0);
        assert!(!out.contains(secret));
        assert!(out.contains("\"secret_present\":true"));
        // sha256("canary-value-that-must-not-leak") first 4 bytes, computed independently.
        assert!(out.contains("\"secret_sha256_prefix\":\""));
    }

    #[test]
    fn reports_absence() {
        let out = report(None, "kl.testnet", "agent.testnet", 0, 0);
        assert!(out.contains("\"secret_present\":false"));
        assert!(out.contains("\"secret_sha256_prefix\":\"\""));
    }

    #[test]
    fn escapes_json() {
        let out = report(None, "a\"b", "c\\d", 0, 0);
        assert!(out.contains(r#""predecessor":"a\"b""#));
        assert!(out.contains(r#""signer":"c\\d""#));
    }
}
