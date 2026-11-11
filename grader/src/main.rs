//! Runs inside OutLayer. Reads the sealed set from the PROCTOR_SET secret,
//! which the keystore only releases to this exact build, asks one model a
//! slice of the questions through NEAR AI Cloud, and prints a report that
//! carries scores and hashes but never the questions.

use proctor_grader::{sha256_hex, Report, Set, INSTRUCTION};
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
    /// An agent's own instructions. When present the model sits the exam as
    /// that agent, and the report carries the hash of these exact words.
    #[serde(default)]
    system_prompt: Option<String>,
}

fn default_count() -> usize {
    5
}
fn default_max_tokens() -> u32 {
    // A NEAR contract waits about 200 blocks (roughly two minutes on
    // testnet) for OutLayer to answer. At ~33 tokens/s, 3000 tokens plus
    // overhead fits; with low reasoning effort Qwen 3.8 answers in ~1500.
    3000
}

const API: &str = "https://cloud-api.near.ai/v1";

// The manifest rides inside the wasm, so it is covered by the same hash the
// contract pins. It names the profile our NEAR AI key is stored under.
#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");

fn fail(msg: &str) -> ! {
    // stdout is what reaches the chain, so errors go there as JSON too. Exit 0
    // on purpose: OutLayer drops the output of a failed run, and then the
    // contract cannot say why it refunded.
    println!("{}", serde_json::json!({ "error": msg }));
    std::process::exit(0)
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
    let system = match &input.system_prompt {
        Some(p) => {
            report.agent_prompt_sha256 = Some(sha256_hex(p.as_bytes()));
            format!("{p}\n\n{INSTRUCTION}")
        }
        None => INSTRUCTION.to_string(),
    };

    let prompts: Vec<&str> = slice.iter().map(|i| i.prompt.as_str()).collect();
    let answers = net::ask_all(&api_key, &input.model, &system, &prompts, input.max_tokens);
    for (item, answer) in slice.iter().zip(answers) {
        match answer {
            Ok((text, chat_id)) => report.record_with_stakes(item, &text, chat_id),
            Err(_) => report.record(&item.author, false, None),
        }
    }

    let out = serde_json::to_string(&report).unwrap();
    print!("{out}");
    let _ = io::stdout().flush();
}

#[cfg(target_arch = "wasm32")]
mod net {
    use super::API;
    use serde_json::Value;
    use std::time::Duration;
    use wasi_http_client::Client;

    /// All prompts are sent at once; answers come back in the same order.
    pub fn ask_all(api_key: &str, model: &str, system: &str, prompts: &[&str], max_tokens: u32) -> Vec<Result<(String, String), String>> {
        let send = |idx: &[usize], plain: bool| {
            let posts: Vec<crate::conc::Post> = idx
                .iter()
                .map(|&i| crate::conc::Post {
                    authority: "cloud-api.near.ai",
                    path: "/v1/chat/completions",
                    bearer: api_key,
                    body: proctor_grader::request_body(model, system, prompts[i], max_tokens, plain).to_string().into_bytes(),
                })
                .collect();
            crate::conc::post_all(&posts, 150)
        };
        let all: Vec<usize> = (0..prompts.len()).collect();
        let mut out: Vec<Result<(u16, Vec<u8>), String>> = send(&all, false);
        // A provider that refuses one of the tuning settings answers 400.
        // Ask those questions again with only the model, messages and token limit.
        let refused: Vec<usize> = all.iter().copied().filter(|&i| matches!(out[i], Ok((400, _)))).collect();
        if !refused.is_empty() {
            for (i, r) in refused.iter().zip(send(&refused, true)) {
                out[*i] = r;
            }
        }
        out.into_iter()
            .map(|r| {
                let (status, bytes) = r?;
                if !(200..300).contains(&status) {
                    let why = serde_json::from_slice::<Value>(&bytes).ok()
                        .and_then(|v| v["error"]["message"].as_str().map(|m| m.chars().take(160).collect::<String>()))
                        .unwrap_or_default();
                    return Err(format!("status {status} {why}"));
                }
                let v: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                let text = v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
                let id = v["id"].as_str().unwrap_or("").to_string();
                Ok((text, id))
            })
            .collect()
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

#[cfg(target_arch = "wasm32")]
mod conc;

// Native builds exist only so `cargo test` works on a laptop.
#[cfg(not(target_arch = "wasm32"))]
mod net {
    pub fn ask_all(_: &str, _: &str, _: &str, prompts: &[&str], _: u32) -> Vec<Result<(String, String), String>> {
        prompts.iter().map(|_| Err("network is only wired up in the wasm build".into())).collect()
    }
    pub fn model_is_verifiable(_: &str, _: &str) -> Result<bool, String> {
        Ok(false)
    }
}
