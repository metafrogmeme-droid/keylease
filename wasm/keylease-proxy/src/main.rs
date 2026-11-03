//! KeyLease proxy entry point (wasm32-wasip2 in an OutLayer TEE). Reads the input from stdin and the key
//! from `KL_API_KEY`, prints one JSON object. All rules live in the library and are tested natively.
use keylease_proxy::{handle, Fail, Plan, KEY_ENV};
use std::io::{Read, Write};

fn main() {
    let mut input = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut input);
    let key = std::env::var(KEY_ENV).unwrap_or_default();
    let out = handle(&input, &key, send);
    let _ = std::io::stdout().write_all(out.as_bytes());
}

/// One HTTPS call through WASI HTTP. Reads at most `MAX_RESPONSE + 1` bytes, so an oversized answer is
/// refused without being held in full. Run time is bounded by OutLayer's `max_execution_seconds`.
#[cfg(target_os = "wasi")]
fn send(plan: &Plan) -> Result<(u16, Vec<u8>), Fail> {
    use keylease_proxy::{Method, MAX_RESPONSE};
    use std::time::Duration;
    let client = wasi_http_client::Client::new();
    let mut req = match plan.method {
        Method::Get => client.get(&plan.url),
        Method::Post => client.post(&plan.url).body(&plan.body),
    };
    for (name, value) in &plan.headers {
        req = req.header(*name, value.as_str());
    }
    let resp = req
        .connect_timeout(Duration::from_secs(10))
        .send()
        .map_err(|_| Fail::Upstream)?;
    let status = resp.status();
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk(16 * 1024).map_err(|_| Fail::Upstream)? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_RESPONSE {
            return Err(Fail::ResponseTooLarge);
        }
    }
    Ok((status, body))
}

/// Native builds (tests, clippy) have no network: the proxy only calls out inside the enclave build.
#[cfg(not(target_os = "wasi"))]
fn send(_plan: &Plan) -> Result<(u16, Vec<u8>), Fail> {
    Err(Fail::Upstream)
}
