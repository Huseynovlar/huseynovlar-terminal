use serde::Serialize;
use std::time::{Duration, Instant};

const DEFAULT_VPN_HEALTH_URL: &str = "https://terminal.huseynovlar.org/healthz";

#[derive(Debug, Clone, Serialize)]
pub struct VpnStatusResponse {
    pub connected: bool,
    pub tunnel_detected: bool,
    pub interface_name: Option<String>,
    pub latency_ms: Option<u64>,
    pub endpoint: String,
    pub message: String,
}

/// Informative OS VPN interface detection (utun*, tun*, wg*, WireGuard/OpenVPN).
fn detect_vpn_interface() -> (bool, Option<String>) {
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir("/sys/class/net") {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("tun") || name.starts_with("wg") || name.starts_with("tailscale") {
                    return (true, Some(name));
                }
            }
        }
        (false, None)
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("ifconfig").arg("-l").output() {
            let list = String::from_utf8_lossy(&out.stdout);
            for iface in list.split_whitespace() {
                if iface.starts_with("utun") || iface.starts_with("wg") || iface.starts_with("ipsec") {
                    return (true, Some(iface.to_string()));
                }
            }
        }
        (false, None)
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, rely primarily on the private HTTPS /healthz probe.
        (false, None)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        (false, None)
    }
}

/// Two-stage VPN Pre-Flight Check:
/// 1) Informative OS tunnel interface check
/// 2) Strict 5000ms timeout HTTPS /healthz probe to the private terminal server
#[tauri::command]
pub async fn check_vpn_status(endpoint: Option<String>) -> VpnStatusResponse {
    let target = endpoint
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("HUSEYNOVLAR_VPN_HEALTH_URL").ok())
        .unwrap_or_else(|| DEFAULT_VPN_HEALTH_URL.to_string());

    let (tunnel_detected, interface_name) = detect_vpn_interface();

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return VpnStatusResponse {
                connected: false,
                tunnel_detected,
                interface_name,
                latency_ms: None,
                endpoint: target,
                message: format!("HTTP client error: {e}"),
            };
        }
    };

    let started = Instant::now();
    match client.get(&target).send().await {
        Ok(resp) if resp.status().is_success() => VpnStatusResponse {
            connected: true,
            tunnel_detected,
            interface_name,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            endpoint: target,
            message: "VPN: OK — закрытый сервер доступен".to_string(),
        },
        Ok(resp) if resp.status().as_u16() == 404 => VpnStatusResponse {
            connected: false,
            tunnel_detected,
            interface_name,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            endpoint: target,
            message: "HTTP 404: сервер ответил, но маршрут /healthz не найден или запрос скрыт IP-фильтром Caddy. Проверьте доступ NetBird и прокси сервера.".to_string(),
        },
        Ok(resp) if resp.status().as_u16() == 403 => VpnStatusResponse {
            connected: false,
            tunnel_detected,
            interface_name,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            endpoint: target,
            message: "HTTP 403: сервер доступен, но запретил запрос. Проверьте правило доступа NetBird/Caddy.".to_string(),
        },
        Ok(resp) => VpnStatusResponse {
            connected: false,
            tunnel_detected,
            interface_name,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            endpoint: target,
            message: format!("Сервер ответил HTTP {} на /healthz", resp.status().as_u16()),
        },
        Err(error) => VpnStatusResponse {
            connected: false,
            tunnel_detected,
            interface_name,
            latency_ms: None,
            endpoint: target.clone(),
            message: format!("Не удалось подключиться к {target}: {error}"),
        },
    }
}
