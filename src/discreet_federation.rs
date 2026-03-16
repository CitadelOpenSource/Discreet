// discreet_federation.rs — Federation protocol for instance-to-instance communication.
//
// Instances establish trust via mTLS, then relay MLS ciphertext between
// members on different instances. Neither instance can read the messages.
// AI agents can be shared across federation boundaries.
//
// Discovery: GET /.well-known/discreet-federation
// Transport: HTTPS + mTLS on port 8448

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Instance Identity ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceIdentity {
    pub instance_id: String,
    pub domain: String,
    pub signing_public_key: Vec<u8>,
    pub transport_public_key: Vec<u8>,
    pub display_name: String,
    pub version: String,
    pub capabilities: InstanceCapabilities,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceCapabilities {
    pub protocol_versions: Vec<String>,
    pub post_quantum: bool,
    pub max_federated_group_size: u32,
    pub ai_agents_available: bool,
    pub mls_cipher_suites: Vec<String>,
    pub voice_federation: bool,
}

// ─── Federation Links ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationLink {
    pub link_id: Uuid,
    pub local_instance: String,
    pub remote_instance: String,
    pub trust_level: TrustLevel,
    pub status: LinkStatus,
    pub established_at: DateTime<Utc>,
    pub negotiated: NegotiatedCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TrustLevel {
    Full,
    Restricted,
    Probationary,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LinkStatus {
    Handshaking,
    Active,
    Suspended,
    Severed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NegotiatedCapabilities {
    pub protocol_version: String,
    pub post_quantum: bool,
    pub ai_agents: bool,
    pub voice: bool,
    pub max_group_size: u32,
    pub cipher_suite: String,
}

// ─── Federated User ─────────────────────────────────────────────────────

/// Cross-instance user identifier: `uuid@domain`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct FederatedUserId {
    pub local_id: Uuid,
    pub instance: String,
}

impl FederatedUserId {
    pub fn format(&self) -> String {
        format!("{}@{}", self.local_id, self.instance)
    }

    pub fn parse(s: &str) -> Option<Self> {
        let (id, domain) = s.split_once('@')?;
        Some(Self {
            local_id: Uuid::parse_str(id).ok()?,
            instance: domain.into(),
        })
    }
}

// ─── Wire Protocol ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FederationMessage {
    Handshake {
        identity: InstanceIdentity,
        signature: Vec<u8>,
    },
    HandshakeAck {
        identity: InstanceIdentity,
        negotiated: NegotiatedCapabilities,
        signature: Vec<u8>,
    },
    /// Relay an MLS ciphertext blob between instances.
    MLSRelay {
        group_id: Vec<u8>,
        mls_message: Vec<u8>,
        sender: FederatedUserId,
        timestamp: DateTime<Utc>,
    },
    KeyPackageDelivery {
        owner: FederatedUserId,
        key_package: Vec<u8>,
        pq_extension: Option<Vec<u8>>,
    },
    KeyPackageRequest {
        target: FederatedUserId,
        count: u32,
    },
    /// Share an AI agent across federation.
    AgentShare {
        agent_id: Uuid,
        display_name: String,
        specialization: serde_json::Value,
        key_packages: Vec<Vec<u8>>,
        identity_public_key: Vec<u8>,
        home_instance: String,
    },
    Presence {
        user: FederatedUserId,
        status: String,
        timestamp: DateTime<Utc>,
    },
    Ping { timestamp: DateTime<Utc> },
    Pong { timestamp: DateTime<Utc> },
}

// ─── Well-Known Discovery ───────────────────────────────────────────────

/// Served at GET /.well-known/discreet-federation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WellKnownFederation {
    pub instance_id: String,
    pub domain: String,
    pub federation_endpoint: String,
    pub signing_public_key: String,
    pub capabilities: InstanceCapabilities,
    pub version: String,
}

// ─── Transport Config ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationTransportConfig {
    pub port: u16,
    pub require_mtls: bool,
    pub max_connections: u32,
    pub rate_limit_per_instance: u32,
    pub request_timeout_secs: u64,
    pub tor_federation: bool,
}

impl Default for FederationTransportConfig {
    fn default() -> Self {
        Self {
            port: 8448,
            require_mtls: true,
            max_connections: 100,
            rate_limit_per_instance: 1000,
            request_timeout_secs: 30,
            tor_federation: false,
        }
    }
}
