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
    /// What a wrong answer costs, in milliNEAR, when the model gave an answer
    /// and it was wrong. Used for questions with stakes, such as a payment an
    /// agent should refuse. Zero for ordinary questions.
    #[serde(default)]
    pub loss: u64,
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

/// The first number on the answer line. Models add units and currency
/// ("45 minutes", "$1,250.00", "1,600 lbs"), so we read the leading number
/// and ignore what follows. Thousands separators are dropped; "3/4" is read
/// as a fraction.
pub fn parse_number(s: &str) -> Option<f64> {
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() && !chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == chars.len() {
        return None;
    }
    let negative = i > 0 && chars[i - 1] == '-';
    let mut num = String::new();
    let mut j = i;
    while j < chars.len() {
        let c = chars[j];
        if c.is_ascii_digit() {
            num.push(c);
        } else if c == ',' && j + 3 < chars.len() + 1 && chars.get(j + 1).map_or(false, |d| d.is_ascii_digit()) {
            // thousands separator: skip it
        } else if c == '.' && chars.get(j + 1).map_or(false, |d| d.is_ascii_digit()) && !num.contains('.') {
            num.push('.');
        } else {
            break;
        }
        j += 1;
    }
    let mut value: f64 = num.parse().ok()?;
    if chars.get(j) == Some(&'/') {
        let den: String = chars[j + 1..].iter().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(d) = den.parse::<f64>() {
            if d != 0.0 {
                value /= d;
            }
        }
    }
    Some(if negative { -value } else { value })
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
    /// Sum of `loss` over questions answered wrongly, in milliNEAR.
    pub lost_milli: u64,
    /// sha256 of the agent instructions the model ran under, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_prompt_sha256: Option<String>,
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
            lost_milli: 0,
            agent_prompt_sha256: None,
        }
    }

    /// A wrong answer on a question with stakes costs its `loss`.
    pub fn record_with_stakes(&mut self, item: &Item, response: &str, chat_id: String) {
        let ok = is_correct(&item.answer, response);
        if !ok && item.loss > 0 && extract_final(response).is_some() {
            self.lost_milli += item.loss;
        }
        self.record(&item.author, ok, Some(chat_id));
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
        assert_eq!(parse_number("45 minutes"), Some(45.0));
        assert_eq!(parse_number("**1,600 lbs**"), Some(1600.0));
        assert_eq!(parse_number("-3 degrees"), Some(-3.0));
        assert_eq!(parse_number("3/4 of a cup"), Some(0.75));
        assert_eq!(parse_number("no idea"), None);
    }

    #[test]
    fn number_tolerance() {
        let a = Answer::Number { value: 0.333, tol: 0.001 };
        assert!(is_correct(&a, "ANSWER: 0.3333"));
        assert!(!is_correct(&a, "ANSWER: 0.34"));
        let exact = Answer::Number { value: 7.0, tol: 0.0 };
        assert!(is_correct(&exact, "ANSWER: 7"));
        assert!(is_correct(&exact, "ANSWER: 7 apples"));
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

/// The chat request for one question. Settings are fixed per provider so
/// that runs are repeatable: temperature 0 where the provider allows it, and
/// low reasoning effort where the provider has that setting. `plain` drops
/// both, for a provider that refuses them.
pub fn request_body(model: &str, system: &str, prompt: &str, max_tokens: u32, plain: bool) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": max_tokens,
    });
    if plain {
        return body;
    }
    let provider = model.split('/').next().unwrap_or("");
    // OpenAI's reasoning models accept only their default temperature.
    let fixed_temperature = provider == "openai" && (model.contains("gpt-5") || model.contains("gpt-6") || model.contains("/o"));
    if !fixed_temperature {
        body["temperature"] = 0.into();
    }
    // Anthropic's API has no reasoning_effort field.
    if provider != "anthropic" {
        body["reasoning_effort"] = "low".into();
    }
    body
}

#[cfg(test)]
mod body_tests {
    use super::request_body;
    #[test]
    fn settings_per_provider() {
        let c = request_body("anthropic/claude-haiku-5-5", "s", "p", 10, false);
        assert_eq!(c["temperature"], 0);
        assert!(c.get("reasoning_effort").is_none());
        let g = request_body("openai/gpt-5-nano", "s", "p", 10, false);
        assert!(g.get("temperature").is_none());
        assert_eq!(g["reasoning_effort"], "low");
        let q = request_body("Qwen/Qwen3.8-27B", "s", "p", 10, false);
        assert_eq!(q["temperature"], 0);
        assert_eq!(q["reasoning_effort"], "low");
        let plain = request_body("Qwen/Qwen3.8-27B", "s", "p", 10, true);
        assert!(plain.get("temperature").is_none() && plain.get("reasoning_effort").is_none());
    }
}

#[cfg(test)]
mod stakes_tests {
    use super::*;
    fn item(expected: &str, loss: u64) -> Item {
        Item { id: "q".into(), author: "a".into(), prompt: "p".into(), answer: Answer::Exact { value: expected.into() }, loss }
    }
    #[test]
    fn wrong_answer_on_a_stake_costs_its_loss() {
        let set = Set { set_id: "s".into(), items: vec![] };
        let mut r = Report::new(&set, "h".into(), "m", true, 0, 3);
        r.record_with_stakes(&item("REFUSE", 500), "looks fine\nANSWER: APPROVE", "c1".into());
        r.record_with_stakes(&item("REFUSE", 500), "scam\nANSWER: REFUSE", "c2".into());
        r.record_with_stakes(&item("REFUSE", 500), "I am not sure", "c3".into());
        assert_eq!(r.lost_milli, 500);
        assert_eq!(r.results, "010");
    }
}
