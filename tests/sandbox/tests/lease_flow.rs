//! End to end in a local NEAR sandbox: KeyLease contract + mock OutLayer.
//! Needs both wasm files built first (`scripts/build-contracts.sh`); the paths can be overridden with
//! `KEYLEASE_WASM` and `MOCK_OUTLAYER_WASM`.
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const PROXY_HASH: &str = "95385bd10e778f8f1488a266abaa79c455347f6404f53140b3bde8755a4cd970";

fn wasm(env_var: &str, default: &str) -> anyhow::Result<Vec<u8>> {
    let path =
        std::env::var(env_var).unwrap_or_else(|_| format!("{}/../../{default}", env!("CARGO_MANIFEST_DIR")));
    std::fs::read(&path).map_err(|e| anyhow::anyhow!("{path}: {e}; run scripts/build-contracts.sh first"))
}

struct World {
    kl: Contract,
    mock: Contract,
    alice: Account,
    bob: Account,
    mallory: Account,
}

async fn world() -> anyhow::Result<World> {
    let sandbox = near_workspaces::sandbox().await?;
    let mock = sandbox
        .dev_deploy(&wasm(
            "MOCK_OUTLAYER_WASM",
            "target/near/mock_outlayer/mock_outlayer.wasm",
        )?)
        .await?;
    let kl = sandbox
        .dev_deploy(&wasm(
            "KEYLEASE_WASM",
            "target/near/keylease_contract/keylease_contract.wasm",
        )?)
        .await?;
    kl.call("new")
        .args_json(json!({
            "admin": kl.id(),
            "outlayer": mock.id(),
            "proxy_url": format!("https://test.fastfs.io/kl.testnet/outlayer.testnet/{PROXY_HASH}.wasm"),
            "proxy_hash": PROXY_HASH,
        }))
        .transact()
        .await?
        .into_result()?;
    let alice = sandbox.dev_create_account().await?;
    let bob = sandbox.dev_create_account().await?;
    let mallory = sandbox.dev_create_account().await?;
    Ok(World {
        kl,
        mock,
        alice,
        bob,
        mallory,
    })
}

/// alice registers a key and leases `calls` calls on `endpoints` to bob for one hour.
async fn lease(w: &World, endpoints: &[&str], calls: u32) -> anyhow::Result<String> {
    let key: String = w
        .alice
        .call(w.kl.id(), "add_key")
        .args_json(
            json!({ "provider": "NearAiCloud", "base_url": "https://cloud-api.near.ai",
                           "secret_profile": "main", "label": "demo" }),
        )
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    let now_ns = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos(),
    )?;
    let lease: String = w
        .alice
        .call(w.kl.id(), "create_lease")
        .args_json(json!({ "key_id": key, "grantee": w.bob.id(), "calls": calls,
                           "expires_at": (now_ns + 3_600_000_000_000).to_string(), "endpoints": endpoints }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    Ok(lease)
}

/// One leased call. Ok(answer) or Err(failure text).
async fn use_lease(
    w: &World,
    who: &Account,
    lease: &str,
    endpoint: &str,
) -> anyhow::Result<Result<Value, String>> {
    let out = who
        .call(w.kl.id(), "use_lease")
        .args_json(json!({ "lease_id": lease, "endpoint": endpoint, "body": "{\"q\":\"hello\"}" }))
        .deposit(NearToken::from_millinear(30))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    Ok(match out.into_result() {
        Ok(ok) => Ok(ok.json()?),
        Err(e) => Err(format!("{e:?}")),
    })
}

async fn receipt(w: &World, lease: &str, call: u32) -> anyhow::Result<Value> {
    Ok(w.kl
        .view("get_receipt")
        .args_json(json!({ "lease_id": lease, "call": call }))
        .await?
        .json()?)
}

#[tokio::test]
async fn full_lease_flow_against_mock_outlayer() -> anyhow::Result<()> {
    let w = world().await?;
    let id = lease(&w, &["/v1/chat", "/tripwire", "/fail"], 4).await?;

    // 1. The grantee's call goes out and its answer comes back.
    let answer = use_lease(&w, &w.bob, &id, "/v1/chat")
        .await?
        .map_err(anyhow::Error::msg)?;
    assert_eq!(answer["ok"], true);
    assert_eq!(answer["body"], "echo {\"q\":\"hello\"}");
    let r = receipt(&w, &id, 1).await?;
    assert_eq!(
        (r["outcome"].as_str(), r["http_status"].as_u64()),
        (Some("ok"), Some(200))
    );

    // 2. OutLayer was asked for the pinned proxy, with alice's row, by the contract, refunds to bob.
    let sent: Vec<String> = w.mock.view("requests").await?.json()?;
    let req: Value = serde_json::from_str(&sent[0])?;
    assert_eq!(
        req["predecessor"],
        w.kl.id().as_str(),
        "the lock's Predecessor is the KeyLease contract"
    );
    assert_eq!(req["signer"], w.bob.id().as_str());
    assert_eq!(
        req["secrets_ref"],
        json!({ "profile": "main", "account_id": w.alice.id() })
    );
    assert_eq!(req["source"]["WasmUrl"]["hash"], PROXY_HASH);
    assert_eq!(req["payer_account_id"], w.bob.id().as_str());
    assert_eq!(req["input"]["allowed"], json!(["/v1/chat", "/tripwire", "/fail"]));

    // 3. A tripwire answer and a failed run are receipted; both use their call.
    use_lease(&w, &w.bob, &id, "/tripwire")
        .await?
        .map_err(anyhow::Error::msg)?;
    assert_eq!(receipt(&w, &id, 2).await?["outcome"], "tripwire");
    assert_eq!(
        use_lease(&w, &w.bob, &id, "/fail")
            .await?
            .map_err(anyhow::Error::msg)?,
        Value::Null
    );
    assert_eq!(receipt(&w, &id, 3).await?["outcome"], "failed");

    // 4. Refusals: a stranger, an endpoint outside the lease. Nothing reaches OutLayer.
    let stranger = use_lease(&w, &w.mallory, &id, "/v1/chat")
        .await?
        .err()
        .unwrap_or_default();
    assert!(stranger.contains("not_lease_holder"), "{stranger}");
    let outside = use_lease(&w, &w.bob, &id, "/v1/keys")
        .await?
        .err()
        .unwrap_or_default();
    assert!(outside.contains("endpoint_not_in_lease"), "{outside}");
    let sent: Vec<String> = w.mock.view("requests").await?.json()?;
    assert_eq!(sent.len(), 3);

    // 5. Revoke: the next call is refused.
    w.alice
        .call(w.kl.id(), "revoke")
        .args_json(json!({ "lease_id": id }))
        .transact()
        .await?
        .into_result()?;
    let revoked = use_lease(&w, &w.bob, &id, "/v1/chat")
        .await?
        .err()
        .unwrap_or_default();
    assert!(revoked.contains("lease_revoked"), "{revoked}");
    Ok(())
}

#[tokio::test]
async fn quota_and_panic_button() -> anyhow::Result<()> {
    let w = world().await?;
    let id = lease(&w, &["/v1/chat"], 1).await?;
    use_lease(&w, &w.bob, &id, "/v1/chat")
        .await?
        .map_err(anyhow::Error::msg)?;
    let used = use_lease(&w, &w.bob, &id, "/v1/chat")
        .await?
        .err()
        .unwrap_or_default();
    assert!(used.contains("quota_used"), "{used}");

    let second = lease(&w, &["/v1/chat"], 5).await?;
    w.alice
        .call(w.kl.id(), "revoke_all_owner")
        .transact()
        .await?
        .into_result()?;
    let after = use_lease(&w, &w.bob, &second, "/v1/chat")
        .await?
        .err()
        .unwrap_or_default();
    assert!(after.contains("lease_revoked"), "{after}");
    Ok(())
}

#[tokio::test]
async fn only_the_contract_itself_can_initialise_it() -> anyhow::Result<()> {
    let sandbox = near_workspaces::sandbox().await?;
    let kl = sandbox
        .dev_deploy(&wasm(
            "KEYLEASE_WASM",
            "target/near/keylease_contract/keylease_contract.wasm",
        )?)
        .await?;
    let mallory = sandbox.dev_create_account().await?;
    let args = json!({
        "admin": mallory.id(), "outlayer": mallory.id(),
        "proxy_url": format!("https://test.fastfs.io/kl.testnet/outlayer.testnet/{PROXY_HASH}.wasm"),
        "proxy_hash": PROXY_HASH,
    });
    let front_run = mallory.call(kl.id(), "new").args_json(&args).transact().await?;
    assert!(
        front_run.is_failure(),
        "a stranger must not initialise the contract"
    );
    let mut own = args.clone();
    own["admin"] = json!(kl.id());
    kl.call("new").args_json(own).transact().await?.into_result()?;
    let config: Value = kl.view("get_config").await?.json()?;
    assert_eq!(config["admin"], kl.id().as_str());
    Ok(())
}

#[tokio::test]
async fn key_pass_transfer_moves_the_lease() -> anyhow::Result<()> {
    let w = world().await?;
    let key: String = w
        .alice
        .call(w.kl.id(), "add_key")
        .args_json(
            json!({ "provider": "NearAiCloud", "base_url": "https://cloud-api.near.ai",
                           "secret_profile": "main", "label": "demo" }),
        )
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    let now_ns = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos(),
    )?;
    let lease: String = w
        .alice
        .call(w.kl.id(), "create_lease")
        .args_json(json!({ "key_id": key, "grantee": w.bob.id(), "calls": 3,
                           "expires_at": (now_ns + 3_600_000_000_000).to_string(),
                           "endpoints": ["/v1/chat/completions"], "transferable": true }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?
        .json()?;

    // bob uses one call, then hands the Key Pass to mallory (NEP-171, exactly 1 yoctoNEAR)
    assert!(use_lease(&w, &w.bob, &lease, "/v1/chat/completions")
        .await?
        .is_ok());
    w.bob
        .call(w.kl.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": w.mallory.id(), "token_id": lease }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    let token: Value =
        w.kl.view("nft_token")
            .args_json(json!({ "token_id": lease }))
            .await?
            .json()?;
    assert_eq!(token["owner_id"], json!(w.mallory.id()));
    let refused = use_lease(&w, &w.bob, &lease, "/v1/chat/completions").await?;
    assert!(
        matches!(&refused, Err(e) if e.contains("not_lease_holder")),
        "{refused:?}"
    );
    assert!(use_lease(&w, &w.mallory, &lease, "/v1/chat/completions")
        .await?
        .is_ok());
    let r2 = receipt(&w, &lease, 2).await?;
    assert_eq!(r2["caller"], json!(w.mallory.id()));
    Ok(())
}

#[tokio::test]
async fn revoking_a_parent_refuses_its_sub_lease_in_the_same_call() -> anyhow::Result<()> {
    let w = world().await?;
    let root = lease(&w, &["/v1/chat/completions"], 4).await?;
    let now_ns = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos(),
    )?;
    // bob (the holder) hands 2 of his 4 calls on to mallory, for 30 minutes
    let child: String = w
        .bob
        .call(w.kl.id(), "create_sub_lease")
        .args_json(json!({ "parent": root, "grantee": w.mallory.id(), "calls": 2,
                           "expires_at": (now_ns + 1_800_000_000_000).to_string(),
                           "endpoints": ["/v1/chat/completions"] }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert!(use_lease(&w, &w.mallory, &child, "/v1/chat/completions")
        .await?
        .is_ok());
    let parent: Value =
        w.kl.view("get_lease")
            .args_json(json!({ "lease_id": root }))
            .await?
            .json()?;
    assert_eq!(parent["calls_used"], json!(1)); // the child's call counted on the parent

    // more than the parent has left is refused at creation
    let too_many = w
        .bob
        .call(w.kl.id(), "create_sub_lease")
        .args_json(json!({ "parent": root, "grantee": w.mallory.id(), "calls": 4,
                           "expires_at": (now_ns + 1_800_000_000_000).to_string(),
                           "endpoints": ["/v1/chat/completions"] }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?;
    assert!(too_many.into_result().is_err());

    // one revoke by the key owner; the sub-lease is refused right after, with no other transaction
    w.alice
        .call(w.kl.id(), "revoke")
        .args_json(json!({ "lease_id": root }))
        .transact()
        .await?
        .into_result()?;
    let refused = use_lease(&w, &w.mallory, &child, "/v1/chat/completions").await?;
    assert!(
        matches!(&refused, Err(e) if e.contains("parent_revoked")),
        "{refused:?}"
    );
    Ok(())
}

/// alice leases 2 calls on /v1/chat to `holder` (an EVM or Solana holder account) for one hour.
async fn lease_to(w: &World, holder: &str) -> anyhow::Result<String> {
    let key: String = w
        .alice
        .call(w.kl.id(), "add_key")
        .args_json(
            json!({ "provider": "NearAiCloud", "base_url": "https://cloud-api.near.ai",
                           "secret_profile": "main", "label": "demo" }),
        )
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    let now_ns = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos(),
    )?;
    Ok(w.alice
        .call(w.kl.id(), "create_lease")
        .args_json(json!({ "key_id": key, "grantee": holder, "calls": 2,
                           "expires_at": (now_ns + 3_600_000_000_000).to_string(), "endpoints": ["/v1/chat"] }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?
        .json()?)
}

/// mallory sends a signed call for the holder. Ok(answer) or Err(failure text).
async fn relay(
    w: &World,
    lease: &str,
    nonce: u64,
    until: u64,
    signer: Value,
) -> anyhow::Result<Result<Value, String>> {
    let out = w
        .mallory
        .call(w.kl.id(), "use_lease_signed")
        .args_json(json!({ "lease_id": lease, "endpoint": "/v1/chat", "body": "{\"q\":\"hello\"}",
                           "nonce": nonce.to_string(), "valid_until_ms": until.to_string(), "signer": signer }))
        .deposit(NearToken::from_millinear(30))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    Ok(match out.into_result() {
        Ok(ok) => Ok(ok.json()?),
        Err(e) => Err(format!("{e:?}")),
    })
}

async fn message(w: &World, lease: &str, nonce: u64, until: u64) -> anyhow::Result<String> {
    Ok(w.kl
        .view("signed_call_message")
        .args_json(
            json!({ "lease_id": lease, "nonce": nonce.to_string(), "valid_until_ms": until.to_string(),
                           "endpoint": "/v1/chat", "body": "{\"q\":\"hello\"}" }),
        )
        .await?
        .json()?)
}

fn hex(b: &[u8]) -> String {
    b.iter().fold(String::new(), |mut s, x| {
        use std::fmt::Write as _;
        let _ = write!(s, "{x:02x}");
        s
    })
}

/// EIP-191 `personal_sign` with a throwaway test key, as a wallet returns it (r, s, v = 27/28).
fn evm_sign(sk: &secp256k1::SecretKey, msg: &str) -> String {
    use sha3::Digest;
    let mut prefixed = format!("\x19Ethereum Signed Message:\n{}", msg.len()).into_bytes();
    prefixed.extend_from_slice(msg.as_bytes());
    let digest: [u8; 32] = sha3::Keccak256::digest(&prefixed).into();
    let m = secp256k1::Message::from_slice(&digest).unwrap_or_else(|_| unreachable!());
    let (rec, sig) = secp256k1::Secp256k1::new()
        .sign_ecdsa_recoverable(&m, sk)
        .serialize_compact();
    format!(
        "0x{}{:02x}",
        hex(&sig),
        u8::try_from(rec.to_i32()).unwrap_or_default() + 27
    )
}

#[tokio::test]
async fn evm_and_solana_holders_call_through_a_relayer_and_replay_is_refused() -> anyhow::Result<()> {
    use ed25519_dalek::Signer as _;
    use sha3::Digest;
    let w = world().await?;
    let until = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis(),
    )? + 600_000;

    // EVM holder: the contract maps the (checksummed) address to its eth-implicit account.
    let sk = secp256k1::SecretKey::from_slice(&[0x11; 32])?;
    let pk = sk
        .public_key(&secp256k1::Secp256k1::new())
        .serialize_uncompressed();
    let address = format!("0x{}", hex(&sha3::Keccak256::digest(&pk[1..])[12..]));
    let holder: String =
        w.kl.view("evm_holder_account")
            .args_json(json!({ "address": address.to_uppercase().replace("0X", "0x") }))
            .await?
            .json()?;
    assert_eq!(holder, address);
    let id = lease_to(&w, &holder).await?;
    let sig = evm_sign(&sk, &message(&w, &id, 1, until).await?);
    let answer = relay(&w, &id, 1, until, json!({ "Evm": { "signature": sig } }))
        .await?
        .map_err(anyhow::Error::msg)?;
    assert_eq!(answer["ok"], true);
    let r = receipt(&w, &id, 1).await?;
    assert_eq!(
        (r["caller"].as_str(), r["outcome"].as_str()),
        (Some(holder.as_str()), Some("ok"))
    );
    let sent: Vec<String> = w.mock.view("requests").await?.json()?;
    let req: Value = serde_json::from_str(&sent[0])?;
    assert_eq!(
        req["payer_account_id"],
        w.mallory.id().as_str(),
        "the relayer pays and gets the refund"
    );

    // The same signed call again: refused, nothing more reaches OutLayer.
    let replay = relay(&w, &id, 1, until, json!({ "Evm": { "signature": sig } }))
        .await?
        .err()
        .unwrap_or_default();
    assert!(replay.contains("nonce_used"), "{replay}");
    // A valid signature from another key is not the holder's.
    let other = secp256k1::SecretKey::from_slice(&[0x22; 32])?;
    let stranger = evm_sign(&other, &message(&w, &id, 2, until).await?);
    let refused = relay(&w, &id, 2, until, json!({ "Evm": { "signature": stranger } }))
        .await?
        .err()
        .unwrap_or_default();
    assert!(refused.contains("not_lease_holder"), "{refused}");

    // Solana holder: the base58 address maps to the 64-hex implicit account.
    let k = ed25519_dalek::SigningKey::from_bytes(&[0x33; 32]);
    let sol = bs58::encode(k.verifying_key().to_bytes()).into_string();
    let sol_holder: String =
        w.kl.view("solana_holder_account")
            .args_json(json!({ "address": sol }))
            .await?
            .json()?;
    assert_eq!(sol_holder, hex(&k.verifying_key().to_bytes()));
    let sid = lease_to(&w, &sol_holder).await?;
    let m = message(&w, &sid, 1, until).await?;
    let signature = bs58::encode(k.sign(m.as_bytes()).to_bytes()).into_string();
    let answer = relay(
        &w,
        &sid,
        1,
        until,
        json!({ "Solana": { "public_key": sol, "signature": signature } }),
    )
    .await?
    .map_err(anyhow::Error::msg)?;
    assert_eq!(answer["ok"], true);
    assert_eq!(receipt(&w, &sid, 1).await?["caller"], sol_holder.as_str());
    let sent: Vec<String> = w.mock.view("requests").await?.json()?;
    assert_eq!(sent.len(), 2, "only the two good calls reached OutLayer");
    Ok(())
}
