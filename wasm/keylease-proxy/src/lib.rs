//! KeyLease proxy core. Pure and native-testable; `main.rs` only adds the WASI HTTP call.
//!
//! The proxy is the only code that sees the key (env `KL_API_KEY`, opened by OutLayer for the pinned build
//! and the KeyLease contract). It re-checks what it is asked to call, calls exactly `base_url + endpoint`
//! with fixed headers, and never returns the key: a response that carries it in any form we know is
//! withheld as `tripwire`; other bearer-like tokens are redacted.
use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use base64::Engine as _;
use keylease_reasons::Refusal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Input format version.
pub const INPUT_VERSION: u32 = 1;
/// Largest request body passed upstream.
pub const MAX_BODY: usize = 64 * 1024;
/// Largest upstream response accepted.
pub const MAX_RESPONSE: usize = 256 * 1024;
/// Env var OutLayer fills from the owner's sealed secret.
pub const KEY_ENV: &str = "KL_API_KEY";

/// What the contract asks the proxy to do. The agent chose only `endpoint`, `method` and `body`;
/// the contract filled in the rest from the key and lease records.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    /// Must be [`INPUT_VERSION`].
    pub v: u32,
    /// Lease the call is made under (for the receipt).
    pub lease_id: String,
    /// API kind: decides the auth header.
    pub provider: Provider,
    /// The key's base URL (from the key record).
    pub base_url: String,
    /// The lease's endpoints (from the lease record).
    pub allowed: Vec<String>,
    /// Endpoint the agent asked for.
    pub endpoint: String,
    /// HTTP method.
    pub method: Method,
    /// Request body (JSON text for POST).
    #[serde(default)]
    pub body: Option<String>,
}

/// API kind (same names as the contract's `Provider`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[allow(missing_docs)]
pub enum Provider {
    NearAiCloud,
    OpenAiCompatible,
    AnthropicCompatible,
    Custom,
}

/// Allowed HTTP methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
#[allow(missing_docs)]
pub enum Method {
    Get,
    Post,
}

/// One upstream request. Holds the key in a header: no `Debug`, never logged.
pub struct Plan {
    /// `base_url + endpoint`.
    pub url: String,
    /// HTTP method.
    pub method: Method,
    /// Fixed header set; the agent cannot add headers.
    pub headers: Vec<(&'static str, String)>,
    /// Request body.
    pub body: Vec<u8>,
}

/// Why a call did not produce an answer.
#[derive(Debug, PartialEq, Eq)]
pub enum Fail {
    /// Malformed input from the contract.
    BadInput(&'static str),
    /// A lease rule, re-checked here.
    Refused(Refusal),
    /// Request body over [`MAX_BODY`].
    BodyTooLarge,
    /// The secret did not reach the proxy.
    NoKey,
    /// The upstream call failed.
    Upstream,
    /// Upstream response over [`MAX_RESPONSE`].
    ResponseTooLarge,
}

impl Fail {
    /// Stable machine code.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Fail::BadInput(_) => "bad_input",
            Fail::Refused(r) => r.code(),
            Fail::BodyTooLarge => "body_too_large",
            Fail::NoKey => "key_unavailable",
            Fail::Upstream => "upstream_error",
            Fail::ResponseTooLarge => "response_too_large",
        }
    }

    /// One sentence on what to do.
    #[must_use]
    pub fn hint(&self) -> &'static str {
        match self {
            Fail::BadInput(why) => why,
            Fail::Refused(r) => r.hint(),
            Fail::BodyTooLarge => "The request body is over 64 KB; send a smaller request.",
            Fail::NoKey => {
                "The sealed key could not be opened for this run; the key owner should check its lock."
            }
            Fail::Upstream => "The API could not be reached or did not answer in time; try again later.",
            Fail::ResponseTooLarge => "The API answer is over 256 KB; ask for a smaller answer.",
        }
    }
}

/// The proxy's answer, printed as one JSON object.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Output {
    /// The call ran.
    Ok {
        /// Format version.
        v: u32,
        /// Always true.
        ok: bool,
        /// Upstream HTTP status.
        status: u16,
        /// Upstream body, scrubbed; base64 when not UTF-8.
        body: String,
        /// `utf8` or `base64`.
        body_encoding: &'static str,
        /// sha256 (hex) of the returned body bytes.
        body_sha256: String,
        /// True when a bearer-like token was redacted.
        redacted: bool,
    },
    /// The call did not run, or its answer was withheld.
    Err {
        /// Format version.
        v: u32,
        /// Always false.
        ok: bool,
        /// Stable code.
        error: &'static str,
        /// What to do.
        hint: &'static str,
    },
}

impl Output {
    fn fail(code: &'static str, hint: &'static str) -> Self {
        Output::Err {
            v: INPUT_VERSION,
            ok: false,
            error: code,
            hint,
        }
    }
}

impl From<Fail> for Output {
    fn from(f: Fail) -> Self {
        Output::fail(f.code(), f.hint())
    }
}

/// Check the input and build the one request the proxy will send.
///
/// # Errors
/// [`Fail`] when the input is malformed, breaks a lease rule, is too large, or the key is missing.
pub fn plan(input: &Input, key: &str) -> Result<Plan, Fail> {
    if input.v != INPUT_VERSION {
        return Err(Fail::BadInput(
            "Unsupported input version; the contract and proxy builds do not match.",
        ));
    }
    keylease_rules::base_url(&input.base_url)
        .map_err(|_| Fail::BadInput("The key's base URL is not valid."))?;
    keylease_rules::endpoints(&input.allowed)
        .map_err(|_| Fail::BadInput("The lease's endpoint list is not valid."))?;
    if keylease_rules::endpoint(&input.endpoint).is_err() || !input.allowed.contains(&input.endpoint) {
        return Err(Fail::Refused(Refusal::EndpointNotInLease));
    }
    let body = input.body.as_deref().unwrap_or_default().as_bytes().to_vec();
    if body.len() > MAX_BODY {
        return Err(Fail::BodyTooLarge);
    }
    if input.method == Method::Get && !body.is_empty() {
        return Err(Fail::BadInput("A GET request cannot carry a body."));
    }
    if key.trim().is_empty() {
        return Err(Fail::NoKey);
    }
    let mut headers = vec![("accept", "application/json".to_owned())];
    if input.method == Method::Post {
        headers.push(("content-type", "application/json".to_owned()));
    }
    match input.provider {
        Provider::AnthropicCompatible => {
            headers.push(("x-api-key", key.to_owned()));
            headers.push(("anthropic-version", "2023-06-01".to_owned()));
        }
        Provider::NearAiCloud | Provider::OpenAiCompatible | Provider::Custom => {
            headers.push(("authorization", format!("Bearer {key}")));
        }
    }
    Ok(Plan {
        url: format!("{}{}", input.base_url, input.endpoint),
        method: input.method,
        headers,
        body,
    })
}

/// The key in every form we look for: raw, hex (both cases), and base64 / base64url at each of the three
/// byte alignments (only the characters that depend on the key alone).
#[must_use]
pub fn key_forms(key: &str) -> Vec<Vec<u8>> {
    let k = key.as_bytes();
    let mut forms = vec![
        k.to_vec(),
        hex(k).into_bytes(),
        hex(k).to_uppercase().into_bytes(),
    ];
    for align in 0..3usize {
        let mut shifted = vec![0u8; align];
        shifted.extend_from_slice(k);
        for engine in [&STANDARD, &URL_SAFE] {
            let enc = engine.encode(&shifted);
            let start = align.div_ceil(3) * 4;
            let end = (shifted.len() / 3) * 4;
            if end > start && end - start >= 16 {
                forms.push(enc.as_bytes()[start..end].to_vec());
            }
        }
    }
    forms.sort();
    forms.dedup();
    forms
}

/// True when `data` carries the key in any form from [`key_forms`].
#[must_use]
pub fn carries_key(data: &[u8], key: &str) -> bool {
    !key.is_empty() && key_forms(key).iter().any(|f| contains(data, f))
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && hay.windows(needle.len()).any(|w| w == needle)
}

fn hex(b: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(b.len() * 2);
    for x in b {
        out.push(char::from(DIGITS[usize::from(x >> 4)]));
        out.push(char::from(DIGITS[usize::from(x & 0xf)]));
    }
    out
}

const REDACTED: &[u8] = b"[redacted]";

fn token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"-_.~+/=".contains(&b)
}

/// Redact other bearer-like tokens: `sk-…` (20+ chars) and `Bearer …` (20+ chars). Returns the new body
/// and whether anything changed.
#[must_use]
pub fn redact_tokens(data: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::with_capacity(data.len());
    let mut changed = false;
    let mut i = 0;
    while i < data.len() {
        let rest = &data[i..];
        let prefix_len = if rest.starts_with(b"sk-") && (i == 0 || !token_char(data[i - 1])) {
            Some(3)
        } else if rest.len() > 7 && rest[..7].eq_ignore_ascii_case(b"bearer ") {
            Some(7)
        } else {
            None
        };
        if let Some(p) = prefix_len {
            let tok = rest[p..].iter().take_while(|b| token_char(**b)).count();
            if tok >= 20 {
                out.extend_from_slice(&rest[..p]);
                out.extend_from_slice(REDACTED);
                i += p + tok;
                changed = true;
                continue;
            }
        }
        out.push(data[i]);
        i += 1;
    }
    (out, changed)
}

/// Turn the upstream answer into the proxy's output.
///
/// # Errors
/// [`Fail::ResponseTooLarge`] over the limit; a `tripwire` refusal when the answer carries the key.
pub fn finish(status: u16, raw: &[u8], key: &str) -> Result<Output, Fail> {
    if raw.len() > MAX_RESPONSE {
        return Err(Fail::ResponseTooLarge);
    }
    if carries_key(raw, key) {
        return Err(Fail::Refused(Refusal::Tripwire));
    }
    let (clean, redacted) = redact_tokens(raw);
    let body_sha256 = hex(&Sha256::digest(&clean));
    let (body, body_encoding) = match String::from_utf8(clean) {
        Ok(s) => (s, "utf8"),
        Err(e) => (STANDARD.encode(e.as_bytes()), "base64"),
    };
    Ok(Output::Ok {
        v: INPUT_VERSION,
        ok: true,
        status,
        body,
        body_encoding,
        body_sha256,
        redacted,
    })
}

/// The whole run: parse, plan, send (injected), finish. The returned JSON never carries the key: it is
/// checked once more at the end, and withheld as `tripwire` if it would.
pub fn handle(input: &[u8], key: &str, send: impl FnOnce(&Plan) -> Result<(u16, Vec<u8>), Fail>) -> String {
    let out = match serde_json::from_slice::<Input>(input) {
        Err(_) => Output::from(Fail::BadInput("The input is not the expected JSON.")),
        Ok(input) => match plan(&input, key)
            .and_then(|p| send(&p))
            .and_then(|(s, b)| finish(s, &b, key))
        {
            Ok(o) => o,
            Err(f) => Output::from(f),
        },
    };
    let text = serde_json::to_string(&out).unwrap_or_default();
    if carries_key(text.as_bytes(), key) {
        return serde_json::to_string(&Output::from(Fail::Refused(Refusal::Tripwire))).unwrap_or_default();
    }
    text
}

#[cfg(test)]
mod tests;
