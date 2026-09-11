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
		"command-line-leaf" => {
			use std::os::windows::ffi::OsStrExt;
			let line = unsafe { windows_sys::Win32::System::Environment::GetCommandLineW() };
			let mut length = 0;
			while unsafe { *line.add(length) } != 0 {
				length += 1;
			}
			let line = unsafe { std::slice::from_raw_parts(line, length) };
			let args: Vec<Vec<u16>> =
				env::args_os().skip(5).map(|arg| arg.encode_wide().collect()).collect();
			let raw_environment: Vec<u16> =
				env::var_os("ATOMIC_RAW_UTF16").unwrap().encode_wide().collect();
			fs::write(
				env::var_os("ATOMIC_RESULT_FILE").unwrap(),
				format!("{line:?}\n{args:?}\n{raw_environment:?}"),
			)
			.unwrap();
		},
		"inherited-files" => {
			use windows_sys::Win32::{
				Foundation::HANDLE,
				Storage::FileSystem::GetFinalPathNameByHandleW,
				System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE},
			};
			// Query actual child-side file identities, not a process handle count.
			// Check the scan covers our stdio and positively observes both handles.
			const HANDLE_LIMIT: usize = 65_536;
			for stream in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
				assert!((unsafe { GetStdHandle(stream) } as usize) < HANDLE_LIMIT);
			}
			let mut names = Vec::new();
			let canonical_root = fs::canonicalize(&root).unwrap();
			for number in (4..HANDLE_LIMIT).step_by(4) {
				let mut buffer = [0_u16; 1024];
				let length = unsafe {
					GetFinalPathNameByHandleW(
						number as HANDLE,
						buffer.as_mut_ptr(),
						buffer.len() as u32,
						0,
					)
				} as usize;
				if length != 0 && length < buffer.len() {
					let path = PathBuf::from(String::from_utf16_lossy(&buffer[..length]));
					if path.parent() == Some(canonical_root.as_path())
						&& path.extension().is_some_and(|ext| ext == "log")
					{
						names.push(path.file_name().unwrap().to_string_lossy().into_owned());
					}
				}
			}
			fs::write(env::var_os("ATOMIC_RESULT_FILE").unwrap(), names.join("\n")).unwrap();
		},
		"cwd-leaf" => {
			fs::write(
				env::var_os("ATOMIC_RESULT_FILE").unwrap(),
				fs::read("relative-marker.txt").unwrap(),
			)
			.unwrap();
		},
		"batch-parent" => check_batch_launchers(&root),
		"batch-leaf" => {
			let admin = unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() } != 0;
			assert_eq!(admin, env::var("ATOMIC_BATCH_ADMIN").unwrap() == "true");
			let mut input = Vec::new();
			std::io::stdin().read_to_end(&mut input).unwrap();
			assert!(input.is_empty(), "batch descendants inherit NUL stdin");
			fs::write(
				env::var_os("ATOMIC_RESULT_FILE").unwrap(),
				format!("{:?}", env::args().skip(5).collect::<Vec<_>>()),
			)
			.unwrap();
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

fn batch_result(
	command: &mut Command,
	root: &Path,
	retained: bool,
) -> (Result<Option<i32>, std::io::ErrorKind>, Option<String>) {
	let marker = root.join("batch-result.txt");
	let _ = fs::remove_file(&marker);
	let log_path = root.join("batch.log");
	let log = fs::File::create(&log_path).unwrap();
	command
		.env(MODE, "batch-leaf")
		.env(
			"ATOMIC_BATCH_ADMIN",
			(!retained && unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() } != 0).to_string(),
		)
		.env("ATOMIC_BATCH_OBSERVER", env::current_exe().unwrap())
		.env("ATOMIC_RESULT_FILE", &marker);
	windows_spawn::configure_process(command, None, None);
	let status = if retained {
		windows_spawn::spawn(command, &log, &log).map(|mut child| {
			let deadline = Instant::now() + Duration::from_secs(20);
			loop {
				if let Some(status) = child.try_wait().unwrap() {
					break status;
				}
				assert!(Instant::now() < deadline, "batch interpreter {} timed out", child.id());
				thread::sleep(Duration::from_millis(5));
			}
		})
	} else {
		command
			.stdin(std::process::Stdio::null())
			.stdout(log.try_clone().unwrap())
			.stderr(log)
			.status()
	};
	if status.as_ref().is_ok_and(|status| !status.success()) {
		println!("batch child failure: {}", fs::read_to_string(log_path).unwrap());
	}
	(status.map(|status| status.code()).map_err(|e| e.kind()), fs::read_to_string(marker).ok())
}

fn check_batch_launchers(root: &Path) {
	println!("batch caller admin={}", unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() });
	let mut differences = Vec::new();
	for extension in ["cmd", "bat", "CmD", "BaT"] {
		let filename = format!("wrapper é ユニコード.{extension}");
		let script = root.join(&filename);
		fs::write(
			&script,
			"@echo off\r\n\"%ATOMIC_BATCH_OBSERVER%\" --exact windows_spawn_fixture --nocapture -- %*\r\n",
		)
		.unwrap();
		for (case, args) in [
			("no-args", vec![]),
			("plain", vec!["plain"]),
			("empty", vec![""]),
			("spaces", vec!["two words", " trailing "]),
			("quotes", vec!["quote\"value", "slash\\\"quote", "trailing\\"]),
			("metacharacters", vec!["a&b", "a|b", "a<b>c", "(x)", "a^b", "@#,;="]),
			("percent", vec!["%ATOMIC_BATCH_EXPAND%", "100%", "%cd%", "%%"]),
			("bang", vec!["!ATOMIC_BATCH_EXPAND!", "a!b"]),
			("unicode", vec!["ユニコード é 😀", "é", "one\ttwo", "a\u{85}b"]),
		] {
			for executable in
				[script.clone(), PathBuf::from(format!(r".\{filename}")), PathBuf::from(&filename)]
			{
				let result = |retained| {
					let mut command = Command::new(&executable);
					command
						.args(&args)
						.current_dir(root.join("child"))
						.env("pAtH", root)
						.env("COMSPEC", root.join("not-the-interpreter.exe"))
						.env("ATOMIC_BATCH_EXPAND", "must-not-expand");
					batch_result(&mut command, root, retained)
				};
				let baseline = result(false);
				assert_eq!(baseline.0, Ok(Some(0)), "std {case}");
				assert!(baseline.1.is_some(), "std {case} must execute the wrapper");
				if matches!(
					case,
					"no-args" | "plain" | "empty" | "spaces" | "percent" | "bang" | "unicode"
				) {
					assert_eq!(baseline.1, Some(format!("{args:?}")), "std {case}");
				}
				let retained = result(true);
				println!("{extension}/{case}/{executable:?}: std={baseline:?} retained={retained:?}");
				if baseline != retained {
					differences.push(format!("{extension}/{case}/{executable:?}"));
				}
			}
		}
		// std rejects line breaks before creating cmd, even when an earlier
		// argument is ordinary. NUL validation also remains effective for batch.
		for argument in ["before\rafter", "before\nafter", "before\r\nafter", "before\0after"] {
			let result = |retained| {
				batch_result(Command::new(&script).args(["plain", argument]), root, retained)
			};
			let baseline = result(false);
			assert_eq!(baseline, (Err(std::io::ErrorKind::InvalidInput), None));
			let retained = result(true);
			println!("{extension}/reject {argument:?}: std={baseline:?} retained={retained:?}");
			assert_eq!(retained, baseline);
			assert_eq!(fs::metadata(root.join("batch.log")).unwrap().len(), 0);
		}
		let mut trailing_slash = script.clone().into_os_string();
		trailing_slash.push("\\");
		for invalid_script in [root.join(format!("bad\"name.{extension}")), trailing_slash.into()] {
			let result =
				|retained| batch_result(Command::new(&invalid_script).arg("plain"), root, retained);
			let baseline = result(false);
			assert_eq!(baseline, (Err(std::io::ErrorKind::InvalidInput), None));
			let retained = result(true);
			println!("{extension}/reject {invalid_script:?}: std={baseline:?} retained={retained:?}");
			assert_eq!(retained, baseline);
			assert_eq!(fs::metadata(root.join("batch.log")).unwrap().len(), 0);
		}
	}
	assert!(differences.is_empty(), "batch behavior differs from std: {differences:?}");
}

#[test]
fn batch_launchers_match_std_command() {
	let root = root();
	fs::create_dir(root.join("child")).unwrap();
	// Isolate the caller cwd without changing the parallel test runner's state.
	let output = fixture_command(&root, "batch-parent").output().unwrap();
	println!(
		"{}{}",
		String::from_utf8_lossy(&output.stdout),
		String::from_utf8_lossy(&output.stderr)
	);
	fs::remove_dir_all(root).unwrap();
	assert!(output.status.success());
}

fn command_output(command: &mut Command, root: &Path, retained: bool) -> (Option<i32>, String) {
	let log_path = root.join("command.log");
	let log = fs::File::create(&log_path).unwrap();
	windows_spawn::configure_process(command, None, None);
	let status = if retained {
		let mut child = windows_spawn::spawn(command, &log, &log).unwrap();
		let deadline = Instant::now() + Duration::from_secs(20);
		loop {
			if let Some(status) = child.try_wait().unwrap() {
				break status;
			}
			assert!(Instant::now() < deadline, "child {} timed out", child.id());
			thread::sleep(Duration::from_millis(5));
		}
	} else {
		command
			.stdin(std::process::Stdio::null())
			.stdout(log.try_clone().unwrap())
			.stderr(log)
			.status()
			.unwrap()
	};
	(status.code(), fs::read_to_string(log_path).unwrap())
}

#[test]
fn explicit_command_interpreter_matches_std_command() {
	let root = root();
	let interpreter =
		PathBuf::from(env::var_os("SystemRoot").unwrap()).join("System32").join("cmd.exe");
	for arguments in [vec!["/d", "/c", "cd"], vec!["/d", "/c", "echo atomic-marker"]] {
		let result = |retained| {
			command_output(
				Command::new(&interpreter).args(&arguments).current_dir(&root),
				&root,
				retained,
			)
		};
		let baseline = result(false);
		assert_eq!(
			baseline.0,
			Some(0),
			"command={interpreter:?} args={arguments:?} result={baseline:?}"
		);
		let retained = result(true);
		println!("{arguments:?}: std={baseline:?} retained={retained:?}");
		assert_eq!(retained, baseline);
	}
	fs::remove_dir_all(root).unwrap();
}

#[test]
fn working_directory_matches_std_command() {
	let root = root();
	let ordinary = root.join("directory");
	fs::create_dir(&ordinary).unwrap();
	fs::write(ordinary.join("relative-marker.txt"), "ordinary-directory").unwrap();
	let verbatim = fs::canonicalize(&ordinary).unwrap();
	let dotted = PathBuf::from(format!("{}.", verbatim.display()));
	let spaced = PathBuf::from(format!("{} ", verbatim.display()));
	for (directory, marker) in
		[(&dotted, "literal-dot-directory"), (&spaced, "literal-space-directory")]
	{
		fs::create_dir(directory).unwrap();
		fs::write(directory.join("relative-marker.txt"), marker).unwrap();
	}
	let script = root.join("cwd.cmd");
	fs::write(&script, "@echo off\r\ntype relative-marker.txt\r\n").unwrap();
	let mut differences = Vec::new();
	for (name, cwd) in [
		("ordinary", ordinary),
		("safe-verbatim", verbatim.clone()),
		("literal-dot", dotted),
		("literal-space", spaced),
		("verbatim-dot-component", PathBuf::from(format!(r"{}\.", verbatim.display()))),
	] {
		let result = |retained| {
			let mut command = boundary_command(env::current_exe().unwrap().as_os_str(), &root);
			command.env(MODE, "cwd-leaf").current_dir(&cwd);
			launch_result(&mut command, &root, retained)
		};
		let baseline = result(false);
		let retained = result(true);
		println!("direct {name}: std={baseline:?} retained={retained:?}");
		if baseline != retained {
			differences.push(format!("direct {name}"));
		}
		let result =
			|retained| command_output(Command::new(&script).current_dir(&cwd), &root, retained);
		let baseline = result(false);
		let retained = result(true);
		println!("batch {name}: std={baseline:?} retained={retained:?}");
		if matches!(name, "ordinary" | "safe-verbatim") {
			assert_eq!(baseline, (Some(0), "ordinary-directory".to_owned()));
		}
		if baseline != retained {
			differences.push(format!("batch {name}"));
		}
	}
	fs::remove_dir_all(fs::canonicalize(&root).unwrap()).unwrap();
	assert!(differences.is_empty(), "cwd behavior differs: {differences:?}");
}

#[test]
fn concurrent_children_inherit_only_their_own_log_handles() {
	use std::sync::{Arc, Barrier};
	let root = root();
	let mut differences = Vec::new();
	for retained in [false, true] {
		let barrier = Arc::new(Barrier::new(8));
		let workers: Vec<_> = (0..8)
			.map(|worker| {
				let root = root.clone();
				let barrier = Arc::clone(&barrier);
				thread::spawn(move || {
					let mut observations = Vec::new();
					for round in 0..20 {
						let name = format!("{retained}-{worker}-{round}.log");
						let log = root.join(&name);
						let result = log.with_extension("handles");
						let output = fs::File::create(&log).unwrap();
						let mut command = fixture_command(&root, "inherited-files");
						command.env("ATOMIC_RESULT_FILE", &result);
						barrier.wait();
						if retained {
							let mut child = windows_spawn::spawn(&mut command, &output, &output).unwrap();
							let deadline = Instant::now() + Duration::from_secs(20);
							loop {
								if let Some(status) = child.try_wait().unwrap() {
									assert!(status.success(), "{}", fs::read_to_string(&log).unwrap());
									break;
								}
								assert!(Instant::now() < deadline);
								thread::sleep(Duration::from_millis(1));
							}
						} else {
							let status = command
								.stdin(std::process::Stdio::null())
								.stdout(output.try_clone().unwrap())
								.stderr(output)
								.status()
								.unwrap();
							assert!(status.success(), "{}", fs::read_to_string(&log).unwrap());
						}
						let names = fs::read_to_string(result).unwrap();
						observations.push((name, names));
					}
					observations
				})
			})
			.collect();
		for worker in workers {
			for (name, names) in worker.join().unwrap() {
				println!("{name}: {names:?}");
				assert!(
					names.lines().filter(|file| *file == name).count() >= 2,
					"must observe both own log handles: {names}"
				);
				if names.lines().any(|file| file != name) {
					differences.push((name, names));
				}
			}
		}
	}
	fs::remove_dir_all(root).unwrap();
	assert!(differences.is_empty(), "children inherited another launch's files: {differences:?}");
}

#[test]
fn native_command_line_and_utf16_environment_match_std_command() {
	use std::os::windows::ffi::{OsStrExt, OsStringExt};
	let root = root();
	let arguments = [
		"plain",
		"",
		"two words",
		"tab\tvalue",
		"line\nvalue",
		"quote\"value",
		"slash\\\"value",
		"trailing\\",
		"space trailing\\",
		"😀é",
		"\u{85}",
	];
	let raw = [0x61, 0xd800, 0x62, 0xdc00];
	let result = |retained| {
		let mut command = boundary_command(env::current_exe().unwrap().as_os_str(), &root);
		command
			.env(MODE, "command-line-leaf")
			.env("ATOMIC_RAW_UTF16", std::ffi::OsString::from_wide(&raw))
			.args(["--"])
			.args(arguments);
		launch_result(&mut command, &root, retained).unwrap()
	};
	let baseline = result(false);
	let expected: Vec<Vec<u16>> =
		arguments.iter().map(|arg| std::ffi::OsStr::new(arg).encode_wide().collect()).collect();
	assert!(baseline.ends_with(&format!("\n{expected:?}\n{raw:?}")));
	assert_eq!(result(true), baseline);
	fs::remove_dir_all(root).unwrap();
}
