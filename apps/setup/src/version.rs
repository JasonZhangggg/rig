//! Comparing Rig's versions, like Tauri's installer does.

/// Whether version `a` is newer than `b` ("0.1.10" is newer than "0.1.9"; "0.2.0-beta.1" is older than "0.2.0").
pub fn newer(a: &str, b: &str) -> bool {
    fn parts(v: &str) -> (Vec<u64>, bool) {
        let (core, pre) = v.split_once('-').map_or((v, false), |(c, _)| (c, true));
        (core.split('.').map(|n| n.trim().parse().unwrap_or(0)).collect(), pre)
    }
    let ((a, a_pre), (b, b_pre)) = (parts(a), parts(b));
    a > b || (a == b && b_pre && !a_pre)
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn compares_numbers_not_text() {
        assert!(newer("0.1.10", "0.1.9"));
        assert!(!newer("0.1.9", "0.1.10"));
        assert!(!newer("0.1.7", "0.1.7"));
        assert!(newer("1.0.0", "0.9.9"));
    }

    #[test]
    fn a_release_is_newer_than_its_pre_release() {
        assert!(newer("0.2.0", "0.2.0-beta.1"));
        assert!(!newer("0.2.0-beta.1", "0.2.0"));
    }
}
