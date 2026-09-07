use super::*;

#[napi(string_enum = "kebab-case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OwnerCloseCause {
	SessionClose,
	StageClose,
	AppShutdown,
}

#[napi(discriminant = "kind", discriminant_case = "kebab-case")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OwnerScope {
	Session { session_id: String },
	WorkflowStage { session_id: String, run_id: String, stage_id: String, stage_attempt_id: String },
}
#[napi(object)]
#[derive(Clone, Debug, PartialEq)]
pub struct OwnerSnapshot {
	pub owner_id: String,
	pub scope: OwnerScope,
	pub generation: String,
	pub state: String,
	pub tasks: Vec<TaskRecord>,
	pub cursor: Cursor,
}
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnerCloseReceipt {
	pub owner_id: String,
	pub state: String,
	pub tasks: Vec<CancelReceipt>,
}
pub(super) struct Owner {
	pub cap: Cap,
	pub scope: OwnerScope,
	pub state: String,
	pub tasks: Vec<Task>,
}
impl Actor {
	pub(super) fn bind(&self, scope: OwnerScope) -> HostSession {
		HostSession { environment: self.id, scope }
	}
	pub(super) fn open(&self, host: &HostSession, scope: OwnerScope) -> Door<OwnerLease> {
		let mut s = self.state.lock().unwrap();
		if s.closing {
			return Err(fail("EnvironmentClosing"));
		}
		if host.environment != self.id || host.scope != scope {
			return Err(fail("ScopeMismatch"));
		}
		if let Some(o) = s.owners.iter().find(|o| o.scope == scope) {
			return if o.state == "open" {
				Ok(OwnerLease { cap: o.cap.clone() })
			} else {
				Err(fail("ScopeMismatch"))
			};
		}
		let cap = Cap {
			environment: self.id,
			owner: s.owners.len(),
			generation: self.id,
			task: None,
			attempt: 0,
		};
		s.owners.push(Owner { cap: cap.clone(), scope, state: "open".into(), tasks: vec![] });
		Ok(OwnerLease { cap })
	}
	pub(super) fn begin_close(&self, owner: &OwnerLease) -> Door<()> {
		let mut s = self.state.lock().unwrap();
		if s.closing {
			return Err(fail("EnvironmentClosing"));
		}
		let oi = s.owner(self.id, &owner.cap, "EnvironmentClosing")?;
		s.begin_close(oi);
		drop(s);
		self.changed.notify_waiters();
		Ok(())
	}
	pub(super) fn close_receipt(&self, owner: &OwnerLease) -> Door<Option<OwnerCloseReceipt>> {
		let s = self.state.lock().unwrap();
		if s.closing {
			return Err(fail("EnvironmentClosing"));
		}
		let oi = s.owner(self.id, &owner.cap, "EnvironmentClosing")?;
		let o = &s.owners[oi];
		if let Some(error) = o.tasks.iter().find_map(Task::cleanup_failure) {
			return Err(error);
		}
		Ok((o.state == "closed").then(|| OwnerCloseReceipt {
			owner_id: o.cap.owner_id(),
			state: "closed".into(),
			tasks: o.tasks.iter().map(Task::receipt).collect(),
		}))
	}
	#[cfg(test)]
	pub(super) fn snapshot(&self, owner: &OwnerLease) -> Door<OwnerSnapshot> {
		let s = self.state.lock().unwrap();
		let oi = s.owner(self.id, &owner.cap, "StaleGeneration")?;
		Ok(s.snapshot(oi))
	}
	pub(super) fn shutdown(&self) {
		let mut s = self.state.lock().unwrap();
		s.closing = true;
		for oi in 0..s.owners.len() {
			s.begin_close(oi);
		}
		s.subscriptions.clear();
		for record in s.waits.values().filter_map(std::sync::Weak::upgrade) {
			record.lock().unwrap().finish(Err(fail("EnvironmentClosing")));
		}
		drop(s);
		self.changed.notify_waiters();
	}
}
impl State {
	pub fn owner(&self, environment: u64, cap: &Cap, code: &str) -> Door<usize> {
		if cap.environment != environment || cap.task.is_some() {
			return Err(fail(code));
		}
		self
			.owners
			.get(cap.owner)
			.filter(|o| o.cap == *cap)
			.map(|_| cap.owner)
			.ok_or_else(|| fail(code))
	}
	pub fn task(&self, environment: u64, cap: &Cap, code: &str) -> Door<(usize, usize)> {
		if cap.environment != environment {
			return Err(fail(code));
		}
		let ti = cap.task.ok_or_else(|| fail(code))?;
		self
			.owners
			.get(cap.owner)
			.and_then(|o| o.tasks.get(ti))
			.filter(|t| t.cap == *cap)
			.map(|_| (cap.owner, ti))
			.ok_or_else(|| fail(code))
	}
	pub fn runner(&self, environment: u64, cap: &Cap) -> Door<(usize, usize)> {
		let (oi, ti) = self.task(environment, cap, "StaleAttempt")?;
		if !self.owners[oi].tasks[ti].claimed {
			return Err(fail("StaleAttempt"));
		}
		Ok((oi, ti))
	}
	pub fn begin_close(&mut self, oi: usize) {
		if self.owners[oi].state != "open" {
			return;
		}
		self.owners[oi].state = "closing".into();
		self.emit(oi, None, TaskEvent::OwnerClosing {});
		for ti in 0..self.owners[oi].tasks.len() {
			if matches!(self.owners[oi].tasks[ti].record.execution, Execution::Settled { .. }) {
				continue;
			}
			let t = &mut self.owners[oi].tasks[ti];
			t.record.attention = Attention::None {};
			let observation = HostObservation::None { reason: "owner-closing".into() };
			t.record.observation = observation.clone();
			let reference = t.record.reference.clone();
			self.emit(
				oi,
				Some(reference.task_id.clone()),
				TaskEvent::HostObservationChanged { reference, observation },
			);
			self.cancel(oi, ti, CancelCause::OwnerClose);
		}
		self.finish_close(oi);
	}
	pub fn finish_close(&mut self, oi: usize) {
		if self.owners[oi].state == "closing"
			&& self.owners[oi].tasks.iter().all(|t| matches!(t.record.cleanup, Cleanup::Reaped {}))
		{
			self.owners[oi].state = "closed".into();
			self.emit(oi, None, TaskEvent::OwnerClosed {});
		}
	}
	pub fn snapshot(&self, oi: usize) -> OwnerSnapshot {
		let o = &self.owners[oi];
		OwnerSnapshot {
			owner_id: o.cap.owner_id(),
			scope: o.scope.clone(),
			generation: o.cap.generation.to_string(),
			state: o.state.clone(),
			tasks: o.tasks.iter().map(|t| t.record.clone()).collect(),
			cursor: self.cursor(oi),
		}
	}
}
