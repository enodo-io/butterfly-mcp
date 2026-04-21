import axios from 'axios';
import FormData from 'form-data';
import fs from 'node:fs';

// Thin HTTP client over the Butterfly API.
//
// Three env vars, read straight from process.env (dotenv populates it
// at boot from the project's .env):
//
//   PUBLIC_API_URL   (required) base URL of the property's Butterfly
//                               API. Either
//                               https://<propertyId>.pubbtf.eno.do
//                               or the property's custom domain.
//   PUBLIC_API_KEY   (optional) Public Key — read-only, published
//                               content only. Used by default for
//                               cacheable reads. When absent, reads
//                               fall back to the Private Key (works,
//                               but bypasses the cache).
//   PRIVATE_API_KEY  (required) Private Key — full admin. Writes +
//                               reads of unpublished content +
//                               admin-only endpoints.

function resolveEnv() {
  return {
    apiUrl: process.env.PUBLIC_API_URL,
    publicKey: process.env.PUBLIC_API_KEY || null,
    privateKey: process.env.PRIVATE_API_KEY,
  };
}

function assertEnv() {
  const { apiUrl, privateKey } = resolveEnv();
  if (!apiUrl) {
    throw new Error('PUBLIC_API_URL is missing.');
  }
  if (!privateKey) {
    throw new Error('PRIVATE_API_KEY is missing.');
  }
}

const http = axios.create({
  timeout: 60000,
  validateStatus: () => true,
});

function baseUrl() {
  return String(resolveEnv().apiUrl).replace(/\/+$/, '');
}

function keyFor(scope) {
  const { publicKey, privateKey } = resolveEnv();
  if (scope === 'admin') return privateKey;
  // Public scope: prefer the public key if set, otherwise fall back to
  // the private key so the call still succeeds (just without caching).
  return publicKey || privateKey;
}

function headersFor(scope, extra = {}) {
  return {
    'X-Butterfly-Key': keyFor(scope),
    Accept: 'application/json',
    ...extra,
  };
}

function throwFromResponse(response) {
  const detail =
    response.data?.errors?.[0]?.detail
    || response.data?.errors?.[0]?.title
    || `Butterfly API returned ${response.status}`;
  const err = new Error(detail);
  err.status = response.status;
  err.body = response.data;
  throw err;
}

// Reads — pick the scope explicitly per call.
// `scope: 'public'` uses the Public Key when configured (cacheable, no
// drafts); `scope: 'admin'` uses the Private Key (all statuses, no cache).
export async function get(path, params = {}, { scope = 'public' } = {}) {
  assertEnv();
  const response = await http.get(`${baseUrl()}${path}`, {
    headers: headersFor(scope),
    params,
  });
  if (response.status >= 400) throwFromResponse(response);
  return response.data;
}

// Writes always require admin.
export async function post(path, body) {
  assertEnv();
  const response = await http.post(`${baseUrl()}${path}`, body, {
    headers: headersFor('admin', { 'Content-Type': 'application/json' }),
  });
  if (response.status >= 400) throwFromResponse(response);
  return response.data;
}

export async function patch(path, body) {
  assertEnv();
  const response = await http.patch(`${baseUrl()}${path}`, body, {
    headers: headersFor('admin', { 'Content-Type': 'application/json' }),
  });
  if (response.status >= 400) throwFromResponse(response);
  return response.data;
}

// Some soft-delete endpoints (e.g. DELETE /posts, DELETE /categories)
// accept a JSON:API body carrying `attributes.deleted = { httpCode, detail }`
// that controls what the API returns on subsequent GETs of the resource
// (301 redirect, 410 gone, etc.). Default body is empty.
export async function del(path, body) {
  assertEnv();
  const response = await http.delete(`${baseUrl()}${path}`, {
    headers: headersFor('admin', body ? { 'Content-Type': 'application/json' } : {}),
    data: body,
  });
  if (response.status >= 400) throwFromResponse(response);
  return response.data;
}

// Multipart upload used by the media tool. `fileSpec` is one of:
//   { path: '/tmp/foo.jpg' }   — local file on disk
//   { url: 'https://...' }     — remote URL, fetched then streamed
//   { base64: '...', filename: 'foo.jpg', mimetype: 'image/jpeg' }
//
// Returns the JSON body from the Butterfly API.
export async function uploadMedia(fileSpec, attributes = {}) {
  assertEnv();

  const form = new FormData();

  let stream;
  let filename = fileSpec.filename || 'upload';

  if (fileSpec.path) {
    stream = fs.createReadStream(fileSpec.path);
    filename = fileSpec.filename || fileSpec.path.split('/').pop();
  } else if (fileSpec.url) {
    const fetched = await http.get(fileSpec.url, { responseType: 'stream', validateStatus: () => true });
    if (fetched.status >= 400) throw new Error(`Failed to fetch ${fileSpec.url}: ${fetched.status}`);
    stream = fetched.data;
    const urlName = fileSpec.url.split('/').pop().split('?')[0];
    filename = fileSpec.filename || urlName || 'upload';
  } else if (fileSpec.base64) {
    stream = Buffer.from(fileSpec.base64, 'base64');
  } else {
    throw new Error('uploadMedia requires one of { path, url, base64 }.');
  }

  form.append('file', stream, {
    filename,
    ...(fileSpec.mimetype ? { contentType: fileSpec.mimetype } : {}),
  });
  form.append(
    'data',
    JSON.stringify({ attributes }),
    { contentType: 'application/json' },
  );

  const response = await http.post(`${baseUrl()}/v1/medias/`, form, {
    headers: headersFor('admin', form.getHeaders()),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  if (response.status >= 400) throwFromResponse(response);
  return response.data;
}
