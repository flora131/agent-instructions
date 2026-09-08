use super::*;
use windows_sys::Win32::{Foundation::LocalFree, UI::Shell::CommandLineToArgvW};

#[test]
fn windows_argv_roundtrips_quotes_backslashes_whitespace_and_utf16_units() {
	let alphabet = [92, 34, 32, 9, 10, 0xd800, 0xdc00, 97];
	for length in 0..=4 {
		for mut index in 0..alphabet.len().pow(length) {
			let mut argument = Vec::new();
			for _ in 0..length {
				argument.push(alphabet[index % alphabet.len()]);
				index /= alphabet.len();
			}
			let mut line: Vec<u16> = "\"C:\\Program Files\\shell.exe\" ".encode_utf16().collect();
			quote(&argument, &mut line).unwrap();
			line.push(0);
			let mut count = 0;
			let parsed = unsafe { CommandLineToArgvW(line.as_ptr(), &mut count) };
			assert!(!parsed.is_null());
			assert_eq!(count, 2);
			let actual = unsafe {
				let pointer = *parsed.add(1);
				let mut length = 0;
				while *pointer.add(length) != 0 {
					length += 1;
				}
				let actual = std::slice::from_raw_parts(pointer, length).to_vec();
				LocalFree(parsed.cast());
				actual
			};
			assert_eq!(actual, argument);
		}
	}
}
#[test]
fn complete_empty_environment_has_two_nuls_and_nul_arguments_refuse() {
	let mut intent = CommandIntent {
		kind: CommandTaskKind::Command,
		command: "payload".into(),
		description: None,
		cwd: None,
		env: None,
		inherit_env: Some(false),
		shell: Some(CommandShell { program: "C:\\shell.exe".into(), args: vec![] }),
		terminal: CommandTerminal::Pipe {},
		execution_timeout_ms: None,
		parent_task_id: None,
	};
	assert_eq!(prepare(&intent).unwrap().environment, [0, 0]);
	intent.shell.as_mut().unwrap().args.push("safe\0truncated".into());
	assert_eq!(prepare(&intent).err().unwrap().kind(), io::ErrorKind::InvalidInput);
}
