//! Command output retention (RFC #2884). Process resource wiring follows separately.
// Local until the next milestone attaches the process resource; no exported API yet.
#![allow(dead_code)]
use std::{
	collections::VecDeque,
	fs::{File, OpenOptions},
	io::{self, Read, Seek, SeekFrom, Write},
	path::PathBuf,
};

const COMMAND_LIVE_BYTES: usize = 1_048_576;
const FOREGROUND_SPILL_BYTES: usize = 8_388_608;
const TASK_DISK_BYTES: u64 = 5_368_709_120;
const DETAIL_TAIL_BYTES: usize = 8_192;

#[derive(Debug, PartialEq, Eq)]
struct OutputOffsets {
	start: String,
	end: String,
}
impl OutputOffsets {
	fn new(start: u64, end: u64) -> Self {
		Self { start: start.to_string(), end: end.to_string() }
	}
}
#[derive(Debug)]
struct OutputChunk {
	offsets: OutputOffsets,
	bytes: Vec<u8>,
}
#[derive(Debug)]
struct OutputPage {
	requested: OutputOffsets,
	chunks: Vec<OutputChunk>,
	omitted_ranges: Vec<OutputOffsets>,
	next_offset: Option<String>,
}

/// Raw bytes retain original offsets, even when a cap splits a UTF-8 character.
/// Consumers decoding adjacent chunks use Utf8Carry, not per-chunk lossy decoding.
struct OutputStore {
	path: PathBuf,
	live_limit: usize,
	spill_threshold: usize,
	disk_cap: u64,
	byte_count: u64,
	head: Vec<u8>,
	tail: VecDeque<u8>,
	foreground: Vec<u8>,
	spilled: bool,
	file: Option<File>,
	disk_len: u64,
	unavailable: bool,
}
impl OutputStore {
	fn new(path: PathBuf, live_limit: usize, spill_threshold: usize, disk_cap: u64) -> Self {
		Self {
			path,
			live_limit,
			spill_threshold,
			disk_cap,
			byte_count: 0,
			head: Vec::new(),
			tail: VecDeque::new(),
			foreground: Vec::new(),
			spilled: false,
			file: None,
			disk_len: 0,
			unavailable: false,
		}
	}
	fn append(&mut self, bytes: &[u8]) {
		let head_room = (self.live_limit / 2).saturating_sub(self.head.len());
		self.head.extend_from_slice(&bytes[..head_room.min(bytes.len())]);
		let tail_limit = self.live_limit - self.live_limit / 2;
		if bytes.len() >= tail_limit {
			self.tail.clear();
			self.tail.extend(&bytes[bytes.len() - tail_limit..]);
		} else {
			let evict = (self.tail.len() + bytes.len()).saturating_sub(tail_limit);
			self.tail.drain(..evict);
			self.tail.extend(bytes);
		}
		self.byte_count += bytes.len() as u64;
		if self.spilled {
			self.write_disk(bytes);
			return;
		}
		let keep = (self.spill_threshold - self.foreground.len()).min(bytes.len());
		self.foreground.extend_from_slice(&bytes[..keep]);
		if self.foreground.len() == self.spill_threshold {
			self.background();
			self.write_disk(&bytes[keep..]);
		}
	}
	/// Idempotent transition: synchronous bounded writes, no retry queue.
	fn background(&mut self) {
		if self.spilled {
			return;
		}
		self.spilled = true;
		match OpenOptions::new().read(true).write(true).create_new(true).open(&self.path) {
			Ok(file) => self.file = Some(file),
			Err(_) => self.unavailable = true,
		}
		let prefix = std::mem::take(&mut self.foreground);
		self.write_disk(&prefix);
	}
	fn write_disk(&mut self, bytes: &[u8]) {
		if self.unavailable {
			return;
		}
		let Some(file) = self.file.as_mut() else {
			return;
		};
		let count = (self.disk_cap - self.disk_len).min(bytes.len() as u64) as usize;
		let mut remaining = &bytes[..count];
		if file.seek(SeekFrom::Start(self.disk_len)).is_err() {
			self.unavailable = true;
			return;
		}
		while !remaining.is_empty() {
			match file.write(remaining) {
				Ok(0) => {
					self.unavailable = true;
					break;
				},
				Ok(n) => {
					self.disk_len += n as u64;
					remaining = &remaining[n..];
				},
				Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
				Err(_) => {
					self.unavailable = true;
					break;
				},
			}
		}
	}
	/// Snapshot owned segments; gaps are explicit, never concatenated ambiguously.
	fn page(&mut self, start: u64, maximum: u64) -> OutputPage {
		let end = start.saturating_add(maximum).min(self.byte_count).max(start);
		let mut segments: Vec<(u64, Vec<u8>)> = Vec::new();
		let disk_end = end.min(self.disk_len);
		if start < disk_end {
			let mut bytes = vec![0; (disk_end - start) as usize];
			if let Some(file) = self.file.as_mut() {
				if file.seek(SeekFrom::Start(start)).and_then(|_| file.read_exact(&mut bytes)).is_ok() {
					segments.push((start, bytes));
				} else {
					self.unavailable = true;
				}
			}
		}
		for (offset, bytes) in [(0, self.foreground.as_slice()), (0, self.head.as_slice())] {
			let lo = start.max(offset);
			let hi = end.min(offset + bytes.len() as u64);
			if lo < hi {
				segments.push((lo, bytes[(lo - offset) as usize..(hi - offset) as usize].to_vec()));
			}
		}
		let tail_start = self.byte_count - self.tail.len() as u64;
		let lo = start.max(tail_start);
		let hi = end.min(self.byte_count);
		if lo < hi {
			segments.push((
				lo,
				self
					.tail
					.iter()
					.skip((lo - tail_start) as usize)
					.take((hi - lo) as usize)
					.copied()
					.collect(),
			));
		}
		segments.sort_by_key(|(offset, _)| *offset);
		let mut page = OutputPage {
			requested: OutputOffsets::new(start, start.saturating_add(maximum)),
			chunks: Vec::new(),
			omitted_ranges: Vec::new(),
			next_offset: (end < self.byte_count).then(|| end.to_string()),
		};
		let mut cursor = start;
		for (offset, bytes) in segments {
			let segment_end = offset + bytes.len() as u64;
			if segment_end <= cursor {
				continue;
			}
			if offset > cursor {
				page.omitted_ranges.push(OutputOffsets::new(cursor, offset));
			}
			let lo = cursor.max(offset);
			page.chunks.push(OutputChunk {
				offsets: OutputOffsets::new(lo, segment_end),
				bytes: bytes[(lo - offset) as usize..].to_vec(),
			});
			cursor = segment_end;
		}
		if cursor < end {
			page.omitted_ranges.push(OutputOffsets::new(cursor, end));
		}
		page
	}
}

/// Policy only. The later process resource must poll and arbitrate terminal causes.
fn file_spool_exceeded(background: bool, size: io::Result<u64>, cap: u64) -> io::Result<bool> {
	if !background {
		return Ok(false);
	}
	match size {
		Ok(size) => Ok(size > cap),
		Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
		Err(error) => Err(error),
	}
}

#[derive(Default)]
struct Utf8Carry {
	pending: Vec<u8>,
}
impl Utf8Carry {
	fn decode(&mut self, bytes: &[u8], eof: bool) -> String {
		let mut input = std::mem::take(&mut self.pending);
		input.extend_from_slice(bytes);
		let mut rest = input.as_slice();
		let mut text = String::new();
		loop {
			match std::str::from_utf8(rest) {
				Ok(valid) => {
					text.push_str(valid);
					break;
				},
				Err(error) => {
					text.push_str(
						std::str::from_utf8(&rest[..error.valid_up_to()]).expect("validated prefix"),
					);
					rest = &rest[error.valid_up_to()..];
					match error.error_len() {
						Some(n) => {
							text.push('\u{fffd}');
							rest = &rest[n..];
						},
						None => {
							if eof {
								text.push('\u{fffd}');
							} else {
								self.pending.extend_from_slice(rest);
							}
							break;
						},
					}
				},
			}
		}
		text
	}
}
#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn capped_prefix_and_rolling_tail_are_owned_pages() {
		let path = std::env::temp_dir().join(format!("atomic-output-{}", std::process::id()));
		let mut store = OutputStore::new(path.clone(), 4, 6, 5);
		store.append(b"abcdef");
		store.append(b"ghijkl");
		let page = store.page(0, 12);
		assert_eq!(
			page.chunks.iter().map(|c| c.bytes.as_slice()).collect::<Vec<_>>(),
			vec![b"abcde".as_slice(), b"kl".as_slice()]
		);
		assert_eq!(page.omitted_ranges, vec![OutputOffsets::new(5, 10)]);
		assert_eq!(store.byte_count, 12);
		store.append(b"mn");
		assert_eq!(page.chunks[1].bytes, b"kl");
		assert_eq!(store.page(0, 14).omitted_ranges, vec![OutputOffsets::new(5, 12)]);
		let missing = store.page(6, 3);
		assert!(missing.chunks.is_empty());
		assert_eq!(missing.omitted_ranges, vec![OutputOffsets::new(6, 9)]);
		assert_eq!(std::fs::metadata(&path).unwrap().len(), 5);
		assert!(store.head.len() + store.tail.len() <= 4);
		assert!(store.foreground.is_empty());
		assert!(store.page(3, 0).chunks.is_empty());
		drop(store);
		std::fs::remove_file(path).unwrap();
	}
	#[test]
	fn foreground_prefix_flushes_once_and_reads_do_not_move_append_offset() {
		let path =
			std::env::temp_dir().join(format!("atomic-output-background-{}", std::process::id()));
		let mut store = OutputStore::new(path.clone(), 4, 8, 20);
		store.append(b"abcdefg");
		assert!(!path.exists());
		assert_eq!(store.page(2, 3).chunks[0].bytes, b"cde");
		assert_eq!(store.page(2, 3).next_offset.as_deref(), Some("5"));
		store.background();
		store.background();
		assert_eq!(std::fs::read(&path).unwrap(), b"abcdefg");
		assert!(store.foreground.is_empty());
		assert_eq!(store.page(1, 2).chunks[0].bytes, b"bc");
		store.append(b"hi");
		assert_eq!(std::fs::read(&path).unwrap(), b"abcdefghi");
		assert_eq!(store.page(99, 0).requested, OutputOffsets::new(99, 99));
		drop(store);
		std::fs::remove_file(path).unwrap();
	}

	#[test]
	fn disk_failure_keeps_draining_without_retry_or_losing_offsets() {
		let path = std::env::temp_dir()
			.join(format!("atomic-output-missing-{}", std::process::id()))
			.join("missing/output");
		let mut store = OutputStore::new(path, 4, 4, 5);
		store.append(b"abcdefghij");
		assert!(store.unavailable);
		assert!(store.foreground.is_empty());
		store.append(b"kl");
		let page = store.page(1, 10);
		assert_eq!(page.chunks[0].offsets, OutputOffsets::new(1, 2));
		assert_eq!(page.chunks[0].bytes, b"b");
		assert_eq!(page.chunks[1].offsets, OutputOffsets::new(10, 11));
		assert_eq!(page.chunks[1].bytes, b"k");
		assert_eq!(page.omitted_ranges, vec![OutputOffsets::new(2, 10)]);
		assert_eq!(store.byte_count, 12);
	}

	#[test]
	fn raw_cap_and_chunk_boundaries_preserve_multibyte_decoding() {
		let path = std::env::temp_dir().join(format!("atomic-output-utf8-{}", std::process::id()));
		let mut store = OutputStore::new(path.clone(), 8, 2, 2);
		let mut decoder = Utf8Carry::default();
		store.append(b"a\xe2");
		assert_eq!(decoder.decode(b"a\xe2", false), "a");
		store.append(b"\x82");
		assert_eq!(decoder.decode(b"\x82", false), "");
		store.append(b"\xac!");
		assert_eq!(decoder.decode(b"\xac!", false), "€!");
		assert_eq!(std::fs::read(&path).unwrap(), b"a\xe2");
		let page = store.page(0, 5);
		assert!(page.omitted_ranges.is_empty());
		let mut decoder = Utf8Carry::default();
		let text: String =
			page.chunks.iter().map(|chunk| decoder.decode(&chunk.bytes, false)).collect();
		assert_eq!(text, "a€!");
		assert_eq!(decoder.decode(b"\xf0\x9f", false), "");
		assert_eq!(decoder.decode(b"", true), "�");
		drop(store);
		std::fs::remove_file(path).unwrap();
	}

	#[test]
	fn file_spool_policy_uses_real_cap_without_a_large_file() {
		assert_eq!(COMMAND_LIVE_BYTES, 1_048_576);
		assert_eq!(FOREGROUND_SPILL_BYTES, 8_388_608);
		assert_eq!(TASK_DISK_BYTES, 5_368_709_120);
		assert_eq!(DETAIL_TAIL_BYTES, 8_192);
		for size in [TASK_DISK_BYTES - 1, TASK_DISK_BYTES] {
			assert!(!file_spool_exceeded(true, Ok(size), TASK_DISK_BYTES).unwrap());
		}
		assert!(file_spool_exceeded(true, Ok(TASK_DISK_BYTES + 1), TASK_DISK_BYTES).unwrap());
		assert!(!file_spool_exceeded(false, Ok(u64::MAX), TASK_DISK_BYTES).unwrap());
		assert!(
			!file_spool_exceeded(true, Err(io::ErrorKind::NotFound.into()), TASK_DISK_BYTES).unwrap()
		);
		assert!(
			file_spool_exceeded(true, Err(io::ErrorKind::PermissionDenied.into()), TASK_DISK_BYTES)
				.is_err()
		);
	}
}
