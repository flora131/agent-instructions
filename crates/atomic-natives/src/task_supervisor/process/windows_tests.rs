use super::*;

fn command_at(path: &std::path::Path, terminal: CommandTerminal) -> Arc<CommandTask> {
	Arc::new(CommandTask {
		intent: CommandIntent {
			kind: CommandTaskKind::Command,
			command: format!("echo UNSUPERVISED > \"{}\"", path.display()).into(),
			description: None,
			cwd: None,
			env: None,
			shell: None,
			inherit_env: None,
			terminal,
			execution_timeout_ms: None,
			parent_task_id: None,
		},
		options: CommandResourceOptions {
			sink: Some(CommandOutputSink::Drained),
			..Default::default()
		},
		background: AtomicBool::new(false),
		output: Mutex::new(OutputStore::new(
			path.with_extension("output"),
			COMMAND_LIVE_BYTES,
			FOREGROUND_SPILL_BYTES,
			TASK_DISK_BYTES,
		)),
		input: Mutex::new(InputQueue::default()),
		resize: Mutex::new(None),
		setup: Mutex::new(None),
		setup_changed: Condvar::new(),
		worker: Mutex::new(None),
		finished: AtomicBool::new(false),
	})
}
#[test]
fn conpty_assignment_refusal_never_runs_marker_and_joins_output_worker() {
	let path = std::env::temp_dir().join(format!("atomic-conpty-refusal-{}", std::process::id()));
	assert!(!path.exists());
	let command = command_at(&path, CommandTerminal::Pty { columns: 80, rows: 24 });
	let failure = match spawn(&command, true) {
		Ok(_) => panic!("uncontained ConPTY command launched"),
		Err(failure) => failure,
	};
	assert_eq!(failure.error.code, "ContainmentUnavailable");
	assert_eq!(failure.cleanup, Cleanup::Reaped {});
	assert!(!path.exists(), "command ran before assignment");
	assert_eq!(Arc::strong_count(&command), 1, "output worker was not joined");
}
#[test]
fn conpty_create_process_failure_closes_console_and_joins_output_worker() {
	let path =
		std::env::temp_dir().join(format!("atomic-conpty-spawn-refusal-{}", std::process::id()));
	let mut command = command_at(&path, CommandTerminal::Pty { columns: 80, rows: 24 });
	Arc::get_mut(&mut command).unwrap().intent.shell = Some(CommandShell {
		program: "C:\\atomic-nonexistent-directory\\missing.exe".into(),
		args: vec![],
	});
	let failure = match spawn(&command, false) {
		Ok(_) => panic!("missing executable launched"),
		Err(failure) => failure,
	};
	assert_eq!(failure.error.code, "SpawnFailed");
	assert_eq!(failure.cleanup, Cleanup::Reaped {});
	assert_eq!(Arc::strong_count(&command), 1, "failed setup detached its reader");
	assert!(!path.exists());
}
