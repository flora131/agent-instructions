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
	sync::atomic::{AtomicU64, Ordering},
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
	static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);
	let root = env::temp_dir().join(format!(
		"atomic windows spawn {} {} {}",
		std::process::id(),
		SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
		NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
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
		"resolution-leaf" => {
			fs::write(
				env::var_os("ATOMIC_RESULT_FILE").unwrap(),
				env::current_exe().unwrap().as_os_str().as_encoded_bytes(),
			)
			.unwrap();
		},
		"resolution-parent" => check_executable_resolution(&root),
		"text-leaf" => {
			let text = format!(
				"{:?}\n{:?}\n{:?}",
				env::args().skip(5).collect::<Vec<_>>(),
				env::var("ATOMIC_RAW_TEXT").unwrap(),
				env::var("ATOMIC_EMPTY_TEXT").unwrap()
			);
			fs::write(env::var_os("ATOMIC_RESULT_FILE").unwrap(), text).unwrap();
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

fn boundary_command(executable: &std::ffi::OsStr, root: &Path) -> Command {
	let mut command = Command::new(executable);
	command
		.args(["--exact", "windows_spawn_fixture", "--nocapture"])
		.env(MODE, "resolution-leaf")
		.env("ATOMIC_RESULT_FILE", root.join("selected-executable.txt"));
	windows_spawn::configure_process(&mut command, None, None);
	command
}

fn launch_result(
	command: &mut Command,
	root: &Path,
	retained: bool,
) -> Result<String, std::io::ErrorKind> {
	let marker = root.join("selected-executable.txt");
	let _ = fs::remove_file(&marker);
	// An Ok result means a child was created and exited successfully.
	let log = fs::File::create(root.join("resolution.log")).unwrap();
	if retained {
		let mut child = windows_spawn::spawn(command, &log, &log).map_err(|e| e.kind())?;
		let deadline = Instant::now() + Duration::from_secs(20);
		loop {
			if let Some(status) = child.try_wait().unwrap() {
				assert!(status.success());
				break;
			}
			assert!(Instant::now() < deadline);
			thread::sleep(Duration::from_millis(5));
		}
	} else {
		use std::process::Stdio;
		let status = command
			.stdin(Stdio::null())
			.stdout(log.try_clone().unwrap())
			.stderr(log)
			.status()
			.map_err(|e| e.kind())?;
		assert!(status.success());
	}
	Ok(fs::read_to_string(marker).unwrap())
}

fn check_executable_resolution(root: &Path) {
	let own_name = env::current_exe().unwrap().file_name().unwrap().to_owned();
	let child_path = root.join("bin");
	let cases = [
		("bare-application", own_name, None),
		("child-path", "atomic-fixture.exe".into(), Some(child_path.clone().into_os_string())),
		(
			"child-path-no-extension",
			"atomic-fixture".into(),
			Some(child_path.clone().into_os_string()),
		),
		(
			"child-path-dotted",
			"atomic-fixture.custom".into(),
			Some(child_path.clone().into_os_string()),
		),
		("relative", r".\bin\atomic-fixture.exe".into(), None),
		("relative-no-extension", r".\bin\atomic-fixture".into(), None),
		("relative-dotted-appended-exe", r".\bin\atomic-fixture.custom".into(), None),
		("relative-extensionless-file", r".\bin\extensionless".into(), None),
		("parent-path", "atomic-parent.exe".into(), None),
		("empty-child-path", "atomic-parent.exe".into(), Some("".into())),
		(
			"empty-components",
			"atomic-fixture.exe".into(),
			Some(format!(";{};;", child_path.display()).into()),
		),
		(
			"quoted-child-path",
			"atomic-fixture.exe".into(),
			Some(format!("\"{}\"", child_path.display()).into()),
		),
		("relative-child-path", "atomic-fixture.exe".into(), Some("bin".into())),
		("uppercase-extension", r".\bin\atomic-fixture.EXE".into(), None),
		("unicode-path", r".\bin\ユニコード é.exe".into(), None),
		(
			"verbatim-path",
			fs::canonicalize(child_path.join("atomic-fixture.exe")).unwrap().into_os_string(),
			None,
		),
		("nt-path", format!(r"\??\{}", child_path.join("atomic-fixture.exe").display()).into(), None),
		("empty-executable", "".into(), None),
		("trailing-slash", r".\bin\".into(), None),
		("cwd-not-searched", "only-in-cwd.exe".into(), Some(";".into())),
		("missing", "atomic-missing-executable.exe".into(), None),
	];
	let mut differences = Vec::new();
	for (name, executable, child_path) in cases {
		let result = |retained| {
			let mut command = boundary_command(&executable, root);
			command.current_dir(root.join("child"));
			if let Some(path) = &child_path {
				command.env("pAtH", path);
			}
			launch_result(&mut command, root, retained)
		};
		let baseline = result(false);
		let retained = result(true);
		println!("{name}: std={baseline:?} retained={retained:?}");
		if baseline != retained {
			differences.push(name);
		}
	}
	assert!(differences.is_empty(), "resolution differs from std: {differences:?}");
}

#[test]
fn executable_resolution_matches_std_command() {
	let root = root();
	for directory in ["bin", "parent", "child"] {
		fs::create_dir(root.join(directory)).unwrap();
	}
	for name in [
		"bin/atomic-fixture.exe",
		"bin/atomic-fixture.custom",
		"bin/atomic-fixture.custom.exe",
		"bin/extensionless",
		"parent/atomic-fixture.exe",
		"parent/atomic-parent.exe",
		"only-in-cwd.exe",
		"child/only-in-cwd.exe",
	] {
		fs::copy(env::current_exe().unwrap(), root.join(name)).unwrap();
	}
	fs::copy(env::current_exe().unwrap(), root.join("bin/ユニコード é.exe")).unwrap();
	let mut failures = Vec::new();
	for parent_path in [Some(root.join("parent").into_os_string()), Some("".into()), None] {
		let mut command = fixture_command(&root, "resolution-parent");
		if let Some(path) = &parent_path {
			command.env("PATH", path);
		} else {
			command.env_remove("PATH");
		}
		let output = command.output().unwrap();
		println!(
			"parent PATH={parent_path:?}\n{}{}",
			String::from_utf8_lossy(&output.stdout),
			String::from_utf8_lossy(&output.stderr)
		);
		if !output.status.success() {
			failures.push(parent_path);
		}
	}
	fs::remove_dir_all(root).unwrap();
	assert!(failures.is_empty(), "resolution parents failed: {failures:?}");
}

#[test]
fn embedded_nuls_are_invalid_input_without_spawning() {
	let root = root();
	let mut differences = Vec::new();
	for case in [
		"executable",
		"argument-first",
		"argument-before",
		"cwd",
		"env-key",
		"env-value",
		"env-injection",
	] {
		let result = |retained| {
			let mut executable = env::current_exe().unwrap().into_os_string();
			if case == "executable" {
				executable.push("\0nonexistent");
			}
			let mut command = boundary_command(&executable, &root);
			command.current_dir(&root);
			match case {
				"argument-first" => {
					command.arg("first\0second");
				},
				"argument-before" => {
					command.arg("before\0after");
				},
				"cwd" => {
					let mut cwd = root.clone().into_os_string();
					cwd.push("\0nonexistent");
					command.current_dir(cwd);
				},
				"env-key" => {
					command.env("ATOMIC_NUL\0SECOND", "value");
				},
				"env-value" => {
					command.env("ATOMIC_NUL", "before\0after");
				},
				"env-injection" => {
					command.env("ATOMIC_NUL", "before\0ATOMIC_EVIDENCE_INJECTED=injected");
				},
				_ => {},
			}
			let result = launch_result(&mut command, &root, retained);
			let marker = root.join("selected-executable.txt").exists();
			(result, marker)
		};
		let baseline = result(false);
		assert_eq!(baseline, (Err(std::io::ErrorKind::InvalidInput), false), "std {case}");
		let retained = result(true);
		println!("{case}: std={baseline:?} retained={retained:?}");
		if baseline != retained {
			differences.push(case);
		}
	}
	fs::remove_dir_all(root).unwrap();
	assert!(differences.is_empty(), "embedded NUL accepted: {differences:?}");
}

#[test]
fn valid_empty_unicode_and_quoted_text_matches_std_command() {
	let root = root();
	let arguments = ["", " ", "one\ttwo", "one\ntwo", "quote\"slash\\\"trail\\", "😀é", "trailing "];
	let raw = " quote\" slash\\ trailing ユニコード ";
	let result = |retained| {
		let mut command = boundary_command(env::current_exe().unwrap().as_os_str(), &root);
		command
			.current_dir(&root)
			.env(MODE, "text-leaf")
			.env("ATOMIC_EMPTY_TEXT", "")
			.env("ATOMIC_RAW_TEXT", raw)
			.args(["--"])
			.args(arguments);
		launch_result(&mut command, &root, retained).unwrap()
	};
	let baseline = result(false);
	assert_eq!(baseline, format!("{arguments:?}\n{raw:?}\n{:?}", ""));
	assert_eq!(result(true), baseline);
	fs::remove_dir_all(root).unwrap();
}
