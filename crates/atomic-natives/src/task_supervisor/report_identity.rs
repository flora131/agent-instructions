//! Process-local report identity; only the complete SHA-256 digest is retained.
use super::*;
use sha2::{Digest, Sha256};
use std::hash::{Hash, Hasher};

pub(super) const TASK_REPORT_IDENTITY_WINDOW: usize = 256;

// Rust Hash supplies enum/option tags and length-prefixed UTF-16 vectors. Its byte
// encoding need only be stable within this actor lifetime: nothing is persisted.
struct ReportHasher(Sha256);
impl Hasher for ReportHasher {
	fn write(&mut self, bytes: &[u8]) {
		self.0.update(bytes);
	}
	fn finish(&self) -> u64 {
		let digest = self.0.clone().finalize();
		u64::from_le_bytes(std::array::from_fn(|index| digest[index]))
	}
}

pub(super) fn activity_hash(report: &ActivityReport) -> [u8; 32] {
	let mut hash = ReportHasher(Sha256::new());
	report.report_id.hash(&mut hash);
	std::mem::discriminant(&report.change).hash(&mut hash);
	match &report.change {
		ActivityChange::Action { tool, text } => (tool, text).hash(&mut hash),
		ActivityChange::Metrics { elapsed_ms, tool_count, token_count } => {
			(
				elapsed_ms.map(f64::to_bits),
				tool_count.map(f64::to_bits),
				token_count.map(f64::to_bits),
			)
				.hash(&mut hash);
		},
		ActivityChange::Output { offset, bytes_base64 } => (offset, bytes_base64).hash(&mut hash),
		ActivityChange::AttentionSet { attention } => attention.hash(&mut hash),
		ActivityChange::AttentionClear { request_id } => request_id.hash(&mut hash),
	}
	// Never truncate to Hasher::finish(): replay compares all 256 digest bits.
	hash.0.finalize().into()
}
