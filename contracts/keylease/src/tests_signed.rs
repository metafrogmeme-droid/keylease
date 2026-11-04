//! Signed calls (PR 11a, E-021): an EVM or Solana holder signs, any testnet account sends and pays.
//! Keys here are throwaway test keys made from fixed bytes; nothing is a real wallet.
use crate::signed::{signed_message, Signer, NETWORK};
use crate::tests::{acct, fresh, SEC, T0};
use crate::*;
use ed25519_dalek::{Signer as _, SigningKey};
use near_sdk::mock::MockAction;
use near_sdk::serde_json::Value;
use near_sdk::test_utils::get_created_receipts;
use secp256k1::{Message, Secp256k1, SecretKey};
use sha3::{Digest, Keccak256};
use std::panic::{catch_unwind, AssertUnwindSafe};

const CONTRACT: &str = "keylease.alice.testnet";
const ENDPOINT: &str = "/v1/chat";
const BODY: &str = "{\"q\":1}";
const T0_MS: u64 = T0 / 1_000_000;
/// Valid-until used by most tests: ten minutes after T0.
const UNTIL: u64 = T0_MS + 600_000;

fn hex(b: &[u8]) -> String {
    use std::fmt::Write as _;
    b.iter().fold(String::new(), |mut s, x| {
        let _ = write!(s, "{x:02x}");
        s
    })
}

fn keccak(b: &[u8]) -> [u8; 32] {
    Keccak256::digest(b).into()
}

/// A test EVM key from fixed bytes.
fn evm_key(n: u8) -> SecretKey {
    SecretKey::from_slice(&[n; 32]).unwrap_or_else(|_| unreachable!())
}

/// The holder account an EVM key maps to: `0x` + lowercase hex of the address.
fn evm_account(sk: &SecretKey) -> String {
    let pk = sk.public_key(&Secp256k1::new()).serialize_uncompressed();
    format!("0x{}", hex(&keccak(&pk[1..])[12..]))
}

/// EIP-55 checksummed form of an address, as wallets show it (mixed case).
fn eip55(lower: &str) -> String {
    let body = &lower[2..];
    let h = hex(&keccak(body.as_bytes()));
    let out: String = body
        .chars()
        .zip(h.chars())
        .map(|(c, d)| {
            if c.is_ascii_alphabetic() && d >= '8' {
                c.to_ascii_uppercase()
            } else {
                c
            }
        })
        .collect();
    format!("0x{out}")
}

/// EIP-191 `personal_sign`: 65 bytes r||s||v with v = 27 or 28, as `MetaMask` returns it.
fn evm_sign(sk: &SecretKey, msg: &str) -> String {
    let mut prefixed = format!("\x19Ethereum Signed Message:\n{}", msg.len()).into_bytes();
    prefixed.extend_from_slice(msg.as_bytes());
    let digest = Message::from_slice(&keccak(&prefixed)).unwrap_or_else(|_| unreachable!());
    let (rec, sig) = Secp256k1::new()
        .sign_ecdsa_recoverable(&digest, sk)
        .serialize_compact();
    let v = u8::try_from(rec.to_i32()).unwrap_or_else(|_| unreachable!()) + 27;
    format!("0x{}{:02x}", hex(&sig), v)
}

fn sol_key(n: u8) -> SigningKey {
    SigningKey::from_bytes(&[n; 32])
}

/// The Solana address (base58 of the ed25519 public key) and its NEAR implicit account (hex).
fn sol_address(k: &SigningKey) -> (String, String) {
    let pk = k.verifying_key().to_bytes();
    (bs58::encode(pk).into_string(), hex(&pk))
}

fn sol_sign(k: &SigningKey, msg: &str) -> Signer {
    Signer::Solana {
        public_key: sol_address(k).0,
        signature: bs58::encode(k.sign(msg.as_bytes()).to_bytes()).into_string(),
    }
}

/// alice leases 3 calls on /v1/chat to `holder` for an hour; returns the contract and lease id.
fn leased_to(holder: &str) -> (KeyLease, U64) {
    testing_env_at("alice.testnet", T0, 1000);
    let mut c = fresh();
    let key = c.add_key(
        Provider::NearAiCloud,
        "https://cloud-api.near.ai".into(),
        "main".into(),
        "demo key".into(),
    );
    let lease = c.create_lease(
        key,
        acct(holder),
        3,
        U64(T0 + 3600 * SEC),
        vec![ENDPOINT.into()],
        None,
    );
    (c, lease)
}

fn testing_env_at(caller: &str, now: u64, deposit_millinear: u128) {
    near_sdk::testing_env!(near_sdk::test_utils::VMContextBuilder::new()
        .current_account_id(acct(CONTRACT))
        .predecessor_account_id(acct(caller))
        .block_timestamp(now)
        .attached_deposit(NearToken::from_millinear(deposit_millinear))
        .build());
}

fn msg(lease: U64, nonce: u64, until: u64) -> String {
    signed_message(&acct(CONTRACT), lease.0, nonce, until, "POST", ENDPOINT, BODY)
}

/// One signed call sent by `relayer.testnet` at T0 + 1 s; Err(panic text) when refused.
fn send(c: &mut KeyLease, lease: U64, nonce: u64, until: u64, signer: Signer) -> Result<(), String> {
    testing_env_at("relayer.testnet", T0 + SEC, 25);
    catch_unwind(AssertUnwindSafe(|| {
        let _ = c.use_lease_signed(
            lease,
            ENDPOINT.into(),
            None,
            Some(BODY.into()),
            U64(nonce),
            U64(until),
            signer,
        );
    }))
    .map_err(|e| {
        e.downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| (*s).to_owned()))
            .unwrap_or_default()
    })
}

/// The refusal code of a failed call. In unit tests the panic arrives wrapped as
/// `HostError(GuestPanic { panic_msg: "<code>: <hint>" })`.
fn code(r: Result<(), String>) -> String {
    let text = r.err().unwrap_or_default();
    let msg = text.split("panic_msg: \"").nth(1).unwrap_or(&text);
    msg.split(':').next().unwrap_or_default().trim().to_owned()
}

fn quiet<T>(f: impl FnOnce() -> T) -> T {
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let out = f();
    std::panic::set_hook(hook);
    out
}

/// The `request_execution` args of the last call.
fn outlayer_args() -> Value {
    let receipts = get_created_receipts();
    match receipts.first().and_then(|r| r.actions.first()) {
        Some(MockAction::FunctionCallWeight { args, .. }) => {
            near_sdk::serde_json::from_slice(args).unwrap_or_default()
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn the_message_names_network_contract_lease_nonce_expiry_request_and_body() {
    let m = signed_message(&acct(CONTRACT), 7, 3, UNTIL, "POST", ENDPOINT, BODY);
    assert_eq!(NETWORK, "near-testnet");
    assert_eq!(
        m,
        format!(
            "KeyLease signed call\nnetwork: near-testnet\ncontract: {CONTRACT}\nlease: 7\nnonce: 3\n\
             valid until (unix ms): {UNTIL}\nrequest: POST /v1/chat\nbody sha256: {}",
            hex(&near_sdk::env::sha256(BODY.as_bytes()))
        )
    );
}

#[test]
fn the_view_gives_clients_the_same_text_the_contract_checks() {
    let (c, lease) = leased_to("bob.testnet");
    assert_eq!(
        c.signed_call_message(
            lease,
            U64(1),
            U64(UNTIL),
            None,
            ENDPOINT.into(),
            Some(BODY.into())
        ),
        msg(lease, 1, UNTIL)
    );
    assert!(c
        .signed_call_message(lease, U64(1), U64(UNTIL), Some("GET".into()), "/v1/models".into(), None)
        .contains("request: GET /v1/models\nbody sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
}

#[test]
fn evm_holder_signs_a_relayer_sends_the_call_counts_for_the_holder() {
    let sk = evm_key(1);
    let holder = evm_account(&sk);
    let (mut c, lease) = leased_to(&holder);
    let sig = evm_sign(&sk, &msg(lease, 1, UNTIL));
    assert_eq!(
        send(&mut c, lease, 1, UNTIL, Signer::Evm { signature: sig }),
        Ok(())
    );
    let v = c.get_lease(lease).unwrap_or_else(|| unreachable!());
    assert_eq!((v.calls_used, v.last_nonce), (1, U64(1)));
    // The relayer pays OutLayer (and gets the unused compute back); the receipt will name the holder.
    let args = outlayer_args();
    assert_eq!(args["payer_account_id"], "relayer.testnet");
    assert!(near_sdk::test_utils::get_logs()
        .iter()
        .any(|l| l.contains("call_authorized") && l.contains(&holder)));
}

#[test]
fn solana_holder_signs_and_the_call_counts() {
    let k = sol_key(5);
    let (_, holder) = sol_address(&k);
    let (mut c, lease) = leased_to(&holder);
    assert_eq!(
        send(&mut c, lease, 1, UNTIL, sol_sign(&k, &msg(lease, 1, UNTIL))),
        Ok(())
    );
    assert_eq!(c.get_lease(lease).map(|l| l.calls_used), Some(1));
}

#[test]
fn a_wrong_signature_is_refused_and_uses_nothing() {
    let sk = evm_key(1);
    let (mut c, lease) = leased_to(&evm_account(&sk));
    let good = evm_sign(&sk, &msg(lease, 1, UNTIL));
    let cases = [
        "0x1234".to_owned(),                      // wrong length
        format!("{}1d", &good[..good.len() - 2]), // v = 29
        format!("0x{}", "00".repeat(65)),         // r = s = 0
        format!("{}zz", &good[..good.len() - 2]), // not hex
    ];
    for sig in cases {
        assert_eq!(
            code(quiet(|| send(
                &mut c,
                lease,
                1,
                UNTIL,
                Signer::Evm { signature: sig }
            ))),
            "bad_signature"
        );
    }
    let k = sol_key(5);
    let (_, holder) = sol_address(&k);
    let (mut s, sl) = leased_to(&holder);
    let Signer::Solana {
        public_key,
        signature,
    } = sol_sign(&k, &msg(sl, 1, UNTIL))
    else {
        unreachable!()
    };
    let mut bytes = bs58::decode(&signature).into_vec().unwrap_or_default();
    bytes[10] ^= 1;
    let flipped = Signer::Solana {
        public_key,
        signature: bs58::encode(bytes).into_string(),
    };
    assert_eq!(
        code(quiet(|| send(&mut s, sl, 1, UNTIL, flipped))),
        "bad_signature"
    );
    assert_eq!(
        c.get_lease(lease).map(|l| (l.calls_used, l.last_nonce)),
        Some((0, U64(0)))
    );
    assert_eq!(s.get_lease(sl).map(|l| l.calls_used), Some(0));
}

#[test]
fn a_high_s_twin_of_a_good_evm_signature_is_refused() {
    let sk = evm_key(1);
    let (mut c, lease) = leased_to(&evm_account(&sk));
    let good = evm_sign(&sk, &msg(lease, 1, UNTIL));
    let raw: Vec<u8> = (2..good.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&good[i..i + 2], 16).unwrap_or_default())
        .collect();
    // s' = n - s, v flipped: the same signature in its malleable form.
    let n: [u8; 32] = [
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xba,
        0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
    ];
    let mut s2 = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let d = i16::from(n[i]) - i16::from(raw[32 + i]) - borrow;
        borrow = i16::from(d < 0);
        s2[i] = u8::try_from((d + 256) % 256).unwrap_or_default();
    }
    let v2 = if raw[64] == 27 { 28 } else { 27 };
    let twin = format!("0x{}{}{v2:02x}", hex(&raw[..32]), hex(&s2));
    assert_eq!(
        code(quiet(|| send(
            &mut c,
            lease,
            1,
            UNTIL,
            Signer::Evm { signature: twin }
        ))),
        "bad_signature"
    );
    assert_eq!(
        send(&mut c, lease, 1, UNTIL, Signer::Evm { signature: good }),
        Ok(())
    );
}

#[test]
fn a_valid_signature_from_another_key_is_not_the_holder() {
    let holder_key = evm_key(1);
    let stranger = evm_key(2);
    let (mut c, lease) = leased_to(&evm_account(&holder_key));
    let sig = evm_sign(&stranger, &msg(lease, 1, UNTIL));
    assert_eq!(
        code(quiet(|| send(
            &mut c,
            lease,
            1,
            UNTIL,
            Signer::Evm { signature: sig }
        ))),
        "not_lease_holder"
    );

    let k = sol_key(5);
    let (_, holder) = sol_address(&k);
    let (mut s, sl) = leased_to(&holder);
    let other = sol_sign(&sol_key(6), &msg(sl, 1, UNTIL));
    assert_eq!(
        code(quiet(|| send(&mut s, sl, 1, UNTIL, other))),
        "not_lease_holder"
    );

    // A NEAR-named holder signs with nothing: the signed path never reaches its lease.
    let (mut n, nl) = leased_to("bob.testnet");
    let any = evm_sign(&holder_key, &msg(nl, 1, UNTIL));
    assert_eq!(
        code(quiet(|| send(
            &mut n,
            nl,
            1,
            UNTIL,
            Signer::Evm { signature: any }
        ))),
        "not_lease_holder"
    );
}

#[test]
fn a_signature_for_another_request_lease_contract_or_network_does_not_carry_over() {
    let sk = evm_key(1);
    let (mut c, lease) = leased_to(&evm_account(&sk));
    let other_contract = signed_message(
        &acct("keylease.mallory.testnet"),
        lease.0,
        1,
        UNTIL,
        "POST",
        ENDPOINT,
        BODY,
    );
    let other_lease = signed_message(&acct(CONTRACT), lease.0 + 1, 1, UNTIL, "POST", ENDPOINT, BODY);
    let other_body = signed_message(&acct(CONTRACT), lease.0, 1, UNTIL, "POST", ENDPOINT, "{\"q\":2}");
    let other_method = signed_message(&acct(CONTRACT), lease.0, 1, UNTIL, "GET", ENDPOINT, BODY);
    let mainnet = msg(lease, 1, UNTIL).replace("near-testnet", "near-mainnet");
    for m in [other_contract, other_lease, other_body, other_method, mainnet] {
        let sig = evm_sign(&sk, &m);
        // It recovers some other address, so it is not the holder's call.
        assert_eq!(
            code(quiet(|| send(
                &mut c,
                lease,
                1,
                UNTIL,
                Signer::Evm { signature: sig }
            ))),
            "not_lease_holder"
        );
    }
    assert_eq!(c.get_lease(lease).map(|l| l.calls_used), Some(0));
}

#[test]
fn a_replayed_or_lower_nonce_is_refused() {
    let sk = evm_key(1);
    let (mut c, lease) = leased_to(&evm_account(&sk));
    let first = evm_sign(&sk, &msg(lease, 5, UNTIL));
    assert_eq!(
        send(
            &mut c,
            lease,
            5,
            UNTIL,
            Signer::Evm {
                signature: first.clone()
            }
        ),
        Ok(())
    );
    assert_eq!(
        code(quiet(|| send(
            &mut c,
            lease,
            5,
            UNTIL,
            Signer::Evm { signature: first }
        ))),
        "nonce_used"
    );
    let lower = evm_sign(&sk, &msg(lease, 4, UNTIL));
    assert_eq!(
        code(quiet(|| send(
            &mut c,
            lease,
            4,
            UNTIL,
            Signer::Evm { signature: lower }
        ))),
        "nonce_used"
    );
    let next = evm_sign(&sk, &msg(lease, 9, UNTIL));
    assert_eq!(
        send(&mut c, lease, 9, UNTIL, Signer::Evm { signature: next }),
        Ok(())
    );
    assert_eq!(
        c.get_lease(lease).map(|l| (l.calls_used, l.last_nonce)),
        Some((2, U64(9)))
    );
}

#[test]
fn an_expired_signature_is_refused() {
    let sk = evm_key(1);
    let (mut c, lease) = leased_to(&evm_account(&sk));
    // The call is sent at T0 + 1 s; valid until T0 + 0.5 s.
    let until = T0_MS + 500;
    let sig = evm_sign(&sk, &msg(lease, 1, until));
    assert_eq!(
        code(quiet(|| send(
            &mut c,
            lease,
            1,
            until,
            Signer::Evm { signature: sig }
        ))),
        "signature_expired"
    );
    // Exactly at the valid-until millisecond it still counts.
    let edge = T0_MS + 1000;
    let ok = evm_sign(&sk, &msg(lease, 1, edge));
    assert_eq!(
        send(&mut c, lease, 1, edge, Signer::Evm { signature: ok }),
        Ok(())
    );
}

#[test]
fn a_mixed_case_0x_address_maps_to_one_lowercase_holder() {
    let sk = evm_key(1);
    let lower = evm_account(&sk);
    let checksummed = eip55(&lower);
    assert_ne!(checksummed, lower, "the test key's address has letters to case");
    let c = fresh();
    assert_eq!(c.evm_holder_account(checksummed.clone()).as_str(), lower);
    assert_eq!(
        c.evm_holder_account(checksummed.to_uppercase().replace("0X", "0x"))
            .as_str(),
        lower
    );
    // NEAR account ids are lowercase: the checksummed form is not an account id at all.
    assert!(checksummed.parse::<AccountId>().is_err());
    for bad in [
        "0x1234",
        "1234567890123456789012345678901234567890",
        "0xzz34567890123456789012345678901234567890",
    ] {
        assert!(
            quiet(|| catch_unwind(|| fresh().evm_holder_account(bad.into()))).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn a_solana_address_maps_to_the_hex_implicit_account_and_back() {
    let k = sol_key(5);
    let (address, holder) = sol_address(&k);
    let c = fresh();
    let account = c.solana_holder_account(address.clone());
    assert_eq!(account.as_str(), holder);
    assert_eq!(account.as_str().len(), 64);
    // Back: hex → bytes → base58 gives the Solana address again.
    let bytes: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&holder[i..i + 2], 16).unwrap_or_default())
        .collect();
    assert_eq!(bs58::encode(bytes).into_string(), address);
    // Leading zero bytes survive (base58 writes each as '1').
    let zeros = [0u8, 0, 7, 9]
        .iter()
        .chain([1u8; 28].iter())
        .copied()
        .collect::<Vec<u8>>();
    let z = bs58::encode(&zeros).into_string();
    assert!(z.starts_with("11"));
    assert_eq!(c.solana_holder_account(z).as_str(), hex(&zeros));
    for bad in ["", "0OIl", "abc", &"z".repeat(60)] {
        assert!(
            quiet(|| catch_unwind(|| fresh().solana_holder_account(bad.to_owned()))).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn the_usual_lease_rules_still_apply_to_a_signed_call() {
    let sk = evm_key(1);
    let (mut c, lease) = leased_to(&evm_account(&sk));
    // An endpoint outside the lease, signed correctly for that endpoint.
    let m = signed_message(&acct(CONTRACT), lease.0, 1, UNTIL, "POST", "/v1/admin", BODY);
    let sig = evm_sign(&sk, &m);
    testing_env_at("relayer.testnet", T0 + SEC, 25);
    let r = quiet(|| {
        catch_unwind(AssertUnwindSafe(|| {
            let _ = c.use_lease_signed(
                lease,
                "/v1/admin".into(),
                None,
                Some(BODY.into()),
                U64(1),
                U64(UNTIL),
                Signer::Evm { signature: sig },
            );
        }))
    });
    assert!(r.is_err());
    // Revoked: refused before the nonce is looked at.
    testing_env_at("alice.testnet", T0, 0);
    c.revoke(lease);
    let sig = evm_sign(&sk, &msg(lease, 1, UNTIL));
    assert_eq!(
        code(quiet(|| send(
            &mut c,
            lease,
            1,
            UNTIL,
            Signer::Evm { signature: sig }
        ))),
        "lease_revoked"
    );
}
