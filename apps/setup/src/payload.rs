//! The installer that rig-setup.exe carries. tools/setup.mjs appends Tauri's
//! NSIS installer to the end of the exe, then a little JSON about it, then a
//! trailer: the installer's length, the JSON's length (both u64, little end)
//! and the 8 bytes `RIGSETUP`. A copy without a trailer is the uninstaller
//! that sits in Rig's folder.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

pub const MAGIC: &[u8; 8] = b"RIGSETUP";
const TRAILER: u64 = 24;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    /// Rig's version in the installer, like "0.1.7".
    pub version: String,
    /// About how many bytes Rig takes once installed, for the progress bar.
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Payload {
    pub meta: Meta,
    pub offset: u64,
    pub len: u64,
}

/// Finds the installer at the end of `exe`, or None when it has none.
pub fn find(exe: &Path) -> io::Result<Option<Payload>> {
    let mut f = File::open(exe)?;
    let total = f.metadata()?.len();
    if total < TRAILER {
        return Ok(None);
    }
    let mut t = [0u8; TRAILER as usize];
    f.seek(SeekFrom::Start(total - TRAILER))?;
    f.read_exact(&mut t)?;
    if &t[16..] != MAGIC {
        return Ok(None);
    }
    let len = u64::from_le_bytes(t[0..8].try_into().unwrap());
    let meta_len = u64::from_le_bytes(t[8..16].try_into().unwrap());
    let bad = || io::Error::new(io::ErrorKind::InvalidData, "Setup's installer is damaged. Download it again.");
    let end = total - TRAILER;
    if meta_len > end || len > end - meta_len || meta_len > 64 * 1024 {
        return Err(bad());
    }
    let mut meta = vec![0u8; meta_len as usize];
    f.seek(SeekFrom::Start(end - meta_len))?;
    f.read_exact(&mut meta)?;
    let meta: Meta = serde_json::from_slice(&meta).map_err(|_| bad())?;
    Ok(Some(Payload { meta, offset: end - meta_len - len, len }))
}

/// Copies the installer out of `exe` into `dest`.
pub fn extract(exe: &Path, p: &Payload, dest: &Path) -> io::Result<()> {
    let mut f = File::open(exe)?;
    f.seek(SeekFrom::Start(p.offset))?;
    let mut out = File::create(dest)?;
    let copied = io::copy(&mut f.take(p.len), &mut out)?;
    if copied != p.len {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "Setup's installer is cut short. Download it again."));
    }
    out.flush()
}

/// Writes `stub` + `installer` + meta + trailer to `out`. tools/setup.mjs does the same; this one is for tests.
#[cfg(test)]
pub fn pack(stub: &[u8], installer: &[u8], meta: &Meta, out: &mut impl Write) -> io::Result<()> {
    let m = serde_json::to_vec(meta)?;
    out.write_all(stub)?;
    out.write_all(installer)?;
    out.write_all(&m)?;
    out.write_all(&(installer.len() as u64).to_le_bytes())?;
    out.write_all(&(m.len() as u64).to_le_bytes())?;
    out.write_all(MAGIC)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("rig-setup-test-{}-{name}", std::process::id()));
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn finds_and_extracts_the_installer() {
        let meta = Meta { version: "0.1.7".into(), size: 1234 };
        let mut buf = Vec::new();
        pack(b"MZ-stub", b"NSIS-installer-bytes", &meta, &mut buf).unwrap();
        let exe = temp("packed.exe", &buf);
        let p = find(&exe).unwrap().expect("a payload");
        assert_eq!(p.meta, meta);
        let out = exe.with_extension("out");
        extract(&exe, &p, &out).unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), b"NSIS-installer-bytes");
    }

    #[test]
    fn a_plain_exe_has_no_installer() {
        assert_eq!(find(&temp("plain.exe", b"MZ just the uninstaller, with no trailer at all")).unwrap(), None);
        assert_eq!(find(&temp("tiny.exe", b"MZ")).unwrap(), None);
    }

    #[test]
    fn a_damaged_trailer_is_an_error_not_a_crash() {
        let mut buf = b"MZ".to_vec();
        buf.extend_from_slice(&u64::MAX.to_le_bytes());
        buf.extend_from_slice(&10u64.to_le_bytes());
        buf.extend_from_slice(MAGIC);
        assert!(find(&temp("bad.exe", &buf)).is_err());
    }
}
