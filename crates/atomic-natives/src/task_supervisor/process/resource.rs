#[cfg(unix)]
use super::*;

#[cfg(unix)]
pub(super) enum ProcessResource {
	Pipe(std::process::Child),
	Pty(crate::pty::SupervisedPty),
}
#[cfg(unix)]
impl ProcessResource {
	pub(super) fn id(&self) -> u32 {
		match self {
			Self::Pipe(child) => child.id(),
			Self::Pty(pty) => pty.child.process_id().expect("portable-pty Unix child has PID"),
		}
	}
	pub(super) fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
		match self {
			Self::Pipe(child) => child.try_wait(),
			Self::Pty(pty) => {
				let child: &mut dyn portable_pty::Child = &mut *pty.child;
				child
					.downcast_mut::<std::process::Child>()
					.ok_or_else(|| io::Error::other("portable-pty did not return Unix Child"))?
					.try_wait()
			},
		}
	}
}
