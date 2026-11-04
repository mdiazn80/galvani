//! Connection to a real Myo over Bluetooth Low Energy, using `btleplug`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use btleplug::api::{
    Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::StreamExt;
use serde::Serialize;
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

use super::{MyoTransport, Notification, Source, TransportError};
use crate::myo::protocol::{
    BATTERY_LEVEL_CHARACTERISTIC, CLASSIFIER_EVENT_CHARACTERISTIC, COMMAND_CHARACTERISTIC,
    CONTROL_SERVICE, Command, EMG_DATA_CHARACTERISTICS, FIRMWARE_VERSION_CHARACTERISTIC,
    FirmwareVersion, IMU_DATA_CHARACTERISTIC, MOTION_EVENT_CHARACTERISTIC, MYO_INFO_CHARACTERISTIC,
    MyoInfo, parse_battery,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CHANNEL_CAPACITY: usize = 1024;
const DEFAULT_NAME: &str = "Myo";

const SUBSCRIBED_CHARACTERISTICS: [Uuid; 8] = [
    EMG_DATA_CHARACTERISTICS[0],
    EMG_DATA_CHARACTERISTICS[1],
    EMG_DATA_CHARACTERISTICS[2],
    EMG_DATA_CHARACTERISTICS[3],
    IMU_DATA_CHARACTERISTIC,
    MOTION_EVENT_CHARACTERISTIC,
    CLASSIFIER_EVENT_CHARACTERISTIC,
    BATTERY_LEVEL_CHARACTERISTIC,
];

impl From<btleplug::Error> for TransportError {
    fn from(error: btleplug::Error) -> Self {
        match error {
            btleplug::Error::PermissionDenied => Self::PermissionDenied,
            btleplug::Error::DeviceNotFound => Self::DeviceNotFound,
            btleplug::Error::NotConnected => Self::Disconnected,
            btleplug::Error::NoAdapterAvailable => Self::AdapterNotFound,
            btleplug::Error::TimedOut(_) => Self::TimedOut,
            other => Self::Bluetooth(other.to_string()),
        }
    }
}

fn source_of(characteristic: Uuid) -> Option<Source> {
    if let Some(index) = EMG_DATA_CHARACTERISTICS
        .iter()
        .position(|uuid| *uuid == characteristic)
    {
        return Some(Source::Emg(index as u8));
    }
    match characteristic {
        IMU_DATA_CHARACTERISTIC => Some(Source::Imu),
        MOTION_EVENT_CHARACTERISTIC => Some(Source::Motion),
        CLASSIFIER_EVENT_CHARACTERISTIC => Some(Source::Classifier),
        BATTERY_LEVEL_CHARACTERISTIC => Some(Source::Battery),
        _ => None,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A Myo found while scanning. macOS hides MAC addresses, so `id` is an opaque identifier
/// assigned by the system.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    pub id: String,
    pub name: String,
    pub rssi: Option<i16>,
}

/// Access to the Bluetooth adapter. Creating it can trigger the system permission prompt,
/// so it should only happen when the user asks to use Bluetooth.
pub struct BleScanner {
    adapter: Adapter,
    found: Mutex<HashMap<String, Peripheral>>,
}

impl BleScanner {
    pub async fn new() -> Result<Self, TransportError> {
        let manager = Manager::new().await?;
        let adapter = manager
            .adapters()
            .await?
            .into_iter()
            .next()
            .ok_or(TransportError::AdapterNotFound)?;
        Ok(Self {
            adapter,
            found: Mutex::new(HashMap::new()),
        })
    }

    async fn require_powered_on(&self) -> Result<(), TransportError> {
        match self.adapter.adapter_state().await? {
            CentralState::PoweredOn => Ok(()),
            CentralState::PoweredOff => Err(TransportError::BluetoothOff),
            CentralState::Unknown => Err(TransportError::BluetoothUnavailable),
        }
    }

    /// Looks for advertising Myos for `duration`.
    pub async fn scan(&self, duration: Duration) -> Result<Vec<DiscoveredDevice>, TransportError> {
        self.require_powered_on().await?;
        self.adapter
            .start_scan(ScanFilter {
                services: vec![CONTROL_SERVICE],
            })
            .await?;
        tokio::time::sleep(duration).await;
        self.adapter.stop_scan().await?;

        let mut found = HashMap::new();
        let mut devices = Vec::new();
        for peripheral in self.adapter.peripherals().await? {
            let Some(properties) = peripheral.properties().await? else {
                continue;
            };
            if !properties.services.contains(&CONTROL_SERVICE) {
                continue;
            }
            let id = peripheral.id().to_string();
            devices.push(DiscoveredDevice {
                id: id.clone(),
                name: properties
                    .local_name
                    .or(properties.advertisement_name)
                    .unwrap_or_else(|| DEFAULT_NAME.to_owned()),
                rssi: properties.rssi,
            });
            found.insert(id, peripheral);
        }
        *self.found.lock().expect("scanner lock poisoned") = found;
        log::info!("Scan found {} Myo(s)", devices.len());
        Ok(devices)
    }

    /// Connects to a device returned by the last scan.
    pub async fn connect(&self, id: &str, name: String) -> Result<BleTransport, TransportError> {
        self.require_powered_on().await?;
        let peripheral = self
            .found
            .lock()
            .expect("scanner lock poisoned")
            .get(id)
            .cloned()
            .ok_or(TransportError::DeviceNotFound)?;
        let transport = BleTransport {
            adapter: self.adapter.clone(),
            peripheral,
            name,
            characteristics: Mutex::new(HashMap::new()),
            stop: watch::channel(false).0,
        };
        transport.establish().await?;
        Ok(transport)
    }
}

pub struct BleTransport {
    adapter: Adapter,
    peripheral: Peripheral,
    name: String,
    characteristics: Mutex<HashMap<Uuid, Characteristic>>,
    stop: watch::Sender<bool>,
}

impl BleTransport {
    async fn establish(&self) -> Result<(), TransportError> {
        self.peripheral
            .connect_with_timeout(CONNECT_TIMEOUT)
            .await?;
        self.peripheral
            .discover_services_with_timeout(CONNECT_TIMEOUT)
            .await?;

        let characteristics: HashMap<_, _> = self
            .peripheral
            .characteristics()
            .into_iter()
            .map(|characteristic| (characteristic.uuid, characteristic))
            .collect();
        // A record of what each device offers, since the protocol isn't fully documented.
        for characteristic in characteristics.values() {
            log::debug!(
                "Characteristic {} in service {}: {:?}",
                characteristic.uuid,
                characteristic.service_uuid,
                characteristic.properties,
            );
        }
        let required = SUBSCRIBED_CHARACTERISTICS.iter().chain(&[
            MYO_INFO_CHARACTERISTIC,
            FIRMWARE_VERSION_CHARACTERISTIC,
            COMMAND_CHARACTERISTIC,
        ]);
        for uuid in required {
            if !characteristics.contains_key(uuid) {
                let _ = self.peripheral.disconnect().await;
                return Err(TransportError::NotAMyo(*uuid));
            }
        }
        *self
            .characteristics
            .lock()
            .expect("characteristics lock poisoned") = characteristics;
        Ok(())
    }

    fn characteristic(&self, uuid: Uuid) -> Result<Characteristic, TransportError> {
        self.characteristics
            .lock()
            .expect("characteristics lock poisoned")
            .get(&uuid)
            .cloned()
            .ok_or(TransportError::Disconnected)
    }

    async fn read(&self, uuid: Uuid) -> Result<Vec<u8>, TransportError> {
        let data = self.peripheral.read(&self.characteristic(uuid)?).await?;
        log::debug!("Read {uuid}: {}", hex(&data));
        Ok(data)
    }
}

#[async_trait]
impl MyoTransport for BleTransport {
    fn name(&self) -> &str {
        &self.name
    }

    async fn read_info(&self) -> Result<MyoInfo, TransportError> {
        Ok(MyoInfo::parse(&self.read(MYO_INFO_CHARACTERISTIC).await?)?)
    }

    async fn read_firmware(&self) -> Result<FirmwareVersion, TransportError> {
        Ok(FirmwareVersion::parse(
            &self.read(FIRMWARE_VERSION_CHARACTERISTIC).await?,
        )?)
    }

    async fn read_battery(&self) -> Result<u8, TransportError> {
        Ok(parse_battery(
            &self.read(BATTERY_LEVEL_CHARACTERISTIC).await?,
        )?)
    }

    async fn read_rssi(&self) -> Result<i16, TransportError> {
        Ok(self.peripheral.read_rssi().await?)
    }

    async fn send_command(&self, command: Command) -> Result<(), TransportError> {
        let bytes = command.encode();
        log::debug!("Sending command: {}", hex(&bytes));
        self.peripheral
            .write(
                &self.characteristic(COMMAND_CHARACTERISTIC)?,
                &bytes,
                WriteType::WithResponse,
            )
            .await?;
        Ok(())
    }

    async fn subscribe(&self) -> Result<mpsc::Receiver<Notification>, TransportError> {
        // Open both streams before subscribing, so that nothing gets missed.
        let mut notifications = self.peripheral.notifications().await?;
        let mut events = self.adapter.events().await?;
        for uuid in SUBSCRIBED_CHARACTERISTICS {
            self.peripheral
                .subscribe(&self.characteristic(uuid)?)
                .await?;
        }

        let (sender, receiver) = mpsc::channel(CHANNEL_CAPACITY);
        let id = self.peripheral.id();
        self.stop.send_replace(false);
        let mut stop = self.stop.subscribe();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop.changed() => return,
                    notification = notifications.next() => {
                        // CoreBluetooth doesn't end this stream on a disconnection, so
                        // the adapter events below are what normally ends the loop.
                        let Some(notification) = notification else { return };
                        let Some(source) = source_of(notification.uuid) else { continue };
                        let notification = Notification { source, data: notification.value };
                        if sender.send(notification).await.is_err() {
                            return;
                        }
                    }
                    event = events.next() => match event {
                        Some(CentralEvent::DeviceDisconnected(disconnected))
                            if disconnected == id =>
                        {
                            log::warn!("The device dropped the connection");
                            return;
                        }
                        Some(_) => {}
                        None => return,
                    },
                }
            }
        });
        Ok(receiver)
    }

    async fn reconnect(&self) -> Result<(), TransportError> {
        self.stop.send_replace(true);
        self.establish().await
    }

    async fn disconnect(&self) -> Result<(), TransportError> {
        self.stop.send_replace(true);
        self.peripheral.disconnect().await?;
        Ok(())
    }
}
