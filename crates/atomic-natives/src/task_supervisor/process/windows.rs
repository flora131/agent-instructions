//! Suspended Windows launch and kill-on-close job ownership. No breakaway flags.
use super::*;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::{null, null_mut};
use windows_sys::Win32::{
	Foundation::{
		ERROR_BROKEN_PIPE, HANDLE, HANDLE_FLAG_INHERIT, SetHandleInformation, WAIT_OBJECT_0,
	},
	Security::SECURITY_ATTRIBUTES,
	System::{
		JobObjects::{
			AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
			JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
			JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
			QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
		},
		Pipes::{CreatePipe, PeekNamedPipe},
		Threading::{
			CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
			DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess,
			InitializeProcThreadAttributeList, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROCESS_INFORMATION,
			ResumeThread, STARTF_USESTDHANDLES, STARTUPINFOEXW, TerminateProcess,
			UpdateProcThreadAttribute, WaitForSingleObject,
		},
	},
};

pub(super) struct WindowsProcess {
	process: OwnedHandle,
	job: OwnedHandle,
}
struct LaunchFailure {
	error: TaskFailure,
	cleanup: Cleanup,
}
impl From<TaskFailure> for LaunchFailure {
	fn from(error: TaskFailure) -> Self {
		Self { error, cleanup: Cleanup::Reaped {} }
	}
}
type PreparedHandles = (OwnedHandle, File, File, File, File, ProcessReader, ProcessReader);
struct WindowsLaunch {
	resource: WindowsProcess,
	stdin: File,
	stdout: ProcessReader,
	stderr: ProcessReader,
}
fn raw(handle: &impl AsRawHandle) -> HANDLE {
	handle.as_raw_handle()
}
fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
	text.encode_wide().chain(Some(0)).collect()
}
struct RetainedWindows {
	resource: WindowsProcess,
	writer: Option<std::thread::JoinHandle<()>>,
}
static FAILED_WINDOWS: Mutex<Vec<RetainedWindows>> = Mutex::new(Vec::new());
pub(super) fn poll_failed_windows() {
	FAILED_WINDOWS.lock().unwrap().retain_mut(|failed| {
		let _ = failed.resource.kill();
		if !failed.resource.exited().unwrap_or(false) {
			unsafe {
				TerminateProcess(raw(&failed.resource.process), 1);
			}
		}
		if failed.resource.exited().unwrap_or(false)
			&& matches!(failed.resource.active(), Ok(0))
			&& failed.writer.as_ref().is_none_or(std::thread::JoinHandle::is_finished)
		{
			if let Some(writer) = failed.writer.take() {
				let _ = writer.join();
			}
			false
		} else {
			true
		}
	});
}
fn pipe() -> io::Result<(File, File)> {
	let mut read = null_mut();
	let mut write = null_mut();
	let attributes = SECURITY_ATTRIBUTES {
		nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
		lpSecurityDescriptor: null_mut(),
		bInheritHandle: 1,
	};
	if unsafe { CreatePipe(&mut read, &mut write, &attributes, 65536) } == 0 {
		return Err(io::Error::last_os_error());
	}
	Ok(unsafe { (File::from_raw_handle(read), File::from_raw_handle(write)) })
}
struct PipeReader(File);
impl Read for PipeReader {
	fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
		let mut available = 0;
		if unsafe {
			PeekNamedPipe(raw(&self.0), null_mut(), 0, null_mut(), &mut available, null_mut())
		} == 0
		{
			let error = io::Error::last_os_error();
			return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
				Ok(0)
			} else {
				Err(error)
			};
		}
		if available == 0 {
			return Err(io::ErrorKind::WouldBlock.into());
		}
		let count = bytes.len().min(available as usize);
		self.0.read(&mut bytes[..count])
	}
}
impl WindowsProcess {
	fn exited(&self) -> io::Result<bool> {
		let value = unsafe { WaitForSingleObject(raw(&self.process), 0) };
		if value == u32::MAX { Err(io::Error::last_os_error()) } else { Ok(value == WAIT_OBJECT_0) }
	}
	fn active(&self) -> io::Result<u32> {
		let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
		if unsafe {
			QueryInformationJobObject(
				raw(&self.job),
				JobObjectBasicAccountingInformation,
				(&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
				std::mem::size_of_val(&info) as u32,
				null_mut(),
			)
		} == 0
		{
			return Err(io::Error::last_os_error());
		}
		Ok(info.ActiveProcesses)
	}
	fn kill(&self) -> io::Result<()> {
		if unsafe { TerminateJobObject(raw(&self.job), 1) } == 0 {
			Err(io::Error::last_os_error())
		} else {
			Ok(())
		}
	}
	fn exit_code(&self) -> io::Result<u32> {
		let mut code = 0;
		if unsafe { GetExitCodeProcess(raw(&self.process), &mut code) } == 0 {
			Err(io::Error::last_os_error())
		} else {
			Ok(code)
		}
	}
}
fn spawn(command: &CommandTask, refuse_assignment: bool) -> Result<WindowsLaunch, LaunchFailure> {
	if command.file_spool() {
		let mut store = command.output.lock().unwrap();
		store.background();
		if store.unavailable {
			return Err(
				TaskFailure { code: "SpawnFailed".into(), message: "Output spool unavailable".into() }
					.into(),
			);
		}
	}
	let prepare = || -> io::Result<PreparedHandles> {
		let job = unsafe { CreateJobObjectW(null(), null()) };
		if job.is_null() {
			return Err(io::Error::last_os_error());
		}
		let job = unsafe { OwnedHandle::from_raw_handle(job) };
		let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
		limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
		if unsafe {
			SetInformationJobObject(
				raw(&job),
				JobObjectExtendedLimitInformation,
				(&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
				std::mem::size_of_val(&limits) as u32,
			)
		} == 0
		{
			return Err(io::Error::last_os_error());
		}
		let (stdin_read, stdin_write) = pipe()?;
		let (out_read, stdout) = pipe()?;
		let (err_read, stderr) = pipe()?;
		let stdout_read: ProcessReader = Box::new(PipeReader(out_read));
		let stderr_read: ProcessReader = Box::new(PipeReader(err_read));
		Ok((job, stdin_read, stdin_write, stdout, stderr, stdout_read, stderr_read))
	};
	let (job, stdin_read, stdin_write, stdout, stderr, stdout_read, stderr_read) = prepare()
		.map_err(|error| TaskFailure {
			code: "ContainmentUnavailable".into(),
			message: error.to_string(),
		})?;
	let inherited = [raw(&stdin_read), raw(&stdout), raw(&stderr)];
	for handle in inherited {
		if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0 {
			return Err(fail("ContainmentUnavailable").into());
		}
	}
	let mut attribute_size = 0;
	unsafe {
		InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut attribute_size);
	}
	let mut attributes = vec![0usize; attribute_size.div_ceil(std::mem::size_of::<usize>())];
	let attribute_list = attributes.as_mut_ptr().cast();
	if unsafe { InitializeProcThreadAttributeList(attribute_list, 1, 0, &mut attribute_size) } == 0 {
		return Err(fail("ContainmentUnavailable").into());
	}
	let attribute_result = unsafe {
		UpdateProcThreadAttribute(
			attribute_list,
			0,
			PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
			inherited.as_ptr().cast(),
			std::mem::size_of_val(&inherited),
			null_mut(),
			null(),
		)
	};
	if attribute_result == 0 {
		unsafe {
			DeleteProcThreadAttributeList(attribute_list);
		}
		return Err(fail("ContainmentUnavailable").into());
	}
	let mut startup = STARTUPINFOEXW::default();
	startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
	startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
	startup.StartupInfo.hStdInput = raw(&stdin_read);
	startup.StartupInfo.hStdOutput = raw(&stdout);
	startup.StartupInfo.hStdError = raw(&stderr);
	startup.lpAttributeList = attribute_list;
	let shell =
		std::env::var_os("COMSPEC").unwrap_or_else(|| "C:\\Windows\\System32\\cmd.exe".into());
	let application = wide(&shell);
	let mut line = wide(std::ffi::OsStr::new(&format!(
		"\"{}\" /D /S /C \"{}\"",
		shell.to_string_lossy(),
		command.intent.command.process_text()
	)));
	let cwd =
		command.intent.cwd.as_ref().map(|value| wide(std::ffi::OsStr::new(&value.process_text())));
	let mut env: BTreeMap<std::ffi::OsString, std::ffi::OsString> = std::env::vars_os().collect();
	if let Some(overrides) = &command.intent.env {
		for (key, value) in overrides {
			env.retain(|existing, _| !existing.to_string_lossy().eq_ignore_ascii_case(key));
			env.insert(key.into(), value.process_text().into());
		}
	}
	let mut environment = Vec::new();
	for (key, value) in env {
		environment.extend(key.encode_wide());
		environment.push(b'=' as u16);
		environment.extend(value.encode_wide());
		environment.push(0);
	}
	environment.push(0);
	let mut info = PROCESS_INFORMATION::default();
	let created = unsafe {
		CreateProcessW(
			application.as_ptr(),
			line.as_mut_ptr(),
			null(),
			null(),
			1,
			CREATE_SUSPENDED
				| CREATE_UNICODE_ENVIRONMENT
				| CREATE_NO_WINDOW
				| EXTENDED_STARTUPINFO_PRESENT,
			environment.as_ptr().cast(),
			cwd.as_ref().map_or(null(), |value| value.as_ptr()),
			&startup.StartupInfo,
			&mut info,
		)
	};
	let create_error = io::Error::last_os_error();
	unsafe {
		DeleteProcThreadAttributeList(attribute_list);
	}
	if created == 0 {
		return Err(
			TaskFailure { code: "SpawnFailed".into(), message: create_error.to_string() }.into(),
		);
	}
	let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
	let thread = unsafe { OwnedHandle::from_raw_handle(info.hThread) };
	// No user instruction has executed yet. Assignment precedes ResumeThread.
	let assigned =
		!refuse_assignment && unsafe { AssignProcessToJobObject(raw(&job), raw(&process)) } != 0;
	if !assigned || unsafe { ResumeThread(raw(&thread)) } == u32::MAX {
		let terminated = unsafe { TerminateProcess(raw(&process), 1) } != 0;
		let reaped =
			terminated && unsafe { WaitForSingleObject(raw(&process), 3000) } == WAIT_OBJECT_0;
		if reaped {
			return Err(fail("ContainmentUnavailable").into());
		}
		FAILED_WINDOWS
			.lock()
			.unwrap()
			.push(RetainedWindows { resource: WindowsProcess { process, job }, writer: None });
		return Err(LaunchFailure {
			error: fail("ContainmentUnavailable"),
			cleanup: Cleanup::Failed {
				resources: vec![ResourceFailure {
					resource: "suspended-process".into(),
					code: "CleanupFailed".into(),
					message: "Suspended process termination was not confirmed".into(),
				}],
			},
		});
	}
	drop(thread);
	drop(stdin_read);
	drop(stdout);
	drop(stderr);
	Ok(WindowsLaunch {
		resource: WindowsProcess { process, job },
		stdin: stdin_write,
		stdout: stdout_read,
		stderr: stderr_read,
	})
}

impl Actor {
	pub(super) fn run_command_windows(&self, runner: &RunnerLease, command: &Arc<CommandTask>) {
		let launch = match spawn(command, false) {
			Ok(launch) => launch,
			Err(LaunchFailure { error, cleanup }) => {
				let _ = self.runner_outcome(
					runner,
					TaskResult::Failed {
						code: error.code.clone().into(),
						message: error.message.clone().into(),
						output: None,
						exit_code: None,
					},
				);
				let _ = self.acknowledge_cleanup(runner, cleanup);
				command.setup_result(Err(error));
				return;
			},
		};
		let WindowsLaunch { resource, stdin, mut stdout, mut stderr } = launch;
		let stop_input = Arc::new(AtomicBool::new(false));
		let stopped = stop_input.clone();
		let input_command = command.clone();
		let writer = std::thread::Builder::new().name("task-stdin".into()).spawn(move || {
			let mut stdin = Some(stdin);
			while !stopped.load(Ordering::Acquire) {
				input_command.input.lock().unwrap().drain(&mut stdin);
				std::thread::sleep(PROCESS_POLL);
			}
			input_command.input.lock().unwrap().close();
		});
		let writer = match writer {
			Ok(writer) => writer,
			Err(error) => {
				let _ = resource.kill();
				let deadline = Instant::now() + PROCESS_DRAIN_GRACE;
				while Instant::now() < deadline
					&& !(resource.exited().unwrap_or(false) && matches!(resource.active(), Ok(0)))
				{
					std::thread::sleep(PROCESS_POLL);
				}
				let reaped = resource.exited().unwrap_or(false) && matches!(resource.active(), Ok(0));
				let message = error.to_string();
				let _ = self.runner_outcome(
					runner,
					TaskResult::Failed {
						code: "SpawnFailed".into(),
						message: message.clone().into(),
						output: None,
						exit_code: None,
					},
				);
				let cleanup = if reaped {
					Cleanup::Reaped {}
				} else {
					FAILED_WINDOWS.lock().unwrap().push(RetainedWindows { resource, writer: None });
					Cleanup::Failed {
						resources: vec![ResourceFailure {
							resource: "windows-job".into(),
							code: "CleanupFailed".into(),
							message: "Input setup failure cleanup was not confirmed".into(),
						}],
					}
				};
				let _ = self.acknowledge_cleanup(runner, cleanup);
				command.setup_result(Err(TaskFailure { code: "SpawnFailed".into(), message }));
				return;
			},
		};
		{
			let mut state = self.state.lock().unwrap();
			let (oi, ti) = state.runner(self.id, &runner.cap).unwrap();
			if matches!(state.owners[oi].tasks[ti].record.execution, Execution::Queued {}) {
				state.owners[oi].tasks[ti].record.execution = Execution::Running {};
				let reference = runner.cap.reference();
				state.emit(oi, Some(reference.task_id.clone()), TaskEvent::TaskStarted { reference });
			}
		}
		command.setup_result(Ok(()));
		let started = Instant::now();
		let mut stopping = None;
		let mut stdout_eof = false;
		let mut stderr_eof = false;
		let mut failure = None;
		loop {
			for result in [
				drain_pipe(&mut stdout, command, &mut stdout_eof),
				drain_pipe(&mut stderr, command, &mut stderr_eof),
			] {
				if let Err(error) = result {
					failure = Some(error.to_string());
				}
			}
			if command.background.load(Ordering::Acquire) {
				command.output.lock().unwrap().background();
				if command.file_spool() && command.output.lock().unwrap().overflow {
					let _ =
						self.cancel(&TaskLease { cap: runner.cap.clone() }, CancelCause::OutputLimit);
				}
			}
			if command
				.intent
				.execution_timeout_ms
				.is_some_and(|budget| started.elapsed().as_secs_f64() * 1000.0 >= budget)
			{
				let _ =
					self.cancel(&TaskLease { cap: runner.cap.clone() }, CancelCause::ExecutionTimeout);
			}
			let cancelling = self.state.lock().unwrap().owners[runner.cap.owner].tasks
				[runner.cap.task.unwrap()]
			.cancel_cause
			.is_some();
			let exited = match resource.exited() {
				Ok(exited) => exited,
				Err(error) => {
					failure = Some(error.to_string());
					false
				},
			};
			if stopping.is_none() && (cancelling || exited || failure.is_some()) {
				let _ = self.acknowledge_cleanup(runner, Cleanup::Draining {});
				if let Err(error) = resource.kill() {
					failure = Some(error.to_string());
				}
				stopping = Some(Instant::now());
			}
			if let Some(stopped) = stopping {
				match resource.active() {
					Ok(0) if exited && stdout_eof && stderr_eof => break,
					Ok(_) => {},
					Err(error) => {
						failure = Some(error.to_string());
					},
				}
				if stopped.elapsed() >= PROCESS_DRAIN_GRACE {
					failure = Some("Windows job exit or reader drain was not confirmed".into());
					break;
				}
			}
			std::thread::sleep(PROCESS_POLL);
		}
		// Job termination closes every inherited read end before a blocked stdin worker is joined.
		let _ = resource.kill();
		stop_input.store(true, Ordering::Release);
		let input_deadline = Instant::now() + PROCESS_DRAIN_GRACE;
		while !writer.is_finished() && Instant::now() < input_deadline {
			std::thread::sleep(PROCESS_POLL);
		}
		let mut writer = Some(writer);
		if writer.as_ref().unwrap().is_finished() {
			if writer.take().unwrap().join().is_err() {
				failure = Some("Windows stdin worker panicked".into());
			}
		} else {
			failure = Some("Windows stdin worker stop was not confirmed".into());
		}
		if let Some(message) = failure {
			FAILED_WINDOWS.lock().unwrap().push(RetainedWindows { resource, writer });
			let _ = self.runner_outcome(
				runner,
				TaskResult::Failed {
					code: "CleanupFailed".into(),
					message: message.clone().into(),
					output: None,
					exit_code: None,
				},
			);
			let _ = self.acknowledge_cleanup(
				runner,
				Cleanup::Failed {
					resources: vec![ResourceFailure {
						resource: "windows-job".into(),
						code: "CleanupFailed".into(),
						message: message.into(),
					}],
				},
			);
			return;
		}
		let store = command.output.lock().unwrap();
		let reference = runner.cap.reference();
		let output = OutputRef {
			owner_id: reference.owner_id.into(),
			task_id: reference.task_id.clone().into(),
			artifact_id: format!("output-{}", reference.task_id).into(),
			byte_count: store.byte_count.to_string().into(),
			omitted_ranges: store
				.omitted_ranges()
				.into_iter()
				.map(|range| OmittedRange { start: range.start.into(), end: range.end.into() })
				.collect(),
		};
		drop(store);
		let _ = self.runner_outcome(
			runner,
			TaskResult::Completed { output, exit_code: resource.exit_code().ok().map(f64::from) },
		);
		let _ = self.acknowledge_cleanup(runner, Cleanup::Reaped {});
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	fn intent(command: &str) -> CommandIntent {
		CommandIntent {
			kind: CommandTaskKind::Command,
			command: command.into(),
			description: None,
			cwd: None,
			env: None,
			terminal: CommandTerminal::Pipe {},
			execution_timeout_ms: None,
			parent_task_id: None,
		}
	}
	// RFC #2884: failed assignment must never run a single untrusted instruction.
	#[test]
	fn assignment_failure_reaps_suspended_command_without_side_effects() {
		let path = std::env::temp_dir().join(format!("atomic-job-refusal-{}", std::process::id()));
		let command = CommandTask {
			intent: intent(&format!("echo UNSUPERVISED > \"{}\"", path.display())),
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
		};
		let error = match spawn(&command, true) {
			Ok(_) => panic!("assignment failure launched command"),
			Err(error) => error,
		};
		assert_eq!(error.error.code, "ContainmentUnavailable");
		assert_eq!(error.cleanup, Cleanup::Reaped {});
		assert!(!path.exists(), "suspended command executed before job assignment");
	}
	#[test]
	fn windows_owner_close_confirms_job_descendants_and_replay_is_inert() {
		let actor = Actor::new();
		let scope = OwnerScope::Session { session_id: "windows-command".into() };
		let owner = actor.open(&actor.bind(scope.clone()), scope).unwrap();
		let identities =
			std::env::temp_dir().join(format!("atomic-job-tree-{}.json", std::process::id()));
		let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
			.join("../../test/fixtures/task-process-tree.mjs");
		let task = actor
			.start_command(
				&owner,
				intent(&format!("node \"{}\" \"{}\"", fixture.display(), identities.display())),
				"job".into(),
			)
			.unwrap();
		let ready = Instant::now() + Duration::from_secs(5);
		while !std::fs::read_to_string(&identities).is_ok_and(|text| text.contains("grandchild")) {
			assert!(Instant::now() < ready, "process-tree identities missing");
			std::thread::sleep(PROCESS_POLL);
		}
		actor.begin_close(&owner).unwrap();
		let deadline = Instant::now() + PROCESS_SHUTDOWN_GRACE;
		let receipt = loop {
			if let Some(receipt) = actor.close_receipt(&owner).unwrap() {
				break receipt;
			}
			assert!(Instant::now() < deadline, "job cleanup deadline");
			std::thread::sleep(PROCESS_POLL);
		};
		assert_eq!(receipt.tasks[0].cleanup, Cleanup::Reaped {});
		assert_eq!(actor.cancel(&task, CancelCause::User).unwrap().cleanup, Cleanup::Reaped {});
		actor.shutdown();
		std::fs::remove_file(identities).unwrap();
	}
}
