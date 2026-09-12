//! Failure/lifetime checks for the actual suspended handle-container. All job
//! mutations and abrupt exits run in disposable fixtures, never the test host.
use super::*;
use std::{
	fs,
	io::BufRead,
	os::windows::io::{AsRawHandle, FromRawHandle},
	time::Duration,
};
use windows_sys::Win32::{
	Foundation::{GetHandleInformation, HANDLE_FLAG_INHERIT, WAIT_TIMEOUT},
	System::{JobObjects::*, Threading::GetProcessTimes},
};

const FIXTURE: &str = "ATOMIC_CONTAINER_LIFECYCLE";
const TEST_NAME: &str = "container_lifecycle_fixture";

fn duplicate_local(handle: HANDLE) -> OwnedHandle {
	let mut copy = ptr::null_mut();
	assert_ne!(
		unsafe {
			DuplicateHandle(
				GetCurrentProcess(),
				handle,
				GetCurrentProcess(),
				&mut copy,
				0,
				0,
				DUPLICATE_SAME_ACCESS,
			)
		},
		0
	);
	OwnedHandle(copy)
}

fn member(process: HANDLE, job: HANDLE) -> bool {
	let mut result = 0;
	assert_ne!(unsafe { IsProcessInJob(process, job, &mut result) }, 0);
	result != 0
}

fn assert_noninheritable(handle: HANDLE) {
	let mut flags = 0;
	assert_ne!(unsafe { GetHandleInformation(handle, &mut flags) }, 0);
	assert_eq!(flags & HANDLE_FLAG_INHERIT, 0);
}

fn job(flags: u32, active_limit: u32) -> OwnedHandle {
	let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
	assert!(!handle.is_null());
	let result = OwnedHandle(handle);
	let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
	limits.BasicLimitInformation.LimitFlags = flags;
	limits.BasicLimitInformation.ActiveProcessLimit = active_limit;
	assert_ne!(
		unsafe {
			SetInformationJobObject(
				handle,
				JobObjectExtendedLimitInformation,
				(&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
				size_of_val(&limits) as u32,
			)
		},
		0
	);
	result
}

struct SuspendedChild {
	handle: HANDLE,
}

impl Drop for SuspendedChild {
	fn drop(&mut self) {
		// Test assertions must not strand their own never-run control process.
		unsafe {
			windows_sys::Win32::System::Threading::TerminateProcess(self.handle, 0);
			WaitForSingleObject(self.handle, 5000);
			CloseHandle(self.handle);
		}
	}
}

// Deliberately suspended direct control; it never executes test code. Only
// tests use this helper, and every returned exact creation handle is reaped.
fn suspended(parent: Option<HANDLE>) -> SuspendedChild {
	let parents = [parent.unwrap_or_else(|| unsafe { GetCurrentProcess() })];
	let attributes =
		HandleAttributeList::new(&[(PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, &parents)]).unwrap();
	let startup = STARTUPINFOEXW {
		StartupInfo: STARTUPINFOW { cb: size_of::<STARTUPINFOEXW>() as u32, ..Default::default() },
		lpAttributeList: attributes.list,
	};
	let application = wide(std::env::current_exe().unwrap().as_os_str());
	let mut info = PROCESS_INFORMATION::default();
	assert_ne!(
		unsafe {
			CreateProcessW(
				application.as_ptr(),
				ptr::null_mut(),
				ptr::null(),
				ptr::null(),
				0,
				CREATION_FLAGS | CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT,
				ptr::null(),
				ptr::null(),
				&startup.StartupInfo,
				&mut info,
			)
		},
		0,
		"{}",
		last_error()
	);
	drop(OwnedHandle(info.hThread));
	SuspendedChild { handle: info.hProcess }
}

fn reap_suspended(child: SuspendedChild) {
	assert_ne!(
		unsafe { windows_sys::Win32::System::Threading::TerminateProcess(child.handle, 0) },
		0
	);
	assert_eq!(unsafe { WaitForSingleObject(child.handle, 5000) }, WAIT_OBJECT_0);
}

#[test]
fn container_disposal_and_unwind_never_execute_or_kill_the_real_child() {
	for unwind in [false, true] {
		let container = HandleContainer::new().unwrap();
		assert_noninheritable(container.process.0);
		assert_noninheritable(container.job.as_ref().unwrap().0);
		assert!(member(container.process.0, container.job.as_ref().unwrap().0));
		let observer = duplicate_local(container.process.0);
		assert_eq!(unsafe { WaitForSingleObject(observer.0, 100) }, WAIT_TIMEOUT);
		let mut creation = Default::default();
		let mut exit = Default::default();
		let mut kernel = Default::default();
		let mut user = Default::default();
		assert_ne!(
			unsafe { GetProcessTimes(observer.0, &mut creation, &mut exit, &mut kernel, &mut user) },
			0
		);
		assert_eq!(
			(user.dwHighDateTime, user.dwLowDateTime),
			(0, 0),
			"container must never run user/loader code"
		);
		let real = suspended(Some(container.process.0));
		assert!(!member(real.handle, container.job.as_ref().unwrap().0));
		if unwind {
			assert!(
				std::panic::catch_unwind(|| {
					let _owned = container;
					panic!("test unwind");
				})
				.is_err()
			);
		} else {
			drop(container);
		}
		assert_eq!(unsafe { WaitForSingleObject(observer.0, 0) }, WAIT_OBJECT_0);
		assert_eq!(unsafe { WaitForSingleObject(real.handle, 0) }, WAIT_TIMEOUT);
		reap_suspended(real);
	}
}

fn fixture(mode: &str) -> Command {
	let mut command = Command::new(std::env::current_exe().unwrap());
	command.args([TEST_NAME, "--nocapture"]).env(FIXTURE, mode);
	configure_process(&mut command, None, None);
	command
}

#[test]
fn container_terminated_before_setup_fails_closed() {
	let container = HandleContainer::new().unwrap();
	let observer = duplicate_local(container.process.0);
	assert_ne!(unsafe { windows_sys::Win32::System::Threading::TerminateProcess(observer.0, 1) }, 0);
	assert_eq!(unsafe { WaitForSingleObject(observer.0, 5000) }, WAIT_OBJECT_0);
	let log = fs::File::open("NUL").unwrap();
	assert!(container.stdio(log.as_raw_handle(), log.as_raw_handle()).is_err());
	drop(container);
	assert_eq!(unsafe { WaitForSingleObject(observer.0, 0) }, WAIT_OBJECT_0);
}

#[test]
fn container_outer_jobs_and_creation_failures_preserve_cleanup() {
	for mode in ["normal", "breakaway", "silent", "ui", "helper-failure", "real-failure"] {
		let result = fixture(mode).output().unwrap();
		assert!(
			result.status.success(),
			"{mode}: {}{}",
			String::from_utf8_lossy(&result.stdout),
			String::from_utf8_lossy(&result.stderr)
		);
	}
}

#[test]
fn container_abort_and_launcher_termination_close_remote_files() {
	for mode in ["abort-empty", "abort-stdio", "terminate-stdio", "abort-real", "terminate-real"] {
		let root = std::env::temp_dir().join(format!(
			"atomic-container-{}-{mode}-{}",
			std::process::id(),
			std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
		));
		fs::create_dir(&root).unwrap();
		// Pass a real noninheritable duplicate through std's stdin duplication.
		// The fixture can transfer an observation HANDLE back without PID lookup.
		let parent = duplicate_local(unsafe { GetCurrentProcess() });
		let parent = std::mem::ManuallyDrop::new(parent);
		let stdin = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(parent.0) };
		let mut launcher = fixture(mode)
			.current_dir(&root)
			.stdin(Stdio::from(stdin))
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.spawn()
			.unwrap();
		let mut lines = std::io::BufReader::new(launcher.stdout.take().unwrap()).lines();
		let transferred = loop {
			let line = lines.next().expect("fixture ended before HANDLE transfer").unwrap();
			if let Some(value) = line.strip_prefix("container-observer=") {
				break value
					.split_whitespace()
					.map(|value| value.parse::<usize>().unwrap())
					.collect::<Vec<_>>();
			}
		};
		let observer = OwnedHandle(transferred[0] as HANDLE);
		let real = transferred.get(1).map(|handle| SuspendedChild { handle: *handle as HANDLE });
		assert_eq!(unsafe { WaitForSingleObject(observer.0, 0) }, WAIT_TIMEOUT);
		if mode.starts_with("terminate") {
			launcher.kill().unwrap();
		} else {
			fs::write(root.join("abort-now"), "go").unwrap();
		}
		assert!(!launcher.wait().unwrap().success());
		assert_eq!(
			unsafe { WaitForSingleObject(observer.0, 5000) },
			WAIT_OBJECT_0,
			"crash must reap container"
		);
		if let Some(real) = real {
			assert_eq!(
				unsafe { WaitForSingleObject(real.handle, 0) },
				WAIT_TIMEOUT,
				"launcher crash must not add kill-on-close to the real child"
			);
			reap_suspended(real);
		}
		if !mode.ends_with("empty") {
			use std::os::windows::fs::OpenOptionsExt;
			let file = fs::OpenOptions::new()
				.read(true)
				.write(true)
				.share_mode(0)
				.open(root.join("exclusive.log"))
				.unwrap();
			drop(file);
		}
		fs::remove_dir_all(root).unwrap();
	}
}

#[test]
fn container_lifecycle_fixture() {
	let Ok(mode) = std::env::var(FIXTURE) else { return };
	if mode.starts_with("abort") || mode.starts_with("terminate") {
		let container = HandleContainer::new().unwrap();
		if !mode.ends_with("empty") {
			use std::os::windows::fs::OpenOptionsExt;
			let log = fs::OpenOptions::new()
				.create_new(true)
				.write(true)
				.share_mode(0)
				.open("exclusive.log")
				.unwrap();
			container.stdio(log.as_raw_handle(), log.as_raw_handle()).unwrap();
		}
		let parent = unsafe {
			windows_sys::Win32::System::Console::GetStdHandle(
				windows_sys::Win32::System::Console::STD_INPUT_HANDLE,
			)
		};
		let transfer = |handle| {
			let mut transferred = ptr::null_mut();
			assert_ne!(
				unsafe {
					DuplicateHandle(
						GetCurrentProcess(),
						handle,
						parent,
						&mut transferred,
						0,
						0,
						DUPLICATE_SAME_ACCESS,
					)
				},
				0
			);
			transferred as usize
		};
		let real = mode.ends_with("real").then(|| suspended(Some(container.process.0)));
		let real_observer =
			real.as_ref().map(|child| format!(" {}", transfer(child.handle))).unwrap_or_default();
		println!("container-observer={}{real_observer}", transfer(container.process.0));
		let deadline = std::time::Instant::now() + Duration::from_secs(10);
		while !Path::new("abort-now").exists() {
			assert!(std::time::Instant::now() < deadline);
			std::thread::sleep(Duration::from_millis(5));
		}
		std::process::abort();
	}
	// Warm the identical OS process creation facility before handle accounting.
	reap_suspended(suspended(None));
	let (flags, limit) = match mode.as_str() {
		"breakaway" => (JOB_OBJECT_LIMIT_BREAKAWAY_OK, 0),
		"silent" => (JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK, 0),
		"helper-failure" => (JOB_OBJECT_LIMIT_ACTIVE_PROCESS, 1),
		"real-failure" => (JOB_OBJECT_LIMIT_ACTIVE_PROCESS, 2),
		_ => (0, 0),
	};
	let outer = job(flags, limit);
	assert_ne!(unsafe { AssignProcessToJobObject(outer.0, GetCurrentProcess()) }, 0);
	if mode == "ui" {
		let limits =
			JOBOBJECT_BASIC_UI_RESTRICTIONS { UIRestrictionsClass: JOB_OBJECT_UILIMIT_READCLIPBOARD };
		assert_ne!(
			unsafe {
				SetInformationJobObject(
					outer.0,
					JobObjectBasicUIRestrictions,
					(&limits as *const JOBOBJECT_BASIC_UI_RESTRICTIONS).cast(),
					size_of_val(&limits) as u32,
				)
			},
			0
		);
	}
	if mode.ends_with("failure") {
		let handles = || {
			let mut count = 0;
			assert_ne!(
				unsafe {
					windows_sys::Win32::System::Threading::GetProcessHandleCount(
						GetCurrentProcess(),
						&mut count,
					)
				},
				0
			);
			count
		};
		let output = fs::File::open("NUL").unwrap();
		// Initialize restricted-token APIs independently from the measured spawns.
		drop(restricted_token().unwrap());
		let before = handles();
		for _ in 0..20 {
			if mode == "helper-failure" {
				assert!(HandleContainer::new().is_err());
			} else {
				// A regular account takes std's route and needs a separately held
				// container to fill the same two-process quota. No elevation/skip.
				let _regular_container =
					if token_is_admin() { None } else { Some(HandleContainer::new().unwrap()) };
				assert!(
					spawn(
						Command::new(std::env::current_exe().unwrap()).arg("--list"),
						&output,
						&output
					)
					.is_err()
				);
			}
		}
		assert_eq!(handles(), before, "failed creation must release all local resources");
		let mut count = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
		assert_ne!(
			unsafe {
				QueryInformationJobObject(
					outer.0,
					JobObjectBasicAccountingInformation,
					(&mut count as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
					size_of_val(&count) as u32,
					ptr::null_mut(),
				)
			},
			0
		);
		assert_eq!(count.ActiveProcesses, 1, "failure must leave no container or real child");
		return;
	}
	let control = suspended(None);
	let expected = member(control.handle, outer.0);
	reap_suspended(control);
	let container = HandleContainer::new().unwrap();
	let real = suspended(Some(container.process.0));
	assert_eq!(member(real.handle, outer.0), expected, "{mode} job membership changed");
	assert!(!member(real.handle, container.job.as_ref().unwrap().0));
	drop(container);
	assert_eq!(unsafe { WaitForSingleObject(real.handle, 0) }, WAIT_TIMEOUT);
	reap_suspended(real);
}
