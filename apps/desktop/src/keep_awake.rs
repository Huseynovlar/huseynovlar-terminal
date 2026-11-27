use std::sync::Mutex;
use tauri::State;

pub struct KeepAwakeState {
    guard: Mutex<Option<keepawake::KeepAwake>>,
}

impl Default for KeepAwakeState {
    fn default() -> Self {
        Self {
            guard: Mutex::new(None),
        }
    }
}

impl KeepAwakeState {
    pub fn set(&self, enabled: bool) -> Result<bool, String> {
        let mut slot = self.guard.lock().map_err(|_| "KeepAwake mutex poisoned".to_string())?;
        if enabled {
            if slot.is_none() {
                let awake = keepawake::Builder::default()
                    .display(true)
                    .idle(true)
                    .sleep(true)
                    .reason("Huseynovlar Terminal active trading session")
                    .app_name("Huseynovlar Terminal")
                    .create()
                    .map_err(|e| format!("Failed to acquire OS Keep-Awake lock: {e}"))?;
                *slot = Some(awake);
            }
            Ok(true)
        } else {
            *slot = None;
            Ok(false)
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.guard.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// Guaranteed cleanup on RunEvent::Exit so the OS display can sleep normally.
    pub fn release_all(&self) {
        if let Ok(mut slot) = self.guard.lock() {
            *slot = None;
        }
    }
}

#[tauri::command]
pub fn set_keep_awake(enabled: bool, state: State<'_, KeepAwakeState>) -> Result<bool, String> {
    state.set(enabled)
}

#[tauri::command]
pub fn get_keep_awake(state: State<'_, KeepAwakeState>) -> bool {
    state.is_enabled()
}
