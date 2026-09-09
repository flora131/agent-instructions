//! Windows process-boundary encoding. Replay compares the original JsString units.
use super::*;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Globalization::{CSTR_GREATER_THAN, CSTR_LESS_THAN, CompareStringOrdinal};

pub(super) struct ProcessCommand {
	pub application: Vec<u16>,
	pub line: Vec<u16>,
	pub cwd: Option<Vec<u16>>,
	pub environment: Vec<u16>,
}
fn checked(units: &[u16]) -> io::Result<Vec<u16>> {
	if units.contains(&0) {
		return Err(io::Error::new(io::ErrorKind::InvalidInput, "Process text contains NUL"));
	}
	Ok(units.to_vec())
}
fn terminated(units: &[u16]) -> io::Result<Vec<u16>> {
	let mut value = checked(units)?;
	value.push(0);
	Ok(value)
}
/// CRT/CommandLineToArgvW escaping, including empty args and trailing backslashes.
/// This is not cmd.exe syntax: callers choose a real executable, never a cmd wrapper.
fn quote(argument: &[u16], output: &mut Vec<u16>) -> io::Result<()> {
	checked(argument)?;
	output.push(34);
	let mut backslashes = 0;
	for &unit in argument {
		if unit == 92 {
			backslashes += 1;
			continue;
		}
		output.extend(std::iter::repeat_n(
			92,
			if unit == 34 { 2 * backslashes + 1 } else { backslashes },
		));
		output.push(unit);
		backslashes = 0;
	}
	output.extend(std::iter::repeat_n(92, backslashes * 2));
	output.push(34);
	Ok(())
}
fn compare_name(left: &[u16], right: &[u16]) -> std::cmp::Ordering {
	match unsafe {
		CompareStringOrdinal(left.as_ptr(), left.len() as i32, right.as_ptr(), right.len() as i32, 1)
	} {
		CSTR_LESS_THAN => std::cmp::Ordering::Less,
		CSTR_GREATER_THAN => std::cmp::Ordering::Greater,
		_ => std::cmp::Ordering::Equal,
	}
}
pub(super) fn prepare(intent: &CommandIntent) -> io::Result<ProcessCommand> {
	let program: Vec<u16> = intent.shell.as_ref().map_or_else(
		|| {
			std::env::var_os("COMSPEC")
				.unwrap_or_else(|| "C:\\Windows\\System32\\cmd.exe".into())
				.encode_wide()
				.collect()
		},
		|shell| shell.program.process_wide().to_vec(),
	);
	if program.is_empty() || program.contains(&34) {
		return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid shell executable"));
	}
	let application = terminated(&program)?;
	// argv[0] has special parsing rules; executable paths cannot contain quotes.
	let mut line = vec![34];
	line.extend(&program);
	line.push(34);
	if let Some(shell) = &intent.shell {
		for argument in shell.args.iter().chain(std::iter::once(&intent.command)) {
			line.push(32);
			quote(argument.process_wide(), &mut line)?;
		}
	} else {
		line.extend(" /D /S /C \"".encode_utf16());
		line.extend(checked(intent.command.process_wide())?);
		line.push(34);
	}
	line.push(0);
	let cwd = intent.cwd.as_ref().map(|cwd| terminated(cwd.process_wide())).transpose()?;
	let mut env: Vec<(Vec<u16>, Vec<u16>)> = if intent.inherit_env == Some(false) {
		vec![]
	} else {
		std::env::vars_os()
			.map(|(key, value)| (key.encode_wide().collect(), value.encode_wide().collect()))
			.collect()
	};
	if let Some(overrides) = &intent.env {
		for (key, value) in overrides {
			if key.is_empty() || key.contains('=') {
				return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid environment name"));
			}
			let key = checked(&key.encode_utf16().collect::<Vec<_>>())?;
			let value = checked(value.process_wide())?;
			env.retain(|(existing, _)| !compare_name(existing, &key).is_eq());
			env.push((key, value));
		}
	}
	env.sort_by(|(left, _), (right, _)| compare_name(left, right));
	let mut environment = Vec::new();
	for (key, value) in env {
		environment.extend(key);
		environment.push(61);
		environment.extend(value);
		environment.push(0);
	}
	if environment.is_empty() {
		environment.push(0);
	}
	environment.push(0);
	Ok(ProcessCommand { application, line, cwd, environment })
}

#[cfg(test)]
#[path = "windows_command_tests.rs"]
mod tests;
