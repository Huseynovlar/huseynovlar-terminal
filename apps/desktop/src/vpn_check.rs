use serde::Serialize;
use std::time::{Duration, Instant};

const DEFAULT_HEALTH_URL: &str = "https://terminal.huseynovlar.org/healthz";

#[derive(Debug, Clone, Serialize)]
pub struct VpnStatusResponse {
    pub connected: bool,
    pub latency_ms: Option<u64>,
    pub endpoint: String,
    pub message: String,
}

/// Checks only whether the terminal server responds successfully to GET /healthz.
/// Network-interface state and local VPN clients are deliberately not inspected.
#[tauri::command]
pub async fn check_vpn_status(endpoint: Option<String>) -> VpnStatusResponse {
    let target = endpoint
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("HUSEYNOVLAR_VPN_HEALTH_URL").ok())
        .unwrap_or_else(|| DEFAULT_HEALTH_URL.to_string());

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return VpnStatusResponse {
                connected: false,
                latency_ms: None,
                endpoint: target,
                message: format!("Не удалось создать HTTP-клиент: {error}"),
            };
        }
    };

    let started = Instant::now();
    match client.get(&target).send().await {
        Ok(response) if response.status().is_success() => VpnStatusResponse {
            connected: true,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            endpoint: target,
            message: "Сервер доступен — /healthz вернул успешный ответ".to_string(),
        },
        Ok(response) => VpnStatusResponse {
            connected: false,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            endpoint: target,
            message: format!("Сервер ответил HTTP {} на /healthz", response.status().as_u16()),
        },
        Err(error) => VpnStatusResponse {
            connected: false,
            latency_ms: None,
            endpoint: target,
            message: format!("Сервер недоступен: {error}"),
        },
    }
}
