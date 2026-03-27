use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Serialize, Deserialize)]
pub enum KernelError {
    NotInitialized,
    InvalidRequest(String),
    DecryptionFailed(String),
    EncryptionFailed(String),
    ValidationFailed { field: String, message: String },
    Unauthorized(String),
    Locked,
    InternalError(String),
}

impl std::fmt::Display for KernelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Locked => write!(f, "KERNEL_LOCKED"),
            Self::NotInitialized => write!(f, "KERNEL_NOT_INITIALIZED"),
            Self::ValidationFailed { field, message } => {
                write!(f, "VALIDATION_FAILED:{}:{}", field, message)
            }
            other => write!(f, "{:?}", other),
        }
    }
}

impl std::error::Error for KernelError {}
