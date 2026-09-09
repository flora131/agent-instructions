use super::*;

#[test]
fn conpty_unconfirmed_reader_is_retained_until_joinable() {
	let (release, blocked) = std::sync::mpsc::channel();
	let reader = std::thread::spawn(move || {
		blocked.recv_timeout(Duration::from_secs(5)).map_err(io::Error::other)?;
		Ok(())
	});
	let id = reader.thread().id();
	let mut console = PseudoConsole(ConsoleState { reader: Some(reader), ..Default::default() });
	assert!(!console.close_until(Instant::now() + Duration::from_millis(10)));
	drop(console);
	assert!(
		FAILED_CONSOLES
			.lock()
			.unwrap()
			.iter()
			.any(|state| state.reader.as_ref().is_some_and(|reader| reader.thread().id() == id))
	);
	release.send(()).unwrap();
	let deadline = Instant::now() + PROCESS_DRAIN_GRACE;
	loop {
		poll_failed_consoles();
		if !FAILED_CONSOLES
			.lock()
			.unwrap()
			.iter()
			.any(|state| state.reader.as_ref().is_some_and(|reader| reader.thread().id() == id))
		{
			break;
		}
		assert!(Instant::now() < deadline, "retained reader was not joined");
		std::thread::sleep(PROCESS_POLL);
	}
}
#[test]
fn conpty_output_error_survives_final_join_probe() {
	let reader = std::thread::spawn(|| Err(io::Error::other("fixture drain failure")));
	let mut console = PseudoConsole(ConsoleState { reader: Some(reader), ..Default::default() });
	assert!(console.close_until(Instant::now() + PROCESS_DRAIN_GRACE));
	assert_eq!(console.failure().as_deref(), Some("fixture drain failure"));
	assert_eq!(console.failure().as_deref(), Some("fixture drain failure"));
}
