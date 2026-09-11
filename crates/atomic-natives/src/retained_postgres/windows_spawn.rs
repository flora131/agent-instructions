//! Windows spawn path for the retained Postgres lease.
//!
//! PostgreSQL refuses to run for an effective member of the Administrators or
//! Power Users groups (`pgwin32_is_admin`), so an Atomic process launched from
//! an elevated or administrator account cannot hand its own token to
//! `postgres.exe`: the server prints "Execution of PostgreSQL by a user with
//! administrative permissions is not permitted" and exits, which previously
//! surfaced only as a readiness timeout that hid the real failure.
//!
//! `pg_ctl start` solves this with a restricted token: drop the Administrators
//! and Power Users SIDs, delete every privilege except the ones PostgreSQL
//! keeps, re-add the current user to the token's default DACL (otherwise the
//! postmaster's later CreatePipe/CreateProcess calls fail with access denied
//! on administrative accounts), then `CreateProcessAsUser`. This module
//! performs the same restriction and keeps the exact process handle
//! `CreateProcessAsUserW` returned, so lease ownership, exact-handle fast
//! shutdown, and release semantics are unchanged. The spawn fails closed: any
//! failure surfaces as the OS error instead of retrying with the unrestricted
//! token.
//!
//! A non-administrative caller keeps today's exact `Command::spawn` path; only
//! administrative accounts take the restricted-token route.

use std::{
	ffi::{OsStr, OsString},
	io,
	os::windows::{
		ffi::{OsStrExt, OsStringExt},
		process::ExitStatusExt,
	},
	path::{Path, PathBuf},
	process::{Child, Command, ExitStatus, Stdio},
	ptr,
};

use windows_sys::Win32::{
	Foundation::{
		CloseHandle, DuplicateHandle, GENERIC_ALL, GENERIC_READ, GetLastError, HANDLE,
		INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
	},
	Globalization::CompareStringOrdinal,
	Security::{
		ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION, AclSizeInformation,
		AddAccessAllowedAceEx, AddAce, AllocateAndInitializeSid, CheckTokenMembership,
		CreateRestrictedToken, FreeSid, GetAce, GetAclInformation, GetLengthSid, GetTokenInformation,
		InitializeAcl, LUID_AND_ATTRIBUTES, LookupPrivilegeValueW, OBJECT_INHERIT_ACE, PSID,
		SE_CHANGE_NOTIFY_NAME, SE_LOCK_MEMORY_NAME, SECURITY_NT_AUTHORITY, SID_AND_ATTRIBUTES,
		SetTokenInformation, TOKEN_ALL_ACCESS, TOKEN_DEFAULT_DACL, TOKEN_INFORMATION_CLASS,
		TOKEN_PRIVILEGES, TOKEN_USER, TokenDefaultDacl, TokenPrivileges, TokenUser,
	},
	Storage::FileSystem::{
		CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileAttributesW, GetFullPathNameW,
		INVALID_FILE_ATTRIBUTES, OPEN_EXISTING,
	},
	System::{
		Environment::{FreeEnvironmentStringsW, GetEnvironmentStringsW},
		JobObjects::{
			CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
			JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
			JobObjectExtendedLimitInformation, SetInformationJobObject,
		},
		Memory::{GetProcessHeap, HeapAlloc, HeapFree},
		SystemInformation::{GetSystemDirectoryW, GetWindowsDirectoryW},
		Threading::{
			CREATE_SUSPENDED, CreateProcessAsUserW, CreateProcessW, DeleteProcThreadAttributeList,
			EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess, GetExitCodeProcess, INFINITE,
			InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST, OpenProcessToken,
			PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST,
			PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
			STARTUPINFOEXW, STARTUPINFOW, UpdateProcThreadAttribute, WaitForSingleObject,
		},
	},
};

const SECURITY_BUILTIN_DOMAIN_RID: u32 = 0x0000_0020;
const DOMAIN_ALIAS_RID_ADMINS: u32 = 0x0000_0220;
const DOMAIN_ALIAS_RID_POWER_USERS: u32 = 0x0000_0223;
const DUPLICATE_SAME_ACCESS: u32 = 2;

/// CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP, unchanged from the previous
/// std Command configuration: the postmaster stays attached to an invisible
/// console its children inherit, and DETACHED_PROCESS would give every
/// console-subsystem descendant its own visible window.
pub const CREATION_FLAGS: u32 = 0x0800_0000 | 0x0000_0200;
/// Required whenever an explicit UTF-16 environment block is passed; without
/// it CreateProcess interprets the wide buffer as ANSI and fails with
/// ERROR_INVALID_PARAMETER.
const CREATE_UNICODE_ENVIRONMENT_FLAG: u32 = 0x0000_0400;

pub fn configure_process(command: &mut Command, _uid: Option<u32>, _gid: Option<u32>) {
	use std::os::windows::process::CommandExt;
	command.creation_flags(CREATION_FLAGS);
}

/// The exact retained postmaster handle returned by process creation.
pub struct RetainedChild {
	handle: HANDLE,
	pid: u32,
	status: Option<ExitStatus>,
}

impl RetainedChild {
	pub fn id(&self) -> u32 {
		self.pid
	}

	pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
		if let Some(status) = self.status {
			return Ok(Some(status));
		}
		match unsafe { WaitForSingleObject(self.handle, 0) } {
			WAIT_OBJECT_0 => {},
			WAIT_TIMEOUT => return Ok(None),
			_ => return Err(last_error()),
		}
		let mut code = 0_u32;
		if unsafe { GetExitCodeProcess(self.handle, &mut code) } == 0 {
			return Err(last_error());
		}
		let status = ExitStatusExt::from_raw(code);
		self.status = Some(status);
		Ok(Some(status))
	}
}

impl Drop for RetainedChild {
	fn drop(&mut self) {
		if !self.handle.is_null() && self.handle != INVALID_HANDLE_VALUE {
			unsafe { CloseHandle(self.handle) };
		}
	}
}

// SAFETY: the handle is only used while the lease's mutex is held, so exactly
// one thread observes it at a time; closing happens once in Drop.
unsafe impl Send for RetainedChild {}
unsafe impl Sync for RetainedChild {}

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
	fn drop(&mut self) {
		if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
			unsafe { CloseHandle(self.0) };
		}
	}
}

fn last_error() -> io::Error {
	io::Error::from_raw_os_error(unsafe { GetLastError() } as i32)
}

fn wide(value: &OsStr) -> Vec<u16> {
	value.encode_wide().chain(Some(0)).collect()
}

/// True when the effective token is a member of Administrators or Power Users
/// (PostgreSQL's own `pgwin32_is_admin` predicate).
fn token_is_admin() -> bool {
	unsafe {
		let authority = SECURITY_NT_AUTHORITY;
		let mut admins: PSID = ptr::null_mut();
		if AllocateAndInitializeSid(
			&authority,
			2,
			SECURITY_BUILTIN_DOMAIN_RID,
			DOMAIN_ALIAS_RID_ADMINS,
			0,
			0,
			0,
			0,
			0,
			0,
			&mut admins,
		) == 0
		{
			return true;
		}
		let mut power_users: PSID = ptr::null_mut();
		if AllocateAndInitializeSid(
			&authority,
			2,
			SECURITY_BUILTIN_DOMAIN_RID,
			DOMAIN_ALIAS_RID_POWER_USERS,
			0,
			0,
			0,
			0,
			0,
			0,
			&mut power_users,
		) == 0
		{
			FreeSid(admins);
			return true;
		}
		let mut is_admin = 0;
		let mut is_power_user = 0;
		let checked = CheckTokenMembership(ptr::null_mut(), admins, &mut is_admin) != 0
			&& CheckTokenMembership(ptr::null_mut(), power_users, &mut is_power_user) != 0;
		FreeSid(admins);
		FreeSid(power_users);
		if !checked {
			// An unknown answer must not fall through to the unrestricted path;
			// report admin so the restricted-token spawn (which fails closed on
			// its own errors) decides the outcome.
			return true;
		}
		is_admin != 0 || is_power_user != 0
	}
}

fn token_information(token: HANDLE, class: TOKEN_INFORMATION_CLASS) -> io::Result<Vec<u8>> {
	let mut length = 0_u32;
	unsafe { GetTokenInformation(token, class, ptr::null_mut(), 0, &mut length) };
	if length == 0 {
		return Err(last_error());
	}
	let mut buffer = vec![0_u8; length as usize];
	if unsafe { GetTokenInformation(token, class, buffer.as_mut_ptr().cast(), length, &mut length) }
		== 0
	{
		return Err(last_error());
	}
	Ok(buffer)
}

/// pg_ctl's `AddUserToTokenDacl`: without it the restricted token's default
/// DACL only grants SYSTEM, and the postmaster's later CreatePipe/CreateProcess
/// calls fail with access denied on administrative accounts.
fn add_user_to_token_dacl(token: HANDLE) -> io::Result<()> {
	let default_buffer = token_information(token, TokenDefaultDacl)?;
	if default_buffer.len() < size_of::<TOKEN_DEFAULT_DACL>() {
		return Err(io::Error::new(io::ErrorKind::InvalidData, "short TokenDefaultDacl"));
	}
	let default = unsafe { &*(default_buffer.as_ptr() as *const TOKEN_DEFAULT_DACL) };
	if default.DefaultDacl.is_null() {
		return Ok(());
	}
	let mut size = ACL_SIZE_INFORMATION::default();
	if unsafe {
		GetAclInformation(
			default.DefaultDacl,
			&mut size as *mut ACL_SIZE_INFORMATION as *mut core::ffi::c_void,
			size_of::<ACL_SIZE_INFORMATION>() as u32,
			AclSizeInformation,
		)
	} == 0
	{
		return Err(last_error());
	}
	let user_buffer = token_information(token, TokenUser)?;
	if user_buffer.len() < size_of::<TOKEN_USER>() {
		return Err(io::Error::new(io::ErrorKind::InvalidData, "short TokenUser"));
	}
	let user = unsafe { &*(user_buffer.as_ptr() as *const TOKEN_USER) };
	let sid_length = unsafe { GetLengthSid(user.User.Sid) } as usize;
	let new_length =
		size.AclBytesInUse as usize + size_of::<ACCESS_ALLOWED_ACE>() + sid_length - size_of::<u32>();
	let mut acl = vec![0_u8; new_length];
	let acl_ptr = acl.as_mut_ptr() as *mut ACL;
	if unsafe { InitializeAcl(acl_ptr, new_length as u32, ACL_REVISION) } == 0 {
		return Err(last_error());
	}
	for index in 0..size.AceCount {
		let mut ace: *mut core::ffi::c_void = ptr::null_mut();
		if unsafe { GetAce(default.DefaultDacl, index, &mut ace) } == 0 {
			return Err(last_error());
		}
		let ace_size = unsafe { (*(ace as *mut ACE_HEADER)).AceSize } as u32;
		if unsafe { AddAce(acl_ptr, ACL_REVISION, u32::MAX, ace, ace_size) } == 0 {
			return Err(last_error());
		}
	}
	if unsafe {
		AddAccessAllowedAceEx(acl_ptr, ACL_REVISION, OBJECT_INHERIT_ACE, GENERIC_ALL, user.User.Sid)
	} == 0
	{
		return Err(last_error());
	}
	let replacement = TOKEN_DEFAULT_DACL { DefaultDacl: acl_ptr };
	if unsafe {
		SetTokenInformation(
			token,
			TokenDefaultDacl,
			ptr::from_ref(&replacement).cast(),
			size_of::<TOKEN_DEFAULT_DACL>() as u32,
		)
	} == 0
	{
		return Err(last_error());
	}
	Ok(())
}

/// pg_ctl's `GetPrivilegesToDelete`: every privilege except the two PostgreSQL
/// keeps (`SeLockMemoryPrivilege` for large pages, `SeChangeNotifyPrivilege`
/// enabled by default) is passed to CreateRestrictedToken for deletion.
fn privileges_to_delete(token: HANDLE) -> io::Result<Vec<LUID_AND_ATTRIBUTES>> {
	let mut lock_pages = windows_sys::Win32::Foundation::LUID::default();
	let mut change_notify = windows_sys::Win32::Foundation::LUID::default();
	if unsafe { LookupPrivilegeValueW(ptr::null(), SE_LOCK_MEMORY_NAME, &mut lock_pages) } == 0
		|| unsafe { LookupPrivilegeValueW(ptr::null(), SE_CHANGE_NOTIFY_NAME, &mut change_notify) }
			== 0
	{
		return Err(last_error());
	}
	let buffer = token_information(token, TokenPrivileges)?;
	if buffer.len() < size_of::<TOKEN_PRIVILEGES>() {
		return Err(io::Error::new(io::ErrorKind::InvalidData, "short TokenPrivileges"));
	}
	let privileges = unsafe { &*(buffer.as_ptr() as *const TOKEN_PRIVILEGES) };
	let count = privileges.PrivilegeCount as usize;
	if buffer.len()
		< size_of::<TOKEN_PRIVILEGES>() + count.saturating_sub(1) * size_of::<LUID_AND_ATTRIBUTES>()
	{
		return Err(io::Error::new(io::ErrorKind::InvalidData, "truncated TokenPrivileges"));
	}
	let kept = |luid: windows_sys::Win32::Foundation::LUID| {
		(luid.LowPart == lock_pages.LowPart && luid.HighPart == lock_pages.HighPart)
			|| (luid.LowPart == change_notify.LowPart && luid.HighPart == change_notify.HighPart)
	};
	let mut deleted = Vec::with_capacity(count);
	for index in 0..count {
		let entry = unsafe { &*privileges.Privileges.as_ptr().add(index) };
		if !kept(entry.Luid) {
			deleted.push(*entry);
		}
	}
	Ok(deleted)
}

/// Build the restricted token pg_ctl hands to postgres.exe. `None` means the
/// caller's token is already unprivileged and needs no restriction.
fn restricted_token() -> io::Result<Option<OwnedHandle>> {
	if !token_is_admin() {
		return Ok(None);
	}
	unsafe {
		let mut original = OwnedHandle(ptr::null_mut());
		if OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &mut original.0) == 0 {
			return Err(last_error());
		}
		let deleted = privileges_to_delete(original.0)?;
		let authority = SECURITY_NT_AUTHORITY;
		let mut admins: PSID = ptr::null_mut();
		if AllocateAndInitializeSid(
			&authority,
			2,
			SECURITY_BUILTIN_DOMAIN_RID,
			DOMAIN_ALIAS_RID_ADMINS,
			0,
			0,
			0,
			0,
			0,
			0,
			&mut admins,
		) == 0
		{
			return Err(last_error());
		}
		let mut power_users: PSID = ptr::null_mut();
		if AllocateAndInitializeSid(
			&authority,
			2,
			SECURITY_BUILTIN_DOMAIN_RID,
			DOMAIN_ALIAS_RID_POWER_USERS,
			0,
			0,
			0,
			0,
			0,
			0,
			&mut power_users,
		) == 0
		{
			FreeSid(admins);
			return Err(last_error());
		}
		let drop_sids = [
			SID_AND_ATTRIBUTES { Sid: admins, Attributes: 0 },
			SID_AND_ATTRIBUTES { Sid: power_users, Attributes: 0 },
		];
		let mut restricted = OwnedHandle(ptr::null_mut());
		// Flags stay 0 with an explicit deletion list, exactly like pg_ctl:
		// DISABLE_MAX_PRIVILEGE would make CreateRestrictedToken ignore the
		// list and also drop SeLockMemoryPrivilege, which PostgreSQL keeps for
		// large pages.
		let created = CreateRestrictedToken(
			original.0,
			0,
			drop_sids.len() as u32,
			drop_sids.as_ptr(),
			deleted.len() as u32,
			if deleted.is_empty() { ptr::null() } else { deleted.as_ptr() },
			0,
			ptr::null(),
			&mut restricted.0,
		);
		FreeSid(admins);
		FreeSid(power_users);
		if created == 0 {
			return Err(last_error());
		}
		add_user_to_token_dacl(restricted.0)?;
		Ok(Some(restricted))
	}
}

/// Rust std 1.98.1's make_command_line/append_arg for regular arguments
/// (rust-lang/rust 48a229cea, library/std/src/sys/{process,args}/windows.rs).
/// Only empty arguments or those containing spaces/tabs get outer quotes;
/// explicit interpreters such as cmd.exe depend on this exact distinction.
fn command_line(command: &Command) -> Vec<u16> {
	let mut line = vec![u16::from(b'"')];
	line.extend(command.get_program().encode_wide());
	line.push(u16::from(b'"'));
	for argument in command.get_args() {
		line.push(u16::from(b' '));
		let quote = argument.is_empty()
			|| argument.as_encoded_bytes().iter().any(|c| matches!(c, b' ' | b'\t'));
		if quote {
			line.push(u16::from(b'"'));
		}
		let mut backslashes = 0;
		for character in argument.encode_wide() {
			if character == u16::from(b'\\') {
				backslashes += 1;
			} else {
				if character == u16::from(b'"') {
					line.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes + 1));
				}
				backslashes = 0;
			}
			line.push(character);
		}
		if quote {
			line.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes));
			line.push(u16::from(b'"'));
		}
	}
	line.push(0);
	line
}

/// Rust std 1.98.1's make_bat_command_line/append_bat_arg, for the regular
/// arguments exposed by the retained API. Source: rust-lang/rust 48a229cea,
/// library/std/src/sys/args/windows.rs. cmd parsing is not native argv parsing:
/// keep the outer quotes, expansion defenses and rejection rules together.
fn batch_command_line(script: &[u16], command: &Command) -> io::Result<Vec<u16>> {
	if script.contains(&u16::from(b'"')) || script.last() == Some(&u16::from(b'\\')) {
		return Err(io::Error::new(
			io::ErrorKind::InvalidInput,
			"Windows file names may not contain `\"` or end with `\\`",
		));
	}
	// Select command extensions for the % defense, disable delayed ! expansion
	// and AutoRun commands. The system interpreter, never PATH/COMSPEC, runs
	// under the same restricted token and inherits the same stdio as postgres.
	let mut line: Vec<u16> = "cmd.exe /e:ON /v:OFF /d /c \"\"".encode_utf16().collect();
	line.extend_from_slice(script.strip_suffix(&[0]).unwrap_or(script));
	line.push(u16::from(b'"'));
	for argument in command.get_args() {
		if argument.as_encoded_bytes().iter().any(|c| matches!(c, b'\r' | b'\n')) {
			return Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"batch file arguments are invalid",
			));
		}
		line.push(u16::from(b' '));
		append_batch_argument(&mut line, argument);
	}
	line.extend([u16::from(b'"'), 0]);
	Ok(line)
}

fn append_batch_argument(line: &mut Vec<u16>, argument: &OsStr) {
	let quote = argument.is_empty()
		|| argument.as_encoded_bytes().last() == Some(&b'\\')
		|| argument.to_string_lossy().chars().any(|c| {
			(c.is_ascii() && !(c.is_ascii_alphanumeric() || r"#$*+-./:?@\_".contains(c)))
				|| c.is_control()
		});
	if quote {
		line.push(u16::from(b'"'));
	}
	let mut backslashes = 0;
	for character in argument.encode_wide() {
		if character == u16::from(b'\\') {
			backslashes += 1;
		} else {
			if character == u16::from(b'"') {
				line.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes));
				line.push(u16::from(b'"'));
			} else if character == u16::from(b'%') {
				// %%cd:~,% expands an empty substring of the built-in cwd,
				// preventing cmd from expanding an argument's %VARIABLE%.
				line.extend("%%cd:~,".encode_utf16());
			}
			backslashes = 0;
		}
		line.push(character);
	}
	if quote {
		line.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes));
		line.push(u16::from(b'"'));
	}
}

/// Aligned attribute storage whose borrowed values outlive list deletion.
/// https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
struct HandleAttributeList<'a> {
	list: LPPROC_THREAD_ATTRIBUTE_LIST,
	initialized: bool,
	_handles: std::marker::PhantomData<&'a [HANDLE]>,
}

impl<'a> HandleAttributeList<'a> {
	fn new(attributes: &[(u32, &'a [HANDLE])]) -> io::Result<Self> {
		let count = attributes.len() as u32;
		let mut size = 0;
		unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), count, 0, &mut size) };
		// The first call is documented to fail while returning the required size.
		if size == 0 {
			return Err(last_error());
		}
		let list = unsafe { HeapAlloc(GetProcessHeap(), 0, size) };
		if list.is_null() {
			return Err(io::ErrorKind::OutOfMemory.into());
		}
		let mut owned = Self { list, initialized: false, _handles: std::marker::PhantomData };
		if unsafe { InitializeProcThreadAttributeList(list, count, 0, &mut size) } == 0 {
			return Err(last_error());
		}
		owned.initialized = true;
		for (attribute, handles) in attributes {
			if unsafe {
				UpdateProcThreadAttribute(
					list,
					0,
					*attribute as usize,
					handles.as_ptr().cast(),
					std::mem::size_of_val(*handles),
					ptr::null_mut(),
					ptr::null(),
				)
			} == 0
			{
				return Err(last_error());
			}
		}
		Ok(owned)
	}
}

impl Drop for HandleAttributeList<'_> {
	fn drop(&mut self) {
		unsafe {
			if self.initialized {
				DeleteProcThreadAttributeList(self.list);
			}
			HeapFree(GetProcessHeap(), 0, self.list);
		}
	}
}

/// Inheritable handles exist ONLY in this never-executed process, so even
/// unrelated inherit-all std spawns cannot acquire them. The launcher itself
/// still creates the real child and owns its exact creation HANDLE.
/// https://devblogs.microsoft.com/oldnewthing/20200306-00/?p=103538
struct HandleContainer {
	process: OwnedHandle,
	job: Option<OwnedHandle>,
}

impl HandleContainer {
	fn new() -> io::Result<Self> {
		let application = wide(std::env::current_exe()?.as_os_str());
		let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
		if job.is_null() {
			return Err(last_error());
		}
		let job = OwnedHandle(job);
		let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
		// Only the container belongs to this job. Silent breakaway leaves the
		// real child in the caller's original job chain, never in this guard.
		limits.BasicLimitInformation.LimitFlags =
			JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
		if unsafe {
			SetInformationJobObject(
				job.0,
				JobObjectExtendedLimitInformation,
				(&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
				size_of_val(&limits) as u32,
			)
		} == 0
		{
			return Err(last_error());
		}
		let jobs = [job.0];
		let attributes = HandleAttributeList::new(&[(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)])?;
		let startup = STARTUPINFOEXW {
			StartupInfo: STARTUPINFOW { cb: size_of::<STARTUPINFOEXW>() as u32, ..Default::default() },
			lpAttributeList: attributes.list,
		};
		let mut information = PROCESS_INFORMATION::default();
		// JOB_LIST attaches atomically: no crash gap between creating a
		// suspended process and assigning its kill-on-close job. No helper code,
		// loader initialization, inherited handles, IPC or packaged binary.
		if unsafe {
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
				&mut information,
			)
		} == 0
		{
			return Err(last_error());
		}
		drop(OwnedHandle(information.hThread));
		Ok(Self { process: OwnedHandle(information.hProcess), job: Some(job) })
	}

	fn duplicate(&self, handle: HANDLE) -> io::Result<HANDLE> {
		let mut duplicate = ptr::null_mut();
		if unsafe {
			DuplicateHandle(
				GetCurrentProcess(),
				handle,
				self.process.0,
				&mut duplicate,
				0,
				1,
				DUPLICATE_SAME_ACCESS,
			)
		} == 0
		{
			return Err(last_error());
		}
		// This value belongs to the REMOTE handle table, not an OwnedHandle in
		// ours. Container termination closes all partial/successful duplicates.
		Ok(duplicate)
	}

	fn stdio(&self, stdout: HANDLE, stderr: HANDLE) -> io::Result<[HANDLE; 3]> {
		let input = OwnedHandle(null_input_handle()?);
		Ok([self.duplicate(input.0)?, self.duplicate(stdout)?, self.duplicate(stderr)?])
	}
}

impl Drop for HandleContainer {
	fn drop(&mut self) {
		// All handles to this unnamed job are local and noninheritable; closing
		// it also works on abort/crash. The never-run container has no pending
		// user-mode I/O, and is reaped before its creation HANDLE is released.
		drop(self.job.take());
		unsafe { WaitForSingleObject(self.process.0, INFINITE) };
	}
}

/// Local NUL stays noninheritable, just like the caller's log files.
fn null_input_handle() -> io::Result<HANDLE> {
	let path: Vec<u16> = OsStr::new("NUL").encode_wide().chain(Some(0)).collect();
	let handle = unsafe {
		CreateFileW(
			path.as_ptr(),
			GENERIC_READ,
			FILE_SHARE_READ | FILE_SHARE_WRITE,
			ptr::null(),
			OPEN_EXISTING,
			0,
			ptr::null_mut(),
		)
	};
	if handle == INVALID_HANDLE_VALUE {
		return Err(last_error());
	}
	Ok(handle)
}

/// Match Rust std 1.98's resolve_exe/search_paths, not CreateProcess's default
/// search (which ignores the child's PATH and searches the caller's cwd).
/// Source: rust-lang/rust 48a229cea, library/std/src/sys/process/windows.rs.
fn resolve_executable(command: &Command) -> io::Result<Vec<u16>> {
	let executable = command.get_program();
	let bytes = executable.as_encoded_bytes();
	let verbatim = bytes.starts_with(br"\\?\");
	if bytes.is_empty() || bytes.last() == Some(&b'\\') || (!verbatim && bytes.last() == Some(&b'/'))
	{
		return Err(io::Error::new(io::ErrorKind::InvalidInput, "program path has no file name"));
	}
	let exists = |path: &Path| {
		let path = application_path(path).ok()?;
		(unsafe { GetFileAttributesW(path.as_ptr()) } != INVALID_FILE_ATTRIBUTES).then_some(path)
	};
	// A subpath is relative to the caller, never the requested child cwd.
	if bytes.iter().any(|c| matches!(c, b'/' | b'\\')) {
		if !bytes
			.get(bytes.len().saturating_sub(4)..)
			.is_some_and(|suffix| suffix.eq_ignore_ascii_case(b".exe"))
		{
			let mut appended = executable.to_os_string();
			appended.push(".exe");
			if let Some(path) = exists(Path::new(&appended)) {
				return Ok(path);
			}
		}
		return application_path(Path::new(executable));
	}
	let mut name = executable.to_os_string();
	if !bytes.contains(&b'.') {
		name.push(".exe");
	}
	let search = |paths: &OsStr| {
		std::env::split_paths(paths)
			.filter(|path| !path.as_os_str().is_empty())
			.find_map(|path| exists(&path.join(&name)))
	};
	// Explicit child PATH first; an empty or removed PATH still permits the
	// application/system directories and the parent's PATH, as std does.
	if let Some(paths) = command.get_envs().find_map(|(key, value)| {
		key.as_encoded_bytes().eq_ignore_ascii_case(b"PATH").then_some(value).flatten()
	}) && let Some(path) = search(paths)
	{
		return Ok(path);
	}
	if let Ok(mut path) = std::env::current_exe() {
		path.pop();
		if let Some(path) = exists(&path.join(&name)) {
			return Ok(path);
		}
	}
	for directory in [GetSystemDirectoryW, GetWindowsDirectoryW] {
		if let Ok(path) = system_directory(directory)
			&& let Some(path) = exists(&path.join(&name))
		{
			return Ok(path);
		}
	}
	if let Some(paths) = std::env::var_os("PATH")
		&& let Some(path) = search(&paths)
	{
		return Ok(path);
	}
	Err(io::Error::new(io::ErrorKind::NotFound, "program not found"))
}

fn system_directory(get: unsafe extern "system" fn(*mut u16, u32) -> u32) -> io::Result<PathBuf> {
	let mut buffer = vec![0; 260];
	loop {
		let length = unsafe { get(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
		if length == 0 {
			return Err(last_error());
		}
		if length < buffer.len() {
			return Ok(OsString::from_wide(&buffer[..length]).into());
		}
		buffer.resize(length + 1, 0);
	}
}

fn application_path(path: &Path) -> io::Result<Vec<u16>> {
	// std's get_long_path also preserves the NT namespace prefix, which
	// std::path::absolute otherwise treats as a drive-relative rooted path.
	if path.as_os_str().as_encoded_bytes().starts_with(br"\??\") {
		return Ok(wide(path.as_os_str()));
	}
	// std::path::absolute uses GetFullPathNameW without following symlinks and
	// leaves verbatim paths untouched. Retain Win32's normalization of unusual
	// valid names; canonicalize would require existence and change that behavior.
	let absolute = std::path::absolute(path)?;
	let text = absolute.as_os_str();
	let bytes = text.as_encoded_bytes();
	let mut result = wide(text);
	// std's to_user_path/get_long_path uses a verbatim prefix for long paths.
	if result.len() >= 248 && !bytes.starts_with(br"\\?\") && !bytes.starts_with(br"\??\") {
		let (prefix, start) = if bytes.starts_with(br"\\.\") {
			(r"\\?\", 4)
		} else if bytes.starts_with(br"\\") {
			(r"\\?\UNC\", 2)
		} else {
			(r"\\?\", 0)
		};
		result = prefix.encode_utf16().chain(result[start..].iter().copied()).collect();
	}
	// std's to_user_path strips short verbatim disk/UNC prefixes only when
	// GetFullPathNameW leaves the unprefixed spelling completely unchanged.
	if result.len() <= 260 {
		let candidate = if bytes.starts_with(br"\\?\UNC\") {
			Some([&[b'\\' as u16, b'\\' as u16][..], &result[8..result.len() - 1]].concat())
		} else if bytes.starts_with(br"\\?\") && bytes.get(5..7) == Some(br":\") {
			Some(result[4..result.len() - 1].to_vec())
		} else {
			None
		};
		if let Some(candidate) = candidate {
			let text = OsString::from_wide(&candidate);
			if std::path::absolute(&text)?.as_os_str() == text {
				result = candidate;
				result.push(0);
			}
		}
	}
	Ok(result)
}

/// Match std's make_dirp/is_absolute_exact (Rust 48a229cea). Unlike executable
/// paths, cwd is not made absolute or converted to a long path. Strip a verbatim
/// prefix only when GetFullPathNameW preserves every UTF-16 code unit, including
/// the terminator; otherwise keep the caller's spelling and Win32's rejection.
fn directory_path(directory: &Path) -> Vec<u16> {
	let mut path = wide(directory.as_os_str());
	let start = if path.starts_with(&r"\\?\UNC".encode_utf16().collect::<Vec<_>>()) {
		path[6] = u16::from(b'\\');
		6
	} else if path.starts_with(&r"\\?\".encode_utf16().collect::<Vec<_>>()) {
		4
	} else {
		return path;
	};
	let candidate = &path[start..];
	let mut absolute = vec![0; candidate.len()];
	let length = unsafe {
		GetFullPathNameW(
			candidate.as_ptr(),
			absolute.len() as u32,
			absolute.as_mut_ptr(),
			ptr::null_mut(),
		)
	} as usize;
	if length != 0 && length == candidate.len() - 1 && absolute == candidate {
		absolute
	} else {
		if start == 6 {
			path[6] = u16::from(b'C');
		}
		path
	}
}

fn validate_command(command: &Command) -> io::Result<()> {
	let no_nuls = |value: &OsStr| {
		if value.as_encoded_bytes().contains(&0) {
			Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"strings passed to WinAPI cannot contain NULs",
			))
		} else {
			Ok(())
		}
	};
	no_nuls(command.get_program())?;
	for argument in command.get_args() {
		no_nuls(argument)?;
	}
	if let Some(directory) = command.get_current_dir() {
		no_nuls(directory.as_os_str())?;
	}
	for (name, value) in command.get_envs() {
		// Removed entries are not serialized, matching std's make_envp.
		if let Some(value) = value {
			no_nuls(name)?;
			no_nuls(value)?;
		}
	}
	Ok(())
}

/// Spawn `command` with the caller's log-file handles as the child's
/// stdout/stderr. Returns the exact process handle as the retained child.
pub fn spawn(
	command: &mut Command,
	stdout: &std::fs::File,
	stderr: &std::fs::File,
) -> io::Result<RetainedChild> {
	use std::os::windows::io::AsRawHandle;
	let Some(token) = restricted_token()? else {
		// Unprivileged caller: keep the exact std spawn path.
		command
			.stdin(Stdio::null())
			.stdout(Stdio::from(stdout.try_clone()?))
			.stderr(Stdio::from(stderr.try_clone()?));
		let child = command.spawn()?;
		return Ok(retain_from_child(child));
	};
	// Manual Win32 buffers must retain Command's rejection boundary before
	// serialization can turn a NUL into truncation or an environment entry.
	validate_command(command)?;
	unsafe {
		let mut application = resolve_executable(command)?;
		// Resolution already normalizes non-verbatim paths, as std does before
		// checking the final filename. Only batch files use an interpreter; the
		// retained HANDLE is cmd's in that case, matching Command::spawn.
		let is_batch = matches!(
			application.strip_suffix(&[0]).and_then(|path| path.get(path.len().checked_sub(4)?..)),
			Some([46, 98 | 66, 97 | 65, 116 | 84] | [46, 99 | 67, 109 | 77, 100 | 68])
		);
		let mut line = if is_batch {
			let line = batch_command_line(&application, command)?;
			application = wide(system_directory(GetSystemDirectoryW)?.join("cmd.exe").as_os_str());
			line
		} else {
			command_line(command)
		};
		debug_assert_eq!(line.last(), Some(&0), "WinAPI requires a terminated command line");
		let cwd = command.get_current_dir().map(directory_path);
		let environment = environment_block(command)?;
		let container = HandleContainer::new()?;
		let handles = container.stdio(stdout.as_raw_handle(), stderr.as_raw_handle())?;
		let parent = [container.process.0];
		let attributes = HandleAttributeList::new(&[
			(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles),
			(PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, &parent),
		])?;
		let startup = STARTUPINFOEXW {
			StartupInfo: STARTUPINFOW {
				cb: size_of::<STARTUPINFOEXW>() as u32,
				dwFlags: STARTF_USESTDHANDLES,
				hStdInput: handles[0],
				hStdOutput: handles[1],
				hStdError: handles[2],
				..STARTUPINFOW::default()
			},
			lpAttributeList: attributes.list,
		};
		let mut information = PROCESS_INFORMATION::default();
		let created = CreateProcessAsUserW(
			token.0,
			application.as_ptr(),
			line.as_mut_ptr(),
			ptr::null(),
			ptr::null(),
			1,
			CREATION_FLAGS | CREATE_UNICODE_ENVIRONMENT_FLAG | EXTENDED_STARTUPINFO_PRESENT,
			environment.as_ptr().cast(),
			cwd.as_ref().map_or(ptr::null(), |dir| dir.as_ptr()),
			&startup.StartupInfo,
			&mut information,
		);
		let failure = if created == 0 { Some(last_error()) } else { None };
		drop(attributes);
		drop(container);
		if let Some(error) = failure {
			return Err(error);
		}
		// No post-creation setup is needed: launch running, so a ResumeThread
		// failure cannot abandon a suspended process without a returned lease.
		drop(OwnedHandle(information.hThread));
		Ok(RetainedChild { handle: information.hProcess, pid: information.dwProcessId, status: None })
	}
}

/// Transfer only the std Child's process handle. Consuming Child also drops its
/// main-thread handle; forgetting Child would leak that separate resource.
fn retain_from_child(child: Child) -> RetainedChild {
	use std::os::windows::io::IntoRawHandle;
	let pid = child.id();
	let handle = child.into_raw_handle();
	RetainedChild { handle, pid, status: None }
}

/// Reproduce std's env merge semantics: the caller's overrides replace
/// inherited values with case-insensitive Windows names, removals drop them,
/// and the block is sorted case-insensitively as CreateProcess requires.
fn environment_block(command: &Command) -> io::Result<Vec<u16>> {
	let block = unsafe { GetEnvironmentStringsW() };
	if block.is_null() {
		return Err(last_error());
	}
	let mut entries: Vec<(Vec<u16>, Vec<u16>)> = Vec::new();
	unsafe {
		let mut cursor = block;
		while *cursor != 0 {
			let mut end = cursor;
			while *end != 0 {
				end = end.add(1);
			}
			let text = std::slice::from_raw_parts(cursor, end.offset_from(cursor) as usize);
			// Preserve raw UTF-16, including hidden per-drive names such as =C:.
			if let Some(separator) =
				text.iter().enumerate().skip(1).find_map(|(i, c)| (*c == u16::from(b'=')).then_some(i))
			{
				entries.push((text[..separator].to_vec(), text[separator + 1..].to_vec()));
			}
			cursor = end.add(1);
		}
		FreeEnvironmentStringsW(block);
	}
	for (name, value) in command.get_envs() {
		let name: Vec<u16> = name.encode_wide().collect();
		let mut retained = Vec::with_capacity(entries.len() + 1);
		for entry in entries {
			if compare_environment_names(&entry.0, &name)? != std::cmp::Ordering::Equal {
				retained.push(entry);
			}
		}
		if let Some(value) = value {
			retained.push((name, value.encode_wide().collect()));
		}
		entries = retained;
	}
	let mut comparison_error = None;
	entries.sort_by(|(left, _), (right, _)| {
		compare_environment_names(left, right).unwrap_or_else(|error| {
			comparison_error = Some(error);
			std::cmp::Ordering::Equal
		})
	});
	if let Some(error) = comparison_error {
		return Err(error);
	}
	let mut block = Vec::new();
	for (name, value) in entries {
		block.extend(name);
		block.push(u16::from(b'='));
		block.extend(value);
		block.push(0);
	}
	block.push(0);
	if block.len() == 1 {
		block.push(0);
	}
	Ok(block)
}

fn compare_environment_names(left: &[u16], right: &[u16]) -> io::Result<std::cmp::Ordering> {
	let length = |text: &[u16]| {
		i32::try_from(text.len()).map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
	};
	let result = unsafe {
		CompareStringOrdinal(left.as_ptr(), length(left)?, right.as_ptr(), length(right)?, 1)
	};
	match result {
		1 => Ok(std::cmp::Ordering::Less),
		2 => Ok(std::cmp::Ordering::Equal),
		3 => Ok(std::cmp::Ordering::Greater),
		_ => Err(last_error()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn failed_process_observation_is_not_reported_as_running() {
		let mut child = RetainedChild { handle: ptr::null_mut(), pid: 0, status: None };
		assert!(child.try_wait().is_err());
	}

	#[test]
	fn failed_stdio_setup_closes_all_created_handles() {
		use std::os::windows::io::AsRawHandle;
		use windows_sys::Win32::System::Threading::GetProcessHandleCount;
		const FIXTURE: &str = "ATOMIC_STDIO_HANDLE_FAILURE";
		if std::env::var_os(FIXTURE).is_none() {
			let output = Command::new(std::env::current_exe().unwrap())
				.args(["failed_stdio_setup_closes_all_created_handles", "--nocapture"])
				.env(FIXTURE, "1")
				.output()
				.unwrap();
			assert!(
				output.status.success(),
				"{}{}",
				String::from_utf8_lossy(&output.stdout),
				String::from_utf8_lossy(&output.stderr)
			);
			return;
		}
		let output = std::fs::File::open("NUL").unwrap();
		let handles = || {
			let mut count = 0;
			assert_ne!(unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut count) }, 0);
			count
		};
		// CreateProcess's one-time OS initialization opens two persistent handles,
		// also observed with plain std. Measure repeated failures after that control.
		let cold = handles();
		assert!(
			Command::new(system_directory(GetSystemDirectoryW).unwrap().join("cmd.exe"))
				.args(["/d", "/c", "exit", "0"])
				.stdin(Stdio::null())
				.stdout(Stdio::null())
				.stderr(Stdio::null())
				.status()
				.unwrap()
				.success()
		);
		eprintln!("plain std initialization handles: {cold} -> {}", handles());
		let before = handles();
		for _ in 0..20 {
			// The last duplicate fails after stdin/stdout were already acquired.
			let container = HandleContainer::new().unwrap();
			assert!(container.stdio(output.as_raw_handle(), ptr::null_mut()).is_err());
			drop(container);
		}
		assert_eq!(handles(), before);
	}
}

#[cfg(test)]
#[path = "windows_spawn_lifecycle.rs"]
mod lifecycle_tests;
