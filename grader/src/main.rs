//! Runs inside OutLayer. Reads the sealed set from the PROCTOR_SET secret,
//! which the keystore only releases to this exact build, asks one model a
//! slice of the questions through NEAR AI Cloud, and prints a report that
//! carries scores and hashes but never the questions.

use proctor_grader::{is_correct, sha256_hex, Report, Set, INSTRUCTION};
use serde::Deserialize;
use std::io::{self, Read, Write};

#[derive(Deserialize)]
struct Input {
    model: String,
    /// The hash committed on NEAR before the run. If the secret does not
    /// match it, nothing is graded.
    expected_set_sha256: String,
    #[serde(default)]
    start: usize,
    #[serde(default = "default_count")]
    count: usize,
    #[serde(default = "default_max_tokens")]
    max_tokens: u32,
}

fn default_count() -> usize {
    5
}
fn default_max_tokens() -> u32 {
    2048
}

const API: &str = "https://cloud-api.near.ai/v1";

// The manifest rides inside the wasm, so it is covered by the same hash the
// contract pins. It names the profile our NEAR AI key is stored under.
#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");

fn fail(msg: &str) -> ! {
    // stdout is what reaches the chain, so errors go there as JSON too.
    println!("{}", serde_json::json!({ "error": msg }));
    std::process::exit(1)
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).unwrap_or_else(|_| fail("no input"));
    let input: Input = serde_json::from_str(&raw).unwrap_or_else(|e| fail(&format!("bad input: {e}")));

    let sealed_json = std::env::var("PROCTOR_SET").unwrap_or_else(|_| fail("sealed set not available to this build"));
    let api_key = std::env::var("NEARAI_API_KEY").unwrap_or_else(|_| fail("NEARAI_API_KEY missing"));

    let set_sha256 = sha256_hex(sealed_json.as_bytes());
    if set_sha256 != input.expected_set_sha256 {
        fail("sealed set does not match the committed hash");
    }
    let set: Set = serde_json::from_str(&sealed_json).unwrap_or_else(|_| fail("sealed set is not valid JSON"));

    // Whether the model runs in attested hardware is read from NEAR AI's own
    // model list here, not taken from the caller.
    let sealed = net::model_is_verifiable(&api_key, &input.model).unwrap_or(false);

    let end = (input.start + input.count).min(set.items.len());
    let slice = set.items.get(input.start..end).unwrap_or(&[]);
    let mut report = Report::new(&set, set_sha256, &input.model, sealed, input.start, slice.len());

    for item in slice {
        match net::ask(&api_key, &input.model, &item.prompt, input.max_tokens) {
            Ok((text, chat_id)) => report.record(&item.author, is_correct(&item.answer, &text), Some(chat_id)),
            Err(_) => report.record(&item.author, false, None),
        }
    }

    let out = serde_json::to_string(&report).unwrap();
    print!("{out}");
    let _ = io::stdout().flush();
}

#[cfg(target_arch = "wasm32")]
mod net {
    use super::{API, INSTRUCTION};
    use serde_json::{json, Value};
    use std::time::Duration;
    use wasi_http_client::Client;

    fn post(api_key: &str, path: &str, body: &Value) -> Result<Value, String> {
        let resp = Client::new()
            .post(&format!("{API}{path}"))
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .connect_timeout(Duration::from_secs(20))
            .body(body.to_string().as_bytes())
            .send()
            .map_err(|e| format!("{e:?}"))?;
        let status = resp.status();
        let bytes = resp.body().map_err(|e| format!("{e:?}"))?;
        if !(200..300).contains(&status) {
            return Err(format!("status {status}"));
        }
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }

    pub fn ask(api_key: &str, model: &str, prompt: &str, max_tokens: u32) -> Result<(String, String), String> {
        let body = json!({
            "model": model,
            "messages": [
                {"role": "system", "content": INSTRUCTION},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": max_tokens,
            "temperature": 0
        });
        let v = post(api_key, "/chat/completions", &body)?;
        let text = v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
        let id = v["id"].as_str().unwrap_or("").to_string();
        Ok((text, id))
    }

    pub fn model_is_verifiable(api_key: &str, model: &str) -> Result<bool, String> {
        let resp = Client::new()
            .get(&format!("{API}/model/list?limit=200"))
            .header("Authorization", format!("Bearer {api_key}"))
            .connect_timeout(Duration::from_secs(20))
            .send()
            .map_err(|e| format!("{e:?}"))?;
        let v: Value = serde_json::from_slice(&resp.body().map_err(|e| format!("{e:?}"))?).map_err(|e| e.to_string())?;
        let found = v["models"]
            .as_array()
            .and_then(|ms| ms.iter().find(|m| m["modelId"] == model))
            .map(|m| m["metadata"]["verifiable"].as_bool().unwrap_or(false));
        Ok(found.unwrap_or(false))
    }
}

// Native builds exist only so `cargo test` works on a laptop.
#[cfg(not(target_arch = "wasm32"))]
mod net {
    pub fn ask(_: &str, _: &str, _: &str, _: u32) -> Result<(String, String), String> {
        Err("network is only wired up in the wasm build".into())
    }
    pub fn model_is_verifiable(_: &str, _: &str) -> Result<bool, String> {
        Ok(false)
    }
}
