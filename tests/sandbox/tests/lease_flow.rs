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
