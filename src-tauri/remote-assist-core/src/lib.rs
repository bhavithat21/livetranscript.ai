//! Platform-independent safety policy used by the native remote assistance
//! worker. Time is monotonic milliseconds from session creation, never wall time.
use serde::{Deserialize, Serialize};

pub const LEASE_MS: u64 = 5_000;
pub const MAX_SESSION_MS: u64 = 3_600_000;
pub const MAX_FRAME_BYTES: usize = 524_288;
pub const MAX_EVENTS_PER_SECOND: u32 = 240;
pub const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: String,
    pub name: String,
    /// Global input coordinates: logical points on macOS; physical pixels on
    /// Windows. Negative origins are valid. Scale factor is informational.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
}

impl Display {
    pub fn validate(&self) -> Result<(), String> {
        if self.width == 0
            || self.height == 0
            || self.width > 32_768
            || self.height > 32_768
            || u64::from(self.width) * u64::from(self.height) > 67_108_864
            || !self.scale_factor.is_finite()
            || self.scale_factor <= 0.0
            || i64::from(self.x) + i64::from(self.width) > i64::from(i32::MAX)
            || i64::from(self.y) + i64::from(self.height) > i64::from(i32::MAX)
        {
            return Err("This display has unsupported dimensions. Choose another display.".into());
        }
        Ok(())
    }

    pub fn point(&self, x: f64, y: f64) -> Result<(i32, i32), String> {
        self.validate()?;
        if !x.is_finite()
            || !y.is_finite()
            || !(0.0..=1.0).contains(&x)
            || !(0.0..=1.0).contains(&y)
        {
            return Err("Pointer coordinates must be within the selected display.".into());
        }
        Ok((
            self.x + (x * f64::from(self.width - 1)).round() as i32,
            self.y + (y * f64::from(self.height - 1)).round() as i32,
        ))
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Middle,
    Right,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum InputEvent {
    Move {
        seq: u64,
        x: f64,
        y: f64,
    },
    Button {
        seq: u64,
        button: MouseButton,
        down: bool,
    },
    Key {
        seq: u64,
        key: String,
        down: bool,
    },
    Scroll {
        seq: u64,
        #[serde(rename = "deltaX")]
        delta_x: i32,
        #[serde(rename = "deltaY")]
        delta_y: i32,
    },
    Text {
        seq: u64,
        text: String,
    },
}

impl InputEvent {
    pub fn sequence(&self) -> u64 {
        match self {
            Self::Move { seq, .. }
            | Self::Button { seq, .. }
            | Self::Key { seq, .. }
            | Self::Scroll { seq, .. }
            | Self::Text { seq, .. } => *seq,
        }
    }

    pub fn validate(&self, display: &Display) -> Result<(), String> {
        match self {
            Self::Move { x, y, .. } => {
                display.point(*x, *y)?;
            }
            Self::Key { key, .. } if !valid_key(key) => {
                return Err("Unsupported keyboard key.".into())
            }
            Self::Scroll {
                delta_x, delta_y, ..
            } if !(-20..=20).contains(delta_x) || !(-20..=20).contains(delta_y) => {
                return Err("Scroll input exceeds the per-event limit.".into());
            }
            Self::Text { text, .. }
                if text.is_empty()
                    || text.len() > 4_000
                    || text.encode_utf16().count() > 1_000
                    || text.contains('\0') =>
            {
                return Err(
                    "Text input must contain at most 1,000 characters and no NUL bytes.".into(),
                );
            }
            _ => {}
        }
        Ok(())
    }
}

pub fn valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    if let Some(ch) = chars.next() {
        if chars.next().is_none() {
            return !ch.is_control();
        }
    }
    matches!(
        key,
        "Enter"
            | "Tab"
            | "Backspace"
            | "Delete"
            | "Escape"
            | "ArrowUp"
            | "ArrowDown"
            | "ArrowLeft"
            | "ArrowRight"
            | "Home"
            | "End"
            | "PageUp"
            | "PageDown"
            | "Insert"
            | "Shift"
            | "Control"
            | "Alt"
            | "Meta"
            | "CapsLock"
            | "F1"
            | "F2"
            | "F3"
            | "F4"
            | "F5"
            | "F6"
            | "F7"
            | "F8"
            | "F9"
            | "F10"
            | "F11"
            | "F12"
    )
}

#[derive(Debug, Default)]
pub struct LeasePolicy {
    last_heartbeat: u64,
    last_sequence: u64,
    rate_window: u64,
    rate_count: u32,
    control: bool,
    stopped: bool,
}

impl LeasePolicy {
    pub fn check_live(&self, now: u64) -> Result<(), String> {
        if self.stopped {
            return Err("Remote assistance has stopped.".into());
        }
        if now >= MAX_SESSION_MS {
            return Err("The one-hour remote assistance session has ended.".into());
        }
        if now.saturating_sub(self.last_heartbeat) >= LEASE_MS {
            return Err(
                "Remote assistance disconnected: no controller heartbeat for 5 seconds.".into(),
            );
        }
        Ok(())
    }

    pub fn heartbeat(&mut self, now: u64) -> Result<(), String> {
        // A delayed heartbeat must never revive an expired lease.
        self.check_live(now)?;
        if now < self.last_heartbeat {
            return Err("Invalid monotonic clock.".into());
        }
        self.last_heartbeat = now;
        Ok(())
    }

    pub fn set_control(&mut self, enabled: bool, now: u64) -> Result<(), String> {
        self.check_live(now)?;
        self.control = enabled;
        Ok(())
    }

    pub fn accept(
        &mut self,
        event: &InputEvent,
        display: &Display,
        now: u64,
    ) -> Result<(), String> {
        self.check_live(now)?;
        if !self.control {
            return Err("Remote control has not been enabled on this laptop.".into());
        }
        event.validate(display)?;
        let seq = event.sequence();
        if seq <= self.last_sequence || seq > MAX_SEQUENCE {
            return Err("Remote input sequence was replayed or is invalid.".into());
        }
        if now.saturating_sub(self.rate_window) >= 1_000 {
            self.rate_window = now;
            self.rate_count = 0;
        }
        if self.rate_count >= MAX_EVENTS_PER_SECOND {
            return Err("Remote input is arriving too quickly.".into());
        }
        self.last_sequence = seq;
        self.rate_count += 1;
        Ok(())
    }

    pub fn stop(&mut self) {
        self.stopped = true;
        self.control = false;
    }

    pub fn control_enabled(&self) -> bool {
        self.control && !self.stopped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display() -> Display {
        Display {
            id: "2".into(),
            name: "Left retina display".into(),
            x: -1920,
            y: -200,
            width: 1920,
            height: 1080,
            scale_factor: 2.0,
            is_primary: false,
        }
    }

    #[test]
    fn points_stay_in_selected_display_with_negative_origin_and_hidpi() {
        let d = display();
        assert_eq!(d.point(0.0, 0.0).unwrap(), (-1920, -200));
        assert_eq!(d.point(1.0, 1.0).unwrap(), (-1, 879));
        assert_eq!(d.point(0.5, 0.5).unwrap(), (-960, 340));
        for v in [f64::NAN, f64::INFINITY, -0.01, 1.01] {
            assert!(d.point(v, 0.5).is_err());
        }
    }

    #[test]
    fn stopped_and_expired_leases_cannot_be_revived() {
        let mut p = LeasePolicy::default();
        assert!(p.heartbeat(4_999).is_ok());
        assert!(p.heartbeat(9_999).is_err());
        assert!(p.set_control(true, 9_999).is_err());
        p.stop();
        assert!(p.heartbeat(4_999).is_err());
    }

    #[test]
    fn session_has_absolute_maximum_even_with_heartbeats() {
        let mut p = LeasePolicy::default();
        for now in (1_000..MAX_SESSION_MS).step_by(1_000) {
            p.heartbeat(now).unwrap();
        }
        assert!(p.heartbeat(MAX_SESSION_MS).is_err());
    }

    #[test]
    fn view_only_replay_and_revocation_do_not_extend_authority() {
        let d = display();
        let mut p = LeasePolicy::default();
        let event = InputEvent::Move {
            seq: 1,
            x: 0.5,
            y: 0.5,
        };
        assert!(p.accept(&event, &d, 1).is_err());
        p.set_control(true, 2).unwrap();
        p.accept(&event, &d, 3).unwrap();
        assert!(p.accept(&event, &d, 4).is_err());
        p.set_control(false, 5).unwrap();
        assert!(p
            .accept(
                &InputEvent::Key {
                    seq: 2,
                    key: "a".into(),
                    down: true
                },
                &d,
                6
            )
            .is_err());
        p.set_control(true, 7).unwrap();
        assert!(p.accept(&event, &d, 8).is_err());
        assert!(p
            .accept(
                &InputEvent::Move {
                    seq: 3,
                    x: 0.5,
                    y: 0.5
                },
                &d,
                LEASE_MS
            )
            .is_err());
    }

    #[test]
    fn malformed_and_excessive_input_is_rejected() {
        let d = display();
        let mut p = LeasePolicy::default();
        p.set_control(true, 0).unwrap();
        let invalid = InputEvent::Move {
            seq: 1,
            x: 2.0,
            y: 0.5,
        };
        assert!(p.accept(&invalid, &d, 1).is_err());
        for seq in 1..=u64::from(MAX_EVENTS_PER_SECOND) {
            p.accept(
                &InputEvent::Move {
                    seq,
                    x: 0.5,
                    y: 0.5,
                },
                &d,
                2,
            )
            .unwrap();
        }
        assert!(p
            .accept(
                &InputEvent::Move {
                    seq: 241,
                    x: 0.5,
                    y: 0.5
                },
                &d,
                3
            )
            .is_err());
        p.accept(
            &InputEvent::Move {
                seq: 241,
                x: 0.5,
                y: 0.5,
            },
            &d,
            1_002,
        )
        .unwrap();
        assert!(InputEvent::Scroll {
            seq: 242,
            delta_x: i32::MIN,
            delta_y: 1
        }
        .validate(&d)
        .is_err());
        assert!(InputEvent::Text {
            seq: 243,
            text: "😀".repeat(501)
        }
        .validate(&d)
        .is_err());
        assert!(InputEvent::Text {
            seq: 244,
            text: "a\0b".into()
        }
        .validate(&d)
        .is_err());
    }

    #[test]
    fn wire_parser_rejects_unknown_actions_and_fields() {
        assert!(
            serde_json::from_str::<InputEvent>(r#"{"seq":1,"type":"shell","command":"open"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<InputEvent>(
            r#"{"seq":1,"type":"move","x":0,"y":0,"extra":true}"#
        )
        .is_err());
        assert!(serde_json::from_str::<InputEvent>(
            r#"{"seq":-1,"type":"key","key":"a","down":true}"#
        )
        .is_err());
        assert!(valid_key(" "));
        assert!(valid_key("é"));
        assert!(valid_key("F12"));
        assert!(!valid_key("\u{7f}"));
        assert!(!valid_key("AudioVolumeUp"));
        assert!(!valid_key("abcd"));
    }
}
