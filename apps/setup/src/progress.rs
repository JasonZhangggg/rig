//! The progress bar's position. NSIS run with /S reports nothing while it
//! works, so setup works it out from what it can see: how much of Rig is on
//! disk yet (a first install), how long it's been (an update, whose files are
//! already there), and whether Windows is showing its permission prompt.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Files,
    Permission,
    Recorder,
    Finishing,
    Removing,
    Cleaning,
}

/// What setup saw on one look.
#[derive(Debug, Clone, Copy)]
pub struct Look {
    /// How far the files are, 0 to 1 (from bytes on disk, or from time when that can't tell).
    pub files: f64,
    /// Windows' permission prompt is up.
    pub prompt: bool,
    /// Seconds since the last change of step.
    pub since: f64,
}

/// Follows the steps and keeps the bar from ever going back.
#[derive(Debug)]
pub struct Tracker {
    pub step: Step,
    pub progress: f64,
    removing: bool,
    prompted: bool,
}

/// 0..1 that slows as it nears the end, for waits of unknown length.
fn creep(seconds: f64, half: f64) -> f64 {
    1.0 - 0.5f64.powf(seconds / half)
}

impl Tracker {
    pub fn install() -> Self { Tracker { step: Step::Files, progress: 0.03, removing: false, prompted: false } }
    pub fn uninstall() -> Self { Tracker { step: Step::Removing, progress: 0.03, removing: true, prompted: false } }

    /// Takes one look and says where the bar is.
    pub fn look(&mut self, l: Look) -> (Step, f64) {
        let next = if l.prompt {
            self.prompted = true;
            Step::Permission
        } else if self.removing {
            if self.prompted { Step::Cleaning } else { Step::Removing }
        } else if self.prompted {
            Step::Recorder
        } else if l.files >= 1.0 {
            Step::Finishing
        } else {
            Step::Files
        };
        let f = l.files.clamp(0.0, 1.0);
        let target = match next {
            Step::Files | Step::Removing => 0.03 + 0.67 * f,
            Step::Finishing => 0.70 + 0.25 * creep(l.since, 3.0),
            Step::Permission => self.progress.max(0.72),
            Step::Recorder | Step::Cleaning => 0.78 + 0.18 * creep(l.since, 4.0),
        };
        self.step = next;
        self.progress = self.progress.max(target.min(0.97));
        (self.step, self.progress)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_through_the_steps_of_an_install_and_never_goes_back() {
        let mut t = Tracker::install();
        let mut last = 0.0;
        let looks = [
            (0.2, false, Step::Files),
            (0.9, false, Step::Files),
            (1.0, false, Step::Finishing),
            (1.0, true, Step::Permission),
            (1.0, false, Step::Recorder),
        ];
        for (files, prompt, want) in looks {
            let (step, p) = t.look(Look { files, prompt, since: 1.0 });
            assert_eq!(step, want);
            assert!(p >= last && p < 1.0, "{p} after {last}");
            last = p;
        }
    }

    #[test]
    fn an_uninstall_says_removing_then_tidying_after_the_prompt() {
        let mut t = Tracker::uninstall();
        assert_eq!(t.look(Look { files: 0.5, prompt: false, since: 0.0 }).0, Step::Removing);
        assert_eq!(t.look(Look { files: 0.5, prompt: true, since: 0.0 }).0, Step::Permission);
        assert_eq!(t.look(Look { files: 0.5, prompt: false, since: 0.0 }).0, Step::Cleaning);
    }

    #[test]
    fn a_long_wait_never_fills_the_bar() {
        let mut t = Tracker::install();
        let (_, p) = t.look(Look { files: 1.0, prompt: false, since: 600.0 });
        assert!(p < 1.0);
    }
}
