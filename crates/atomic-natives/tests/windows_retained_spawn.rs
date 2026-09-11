#![cfg(windows)]

// Exercise the actual spawn module in isolated processes, including a restricted
// parent that takes the ordinary-user path. No installed native binding is used.
#[path = "../src/retained_postgres/windows_spawn.rs"]
mod windows_spawn;

use std::{
	env, fs,
	io::Read,
	path::{Path, PathBuf},
	process::Command,
	thread,
	time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MODE: &str = "ATOMIC_WINDOWS_SPAWN_FIXTURE";

fn fixture_command(root: &Path, mode: &str) -> Command {
	let mut command = Command::new(env::current_exe().unwrap());
	command.args(["--exact", "windows_spawn_fixture", "--nocapture"]);
	command.env(MODE, mode).current_dir(root);
	windows_spawn::configure_process(&mut command, None, None);
	command
}

fn run(command: &mut Command, log: &Path) {
	let output = fs::File::create(log).unwrap();
	let mut child = windows_spawn::spawn(command, &output, &output).unwrap();
	let deadline = Instant::now() + Duration::from_secs(20);
	loop {
		if let Some(status) = child.try_wait().unwrap() {
			assert!(status.success(), "{status}: {}", fs::read_to_string(log).unwrap());
			break;
		}
		assert!(Instant::now() < deadline, "child {} timed out", child.id());
		thread::sleep(Duration::from_millis(5));
	}
}

fn root() -> PathBuf {
	let root = env::temp_dir().join(format!(
		"atomic windows spawn {} {}",
		std::process::id(),
		SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
	));
	fs::create_dir(&root).unwrap();
	root
}

#[test]
fn windows_spawn_fixture() {
	let Ok(mode) = env::var(MODE) else { return };
	let root = env::current_dir().unwrap();
	match mode.as_str() {
		"stdio-parent" => {
			run(&mut fixture_command(&root, "stdio-leaf"), &root.join("nonadmin.log"));
		},
		"stdio-leaf" => {
			assert!(unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() } == 0);
			let mut input = Vec::new();
			std::io::stdin().read_to_end(&mut input).unwrap();
			assert!(input.is_empty());
			println!("leaf-stdout-sentinel");
			eprintln!("leaf-stderr-sentinel");
		},
		"noop" => {},
		"handle-parent" => {
			use std::process::Stdio;
			use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};
			assert!(unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() } == 0);
			let handles = || {
				let mut count = 0;
				assert_ne!(unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut count) }, 0);
				count
			};
			let baseline = || {
				assert!(
					fixture_command(&root, "noop")
						.stdin(Stdio::null())
						.stdout(Stdio::null())
						.stderr(Stdio::null())
						.status()
						.unwrap()
						.success()
				);
			};
			baseline(); // Warm std's one-time process initialization before measuring.
			run(&mut fixture_command(&root, "noop"), &root.join("handles.log"));
			let before = handles();
			for _ in 0..20 {
				baseline();
			}
			let after_baseline = handles();
			for _ in 0..20 {
				run(&mut fixture_command(&root, "noop"), &root.join("handles.log"));
			}
			let after_retained = handles();
			println!("handles before={before}, baseline={after_baseline}, retained={after_retained}");
			assert_eq!(after_baseline, before);
			assert_eq!(after_retained, before, "retained spawns must release every child handle");
		},
		"env-parent" => {
			let mut command = fixture_command(&root, "env-leaf");
			command.env("ATOMIC_RISK_é", "child");
			command.env("ATOMIC_RAW_TEXT", " quote\" slash\\ trailing ユニコード ");
			command.args(["--", "", "space value", "quote\"value", "trailing\\", "ユニコード"]);
			run(&mut command, &root.join("env.log"));
		},
		"env-leaf" => {
			assert_eq!(env::var("ATOMIC_RISK_é").unwrap(), "child");
			assert_eq!(env::var("ATOMIC_RAW_TEXT").unwrap(), " quote\" slash\\ trailing ユニコード ");
			assert_eq!(
				env::args().skip(5).collect::<Vec<_>>(),
				["", "space value", "quote\"value", "trailing\\", "ユニコード"]
			);
		},
		_ => panic!("unknown fixture {mode}"),
	}
}

#[test]
fn nonadmin_stdio_is_redirected_without_parent_output_pollution() {
	let root = root();
	run(&mut fixture_command(&root, "stdio-parent"), &root.join("outer.log"));
	let leaf = fs::read_to_string(root.join("nonadmin.log")).unwrap();
	let outer = fs::read_to_string(root.join("outer.log")).unwrap();
	for sentinel in ["leaf-stdout-sentinel", "leaf-stderr-sentinel"] {
		assert!(leaf.contains(sentinel), "missing {sentinel}: leaf={leaf:?}, outer={outer:?}");
		assert!(!outer.contains(sentinel), "parent output polluted: {outer}");
	}
	fs::remove_dir_all(root).unwrap();
}

#[test]
fn completed_nonadmin_children_do_not_leak_handles() {
	let root = root();
	run(&mut fixture_command(&root, "handle-parent"), &root.join("outer.log"));
	println!("{}", fs::read_to_string(root.join("outer.log")).unwrap());
	fs::remove_dir_all(root).unwrap();
}

#[test]
fn unicode_environment_overrides_and_raw_text_roundtrip() {
	let root = root();
	// Set the inherited value in an isolated unrestricted parent, not in the
	// multithreaded test runner's environment. Its spawn takes the admin path.
	let output =
		fixture_command(&root, "env-parent").env("ATOMIC_RISK_É", "parent").output().unwrap();
	assert!(
		output.status.success(),
		"{}{}",
		String::from_utf8_lossy(&output.stdout),
		String::from_utf8_lossy(&output.stderr)
	);
	fs::remove_dir_all(root).unwrap();
}
