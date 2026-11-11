//! Several HTTPS POSTs in flight at once over wasi:http.
//!
//! A reasoning model takes 40-60 s per answer, and OutLayer gives a run at
//! most 180 s, so asking a slice one question at a time does not fit. Every
//! request is started first, then we wait on all of them with poll().

use wasi::http::outgoing_handler::{self, FutureIncomingResponse};
use wasi::http::types::{Fields, IncomingResponse, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme};
use wasi::io::poll;
use wasi::io::streams::StreamError;

const SECOND: u64 = 1_000_000_000;

pub struct Post<'a> {
    pub authority: &'a str,
    pub path: &'a str,
    pub bearer: &'a str,
    pub body: Vec<u8>,
}

fn start(p: &Post, first_byte_secs: u64) -> Result<FutureIncomingResponse, String> {
    let headers = Fields::new();
    headers
        .append(&"content-type".to_string(), &b"application/json".to_vec())
        .map_err(|e| format!("{e:?}"))?;
    headers
        .append(&"authorization".to_string(), &format!("Bearer {}", p.bearer).into_bytes())
        .map_err(|e| format!("{e:?}"))?;

    let req = OutgoingRequest::new(headers);
    req.set_method(&Method::Post).map_err(|_| "method")?;
    req.set_scheme(Some(&Scheme::Https)).map_err(|_| "scheme")?;
    req.set_authority(Some(p.authority)).map_err(|_| "authority")?;
    req.set_path_with_query(Some(p.path)).map_err(|_| "path")?;

    let body = req.body().map_err(|_| "body")?;
    {
        let out = body.write().map_err(|_| "body stream")?;
        // blocking_write_and_flush takes at most 4096 bytes per call.
        for chunk in p.body.chunks(4096) {
            out.blocking_write_and_flush(chunk).map_err(|e| format!("{e:?}"))?;
        }
    }
    OutgoingBody::finish(body, None).map_err(|e| format!("{e:?}"))?;

    let opts = RequestOptions::new();
    let _ = opts.set_connect_timeout(Some(20 * SECOND));
    let _ = opts.set_first_byte_timeout(Some(first_byte_secs * SECOND));
    let _ = opts.set_between_bytes_timeout(Some(30 * SECOND));
    outgoing_handler::handle(req, Some(opts)).map_err(|e| format!("{e:?}"))
}

fn read_all(resp: IncomingResponse) -> Result<(u16, Vec<u8>), String> {
    let status = resp.status();
    let body = resp.consume().map_err(|_| "consume")?;
    let mut buf = Vec::new();
    {
        let stream = body.stream().map_err(|_| "stream")?;
        loop {
            match stream.blocking_read(64 * 1024) {
                Ok(bytes) => buf.extend_from_slice(&bytes),
                Err(StreamError::Closed) => break,
                Err(e) => return Err(format!("{e:?}")),
            }
        }
    }
    Ok((status, buf))
}

/// Returns one result per request, in the order given.
pub fn post_all(posts: &[Post], first_byte_secs: u64) -> Vec<Result<(u16, Vec<u8>), String>> {
    let mut results: Vec<Option<Result<(u16, Vec<u8>), String>>> = (0..posts.len()).map(|_| None).collect();
    let mut pending: Vec<(usize, FutureIncomingResponse)> = Vec::new();

    for (i, p) in posts.iter().enumerate() {
        match start(p, first_byte_secs) {
            Ok(f) => pending.push((i, f)),
            Err(e) => results[i] = Some(Err(e)),
        }
    }

    while !pending.is_empty() {
        let pollables: Vec<_> = pending.iter().map(|(_, f)| f.subscribe()).collect();
        let refs: Vec<&_> = pollables.iter().collect();
        let ready = poll::poll(&refs);
        drop(refs);
        drop(pollables);

        let mut still = Vec::new();
        for (pos, (i, fut)) in pending.into_iter().enumerate() {
            if !ready.contains(&(pos as u32)) {
                still.push((i, fut));
                continue;
            }
            let out = match fut.get() {
                Some(Ok(Ok(resp))) => read_all(resp),
                Some(Ok(Err(e))) => Err(format!("{e:?}")),
                Some(Err(())) => Err("response already taken".into()),
                None => {
                    still.push((i, fut));
                    continue;
                }
            };
            results[i] = Some(out);
        }
        pending = still;
    }

    results.into_iter().map(|r| r.unwrap_or_else(|| Err("lost".into()))).collect()
}
