//! Everything in here is plain code with no network access, so it can be
//! tested on a laptop. `main.rs` only adds the HTTP calls.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// What a question writer seals. The whole JSON string is hashed as-is,
/// so the writer and the contract agree on the exact bytes.
#[derive(Deserialize, Debug, Clone)]
pub struct Set {
    pub set_id: String,
    pub items: Vec<Item>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Item {
    pub id: String,
    pub author: String,
    pub prompt: String,
    pub answer: Answer,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Answer {
    /// Correct if |given - value| <= tol.
    Number { value: f64, #[serde(default)] tol: f64 },
    /// Correct if equal after trimming, lowercasing and squashing spaces.
    Exact { value: String },
}

pub const INSTRUCTION: &str = "Solve the problem. You may think step by step, \
but finish with one final line of the form `ANSWER: <answer>` and nothing after it.";

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Pull the text after the last `ANSWER:` marker. Models sometimes bold it
/// or wrap it in backticks, so those are stripped too.
pub fn extract_final(response: &str) -> Option<String> {
    let idx = response.rfind("ANSWER:")?;
    let rest = &response[idx + "ANSWER:".len()..];
    let line = rest.lines().next().unwrap_or("").trim();
    let cleaned: String = line
        .trim_matches(|c: char| c == '*' || c == '`' || c == '"' || c.is_whitespace())
        .to_string();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn normalise_text(s: &str) -> String {
    s.trim()
        .trim_end_matches('.')
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse "1,250", "$1250.00", "12.5%", "-3" etc. Returns None for anything
/// that still is not a single number after cleanup.
pub fn parse_number(s: &str) -> Option<f64> {
    let cleaned: String = s
        .chars()
        .filter(|c| !matches!(c, ',' | '$' | '%' | ' ' | '€' | '£' | '₦'))
        .collect();
    cleaned.parse::<f64>().ok()
}

pub fn is_correct(answer: &Answer, response: &str) -> bool {
    let Some(given) = extract_final(response) else {
        return false;
    };
    match answer {
        Answer::Number { value, tol } => match parse_number(&given) {
            Some(x) => (x - value).abs() <= tol.max(1e-9),
            None => false,
        },
        Answer::Exact { value } => normalise_text(&given) == normalise_text(value),
    }
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
pub struct Tally {
    pub asked: u32,
    pub correct: u32,
}

/// The part of the result that leaves the enclave. No prompt text, no
/// answers, no model output: only counts, hashes and the chat ids NEAR AI
/// signed, so anyone can fetch those signatures later.
#[derive(Serialize, Debug)]
pub struct Report {
    pub grader: &'static str,
    pub set_id: String,
    pub set_sha256: String,
    pub model: String,
    pub sealed: bool,
    pub start: usize,
    pub count: usize,
    pub asked: u32,
    pub correct: u32,
    pub by_author: BTreeMap<String, Tally>,
    pub chat_ids: Vec<String>,
    pub failures: u32,
    /// One character per question in slice order: 1 correct, 0 wrong,
    /// x no answer. Says nothing about content, but once a set is revealed it
    /// lets anyone drop a bad question and recompute every score.
    pub results: String,
}

impl Report {
    pub fn new(set: &Set, set_sha256: String, model: &str, sealed: bool, start: usize, count: usize) -> Self {
        Report {
            grader: env!("CARGO_PKG_VERSION"),
            set_id: set.set_id.clone(),
            set_sha256,
            model: model.to_string(),
            sealed,
            start,
            count,
            asked: 0,
            correct: 0,
            by_author: BTreeMap::new(),
            chat_ids: Vec::new(),
            failures: 0,
            results: String::new(),
        }
    }

    pub fn record(&mut self, author: &str, ok: bool, chat_id: Option<String>) {
        self.asked += 1;
        if ok {
            self.correct += 1;
        }
        let t = self.by_author.entry(author.to_string()).or_default();
        t.asked += 1;
        if ok {
            t.correct += 1;
        }
        match chat_id {
            Some(id) => {
                self.chat_ids.push(id);
                self.results.push(if ok { '1' } else { '0' });
            }
            None => {
                self.failures += 1;
                self.results.push('x');
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_last_marker() {
        let r = "First guess ANSWER: 3\nwait, recheck\nANSWER: **42**";
        assert_eq!(extract_final(r).as_deref(), Some("42"));
    }

    #[test]
    fn numbers_with_symbols() {
        assert_eq!(parse_number("$1,250.00"), Some(1250.0));
        assert_eq!(parse_number("12.5%"), Some(12.5));
        assert_eq!(parse_number("₦ 3,000"), Some(3000.0));
        assert_eq!(parse_number("about 3"), None);
    }

    #[test]
    fn number_tolerance() {
        let a = Answer::Number { value: 0.333, tol: 0.001 };
        assert!(is_correct(&a, "ANSWER: 0.3333"));
        assert!(!is_correct(&a, "ANSWER: 0.34"));
        let exact = Answer::Number { value: 7.0, tol: 0.0 };
        assert!(is_correct(&exact, "ANSWER: 7"));
        assert!(!is_correct(&exact, "the answer is 7"));
    }

    #[test]
    fn exact_text() {
        let a = Answer::Exact { value: "Lagos".into() };
        assert!(is_correct(&a, "...\nANSWER: lagos."));
        assert!(!is_correct(&a, "ANSWER: Abuja"));
    }

    #[test]
    fn tallies_by_author() {
        let set = Set { set_id: "s".into(), items: vec![] };
        let mut r = Report::new(&set, "h".into(), "m", true, 0, 3);
        r.record("a", true, Some("c1".into()));
        r.record("a", false, Some("c2".into()));
        r.record("b", true, None);
        assert_eq!(r.correct, 2);
        assert_eq!(r.by_author["a"], Tally { asked: 2, correct: 1 });
        assert_eq!(r.failures, 1);
        assert_eq!(r.results, "10x");
    }
}
