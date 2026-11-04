//! Abstraction over the ways of reaching a Myo: simulated or over Bluetooth Low Energy.

pub mod ble;
pub mod mock;
pub mod playback;

use async_trait::async_trait;
use thiserror::Error;
use tokio::sync::mpsc;

use super::protocol::{Command, FirmwareVersion, MyoInfo, ParseError};

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("the device is disconnected")]
    Disconnected,
    #[error("no Bluetooth adapter is available")]
    AdapterNotFound,
    #[error("Bluetooth is turned off")]
    BluetoothOff,
    /// CoreBluetooth reports the same unknown state for several causes, including a
    /// denied permission.
    #[error("Bluetooth is unavailable")]
    BluetoothUnavailable,
    #[error("the app has no permission to use Bluetooth")]
    PermissionDenied,
    #[error("the device was not found")]
    DeviceNotFound,
    #[error("the connection timed out")]
    TimedOut,
    #[error("the device doesn't expose the characteristic {0}")]
    NotAMyo(uuid::Uuid),
    #[error("the device sent invalid data: {0}")]
    InvalidData(#[from] ParseError),
    #[error("Bluetooth error: {0}")]
    Bluetooth(String),
}

/// Source of a notification or indication.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// One of the four EMG characteristics.
    Emg(u8),
    Imu,
    Motion,
    Classifier,
    Battery,
    /// A label the user added to a recording, as UTF-8 text.
    Mark,
}

/// Unparsed payload received from the device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    pub source: Source,
    pub data: Vec<u8>,
}

/// Connection to one Myo. Implementations deliver raw bytes so that real and simulated
/// devices go through the same parsing code.
#[async_trait]
pub trait MyoTransport: Send + Sync {
    fn name(&self) -> &str;
    async fn read_info(&self) -> Result<MyoInfo, TransportError>;
    async fn read_firmware(&self) -> Result<FirmwareVersion, TransportError>;
    async fn read_battery(&self) -> Result<u8, TransportError>;
    async fn read_rssi(&self) -> Result<i16, TransportError>;
    async fn send_command(&self, command: Command) -> Result<(), TransportError>;
    /// Starts delivering notifications. The stream ends when the device disconnects.
    async fn subscribe(&self) -> Result<mpsc::Receiver<Notification>, TransportError>;
    /// Restores a lost connection. Callers must subscribe again afterwards.
    async fn reconnect(&self) -> Result<(), TransportError>;
    async fn disconnect(&self) -> Result<(), TransportError>;
}
