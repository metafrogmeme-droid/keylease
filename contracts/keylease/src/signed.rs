//! Signed calls (E-021): a lease held by an EVM address or a Solana key, called without a NEAR account
//! of its own. The holder signs one exact request; any testnet account sends it and pays gas and the
//! deposit. The contract checks the signature itself and derives the holder from the key it recovers
//! (EVM) or verifies against (Solana); no caller-supplied account id is ever trusted.
//!
//! Holders are plain NEAR account ids, so the Key Pass, the indexes and transfers need nothing new:
//! - EVM: the eth-implicit account `0x` + 40 lowercase hex (the address).
//! - Solana: the NEAR implicit account, 64 lowercase hex of the ed25519 public key (the base58 address,
//!   decoded).
//!
//! Replay: the message names the network, the contract, the lease, a nonce that must rise on every
//! call, a valid-until time, the method and endpoint, and the body's sha256.
use crate::{refuse, KeyLease, KeyLeaseExt, Refusal};
use keylease_reasons::SignedRefusal;
use near_sdk::json_types::U64;
use near_sdk::{env, near, AccountId, Promise};

/// The chain the signed message names; a signature for any other network never verifies here.
pub const NETWORK: &str = "near-testnet";

/// Half the secp256k1 group order: an EVM signature with a larger `s` is the malleable twin (EIP-2).
const SECP256K1_HALF_N: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x5d,
    0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

/// How the holder signed.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum Signer {
    /// EIP-191 `personal_sign` of the message: `0x` + 130 hex (r, s, v with v 27/28 or 0/1).
    Evm { signature: String },
    /// ed25519 over the message bytes (Solana `signMessage`): the base58 address and signature.
    Solana { public_key: String, signature: String },
}

/// The text the holder signs. Plain lines, so the wallet shows what it is signing.
#[must_use]
pub fn signed_message(
    contract: &AccountId,
    lease_id: u64,
    nonce: u64,
    valid_until_ms: u64,
    method: &str,
    endpoint: &str,
    body: &str,
) -> String {
    format!(
        "KeyLease signed call\nnetwork: {NETWORK}\ncontract: {contract}\nlease: {lease_id}\nnonce: {nonce}\n\
         valid until (unix ms): {valid_until_ms}\nrequest: {method} {endpoint}\nbody sha256: {}",
        hex(&env::sha256(body.as_bytes()))
    )
}

#[near]
impl KeyLease {
    /// Make one leased call for an EVM or Solana holder that signed it (see `signed_message`). Any
    /// account may send it; it pays gas and the deposit, and OutLayer refunds unused compute to it. The
    /// call counts for the holder and its receipt names the holder.
    #[payable]
    #[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
    pub fn use_lease_signed(
        &mut self,
        lease_id: U64,
        endpoint: String,
        method: Option<String>,
        body: Option<String>,
        nonce: U64,
        valid_until_ms: U64,
        signer: Signer,
    ) -> Promise {
        let method = method.unwrap_or_else(|| "POST".to_owned());
        let body = body.unwrap_or_default();
        let message = signed_message(
            &env::current_account_id(),
            lease_id.0,
            nonce.0,
            valid_until_ms.0,
            &method,
            &endpoint,
            &body,
        );
        let holder = match &signer {
            Signer::Evm { signature } => evm_signer(&message, signature),
            Signer::Solana {
                public_key,
                signature,
            } => solana_signer(&message, public_key, signature),
        }
        .unwrap_or_else(|r| refuse_signed(r));
        if env::block_timestamp_ms() > valid_until_ms.0 {
            refuse_signed(SignedRefusal::SignatureExpired);
        }
        if let Err(r) = self.check_internal(lease_id.0, &holder, &endpoint) {
            refuse(r);
        }
        let lease = self
            .leases
            .get_mut(&lease_id.0)
            .unwrap_or_else(|| refuse(Refusal::LeaseNotFound));
        if nonce.0 <= lease.last_nonce {
            refuse_signed(SignedRefusal::NonceUsed);
        }
        lease.last_nonce = nonce.0;
        self.start_call(lease_id, holder, endpoint, method, body)
    }

    /// The exact text a holder signs for this call (`method` default `POST`, `body` default empty), so
    /// clients never rebuild the format themselves.
    #[allow(clippy::needless_pass_by_value)]
    pub fn signed_call_message(
        &self,
        lease_id: U64,
        nonce: U64,
        valid_until_ms: U64,
        method: Option<String>,
        endpoint: String,
        body: Option<String>,
    ) -> String {
        signed_message(
            &env::current_account_id(),
            lease_id.0,
            nonce.0,
            valid_until_ms.0,
            method.as_deref().unwrap_or("POST"),
            &endpoint,
            body.as_deref().unwrap_or(""),
        )
    }

    /// The holder account of an EVM address in any letter case (EIP-55 checksummed or not): `0x` + 40
    /// lowercase hex. Lease to this account; the address's signatures call it.
    pub fn evm_holder_account(&self, address: String) -> AccountId {
        let hex_part = address
            .strip_prefix("0x")
            .filter(|h| h.len() == 40 && h.bytes().all(|b| b.is_ascii_hexdigit()))
            .unwrap_or_else(|| env::panic_str("an EVM address is 0x and 40 hex digits"));
        account(&format!("0x{}", hex_part.to_ascii_lowercase()))
    }

    /// The holder account of a Solana address (base58 ed25519 public key): its NEAR implicit account,
    /// 64 lowercase hex.
    pub fn solana_holder_account(&self, address: String) -> AccountId {
        let pk = base58_32(&address)
            .unwrap_or_else(|| env::panic_str("a Solana address is a base58 ed25519 public key"));
        account(&hex(&pk))
    }
}

/// The eth-implicit account whose key made `signature` over `message` (EIP-191).
fn evm_signer(message: &str, signature: &str) -> Result<AccountId, SignedRefusal> {
    let sig = signature
        .strip_prefix("0x")
        .and_then(unhex)
        .filter(|s| s.len() == 65)
        .ok_or(SignedRefusal::BadSignature)?;
    let v = match sig[64] {
        0 | 27 => 0,
        1 | 28 => 1,
        _ => return Err(SignedRefusal::BadSignature),
    };
    if sig[32..64] > SECP256K1_HALF_N[..] {
        return Err(SignedRefusal::BadSignature);
    }
    let mut prefixed = format!("\x19Ethereum Signed Message:\n{}", message.len()).into_bytes();
    prefixed.extend_from_slice(message.as_bytes());
    let digest = env::keccak256_array(&prefixed);
    let public = env::ecrecover(&digest, &sig[..64], v, true).ok_or(SignedRefusal::BadSignature)?;
    let address = &env::keccak256_array(public)[12..];
    Ok(account(&format!("0x{}", hex(address))))
}

/// The implicit account of the ed25519 key that made `signature` over `message` (Solana).
fn solana_signer(message: &str, public_key: &str, signature: &str) -> Result<AccountId, SignedRefusal> {
    let pk = base58_32(public_key).ok_or(SignedRefusal::BadSignature)?;
    let sig: [u8; 64] = base58(signature)
        .and_then(|s| s.try_into().ok())
        .ok_or(SignedRefusal::BadSignature)?;
    if !env::ed25519_verify(&sig, message.as_bytes(), &pk) {
        return Err(SignedRefusal::BadSignature);
    }
    Ok(account(&hex(&pk)))
}

/// Panic with a signed-call refusal in the shared `<code>: <hint>` form.
fn refuse_signed(r: SignedRefusal) -> ! {
    env::panic_str(&format!("{}: {}", r.code(), r.hint()))
}

fn account(id: &str) -> AccountId {
    id.parse()
        .unwrap_or_else(|_| env::panic_str("not a valid account id"))
}

fn hex(b: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(char::from(DIGITS[usize::from(x >> 4)]));
        s.push(char::from(DIGITS[usize::from(x & 0xf)]));
    }
    s
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    let nibble = |c: u8| char::from(c).to_digit(16).and_then(|d| u8::try_from(d).ok());
    s.as_bytes()
        .chunks(2)
        .map(|p| Some(nibble(p[0])? << 4 | nibble(p[1])?))
        .collect()
}

/// Base58 (Bitcoin/Solana alphabet), at most 100 characters.
fn base58(s: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if s.is_empty() || s.len() > 100 {
        return None;
    }
    let mut out: Vec<u8> = Vec::new(); // little-endian while decoding
    for c in s.bytes() {
        let mut carry = u32::try_from(ALPHABET.iter().position(|&a| a == c)?).ok()?;
        for b in &mut out {
            carry += u32::from(*b) * 58;
            *b = u8::try_from(carry & 0xff).ok()?;
            carry >>= 8;
        }
        while carry > 0 {
            out.push(u8::try_from(carry & 0xff).ok()?);
            carry >>= 8;
        }
    }
    out.extend(s.bytes().take_while(|&c| c == b'1').map(|_| 0));
    out.reverse();
    Some(out)
}

fn base58_32(s: &str) -> Option<[u8; 32]> {
    base58(s)?.try_into().ok()
}
