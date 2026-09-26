//! Mouse pass-through state machine. No input hooks, forwarding or capture.
//! All real window operations are serialized onto Tauri's main thread.

pub trait PointerWindow {
    fn topmost(&self) -> Result<bool, String>;
    fn set_topmost(&self, value: bool) -> Result<(), String>;
    fn ignore_mouse(&self, value: bool) -> Result<(), String>;
}

#[derive(Default)]
pub struct PointerMode {
    pub locked: bool,
    pub revision: u64,
    previous_topmost: Option<bool>,
}

impl PointerMode {
    pub fn apply<W: PointerWindow>(
        &mut self,
        window: &W,
        enabled: bool,
        recovery_available: bool,
    ) -> Result<(), String> {
        if enabled {
            if self.locked { return Ok(()); }
            if !recovery_available {
                return Err("Pass-through requires a registered recovery shortcut or tray control.".into());
            }
            let previous = window.topmost()?;
            // Change stacking first: failure must not leave an unclickable window.
            window.set_topmost(true)?;
            if let Err(error) = window.ignore_mouse(true) {
                return match window.set_topmost(previous) {
                    Ok(()) => Err(error),
                    Err(rollback) => Err(format!("{error}; restoring window stacking also failed: {rollback}")),
                };
            }
            self.previous_topmost = Some(previous);
            self.locked = true;
            self.revision += 1;
        } else {
            // Idempotent recovery also repairs unexpected native state. Restore
            // mouse input before attempting the cosmetic stacking restoration.
            window.ignore_mouse(false)?;
            self.locked = false;
            self.revision += 1;
            if let Some(previous) = self.previous_topmost {
                window.set_topmost(previous)?;
                self.previous_topmost = None;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Window {
        calls: RefCell<Vec<String>>,
        top: RefCell<bool>,
        ignored: RefCell<bool>,
        fail: RefCell<Option<&'static str>>,
    }
    impl Window {
        fn call(&self, name: String) -> Result<(), String> {
            self.calls.borrow_mut().push(name.clone());
            if *self.fail.borrow() == Some(name.as_str()) {
                self.fail.replace(None);
                return Err(name);
            }
            Ok(())
        }
    }
    impl PointerWindow for Window {
        fn topmost(&self) -> Result<bool, String> { self.call("read".into())?; Ok(*self.top.borrow()) }
        fn set_topmost(&self, value: bool) -> Result<(), String> {
            self.call(format!("top:{value}"))?; self.top.replace(value); Ok(())
        }
        fn ignore_mouse(&self, value: bool) -> Result<(), String> {
            self.call(format!("ignore:{value}"))?; self.ignored.replace(value); Ok(())
        }
    }
    #[test]
    fn starts_interactive_and_does_not_restore_a_saved_lock() {
        assert!(!PointerMode::default().locked);
    }
    #[test]
    fn refuses_to_lock_without_a_recovery_path() {
        let mut state = PointerMode::default(); let win = Window::default();
        assert!(state.apply(&win, true, false).is_err());
        assert!(win.calls.borrow().is_empty()); assert!(!state.locked);
    }
    #[test]
    fn enables_mouse_passthrough_and_pins_without_double_dispatch() {
        let mut state = PointerMode::default(); let win = Window::default();
        state.apply(&win, true, true).unwrap();
        assert!(state.locked && *win.ignored.borrow() && *win.top.borrow());
        assert_eq!(*win.calls.borrow(), vec!["read", "top:true", "ignore:true"]);
        state.apply(&win, true, true).unwrap(); assert_eq!(win.calls.borrow().len(), 3);
    }
    #[test]
    fn unlock_restores_previous_stacking_and_input_first() {
        let mut state = PointerMode::default(); let win = Window::default();
        state.apply(&win, true, true).unwrap(); state.apply(&win, false, true).unwrap();
        assert!(!state.locked && !*win.ignored.borrow() && !*win.top.borrow());
        assert_eq!(&win.calls.borrow()[3..], &["ignore:false", "top:false"]);
    }
    #[test]
    fn preserves_a_window_that_was_already_topmost() {
        let mut state = PointerMode::default(); let win = Window::default(); win.top.replace(true);
        state.apply(&win, true, true).unwrap(); state.apply(&win, false, true).unwrap();
        assert!(*win.top.borrow());
    }
    #[test]
    fn failed_stacking_change_never_disables_mouse_input() {
        let mut state = PointerMode::default(); let win = Window::default(); win.fail.replace(Some("top:true"));
        assert!(state.apply(&win, true, true).is_err());
        assert!(!state.locked && !*win.ignored.borrow());
    }
    #[test]
    fn failed_mouse_toggle_rolls_back_stacking() {
        let mut state = PointerMode::default(); let win = Window::default(); win.fail.replace(Some("ignore:true"));
        assert!(state.apply(&win, true, true).is_err());
        assert!(!state.locked && !*win.ignored.borrow() && !*win.top.borrow());
    }
    #[test]
    fn unlock_failure_retains_locked_state_for_retry() {
        let mut state = PointerMode::default(); let win = Window::default();
        state.apply(&win, true, true).unwrap(); win.fail.replace(Some("ignore:false"));
        assert!(state.apply(&win, false, true).is_err()); assert!(state.locked);
        state.apply(&win, false, false).unwrap(); assert!(!state.locked);
    }
    #[test]
    fn stacking_restore_failure_still_leaves_mouse_interactive() {
        let mut state = PointerMode::default(); let win = Window::default();
        state.apply(&win, true, true).unwrap(); win.fail.replace(Some("top:false"));
        assert!(state.apply(&win, false, true).is_err());
        assert!(!state.locked && !*win.ignored.borrow());
        state.apply(&win, false, false).unwrap(); assert!(!*win.top.borrow());
    }
    #[test]
    fn repeated_toggles_follow_actual_state_and_revisions() {
        let mut state = PointerMode::default(); let win = Window::default();
        for _ in 0..40 { let next = !state.locked; state.apply(&win, next, true).unwrap(); }
        assert!(!state.locked && !*win.ignored.borrow()); assert_eq!(state.revision, 40);
    }
}
