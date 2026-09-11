//! Unix spawn path for the retained Postgres lease.
//!
//! The platform-neutral `spawn_child` in `retained_postgres.rs` builds the
//! std `Command` (argument order, environment merge, cwd); this module applies
//! the Unix identity setup that must happen between `fork` and `exec` and
//! attaches the caller's log-file stdio, so the retained child handle is
//! exactly the one `Command::spawn` returned.

use std::{
	io,
	os::unix::process::CommandExt,
	process::{Child, Command, Stdio},
};

pub fn configure_process(command: &mut Command, uid: Option<u32>, gid: Option<u32>) {
	// Keep all identity syscalls in one pre-exec closure: CommandExt applies
	// `gid` before its implicit supplementary-group cleanup, while clearing
	// groups must happen before either setgid or setuid drops root privileges.
	// An omitted uid/gid remains omitted, and an explicit zero remains an
	// explicit root identity rather than being treated as a missing option.
	unsafe {
		command.pre_exec(move || {
			if libc::setsid() == -1 {
				return Err(io::Error::last_os_error());
			}
			#[cfg(not(target_os = "redox"))]
			if libc::geteuid() == 0
				&& uid.is_some_and(|target_uid| target_uid != 0)
				&& libc::setgroups(0, std::ptr::null()) == -1
			{
				return Err(io::Error::last_os_error());
			}
			if let Some(gid) = gid
				&& libc::setgid(gid as libc::gid_t) == -1
			{
				return Err(io::Error::last_os_error());
			}
			if let Some(uid) = uid
				&& libc::setuid(uid as libc::uid_t) == -1
			{
				return Err(io::Error::last_os_error());
			}
			Ok(())
		});
	}
}

pub fn spawn(
	command: &mut Command,
	stdout: &std::fs::File,
	stderr: &std::fs::File,
) -> io::Result<Child> {
	command
		.stdin(Stdio::null())
		.stdout(Stdio::from(stdout.try_clone()?))
		.stderr(Stdio::from(stderr.try_clone()?));
	command.spawn()
}
