/**
 * tests/memory-secrets.test.mjs
 *
 * Tests for the secret scanner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { scan, hasHighFindings, SECRET_PATTERNS } from '../src/server/memory-secrets.mjs';

describe('scan', () => {
  it('returns safe: true for clean text', () => {
    const result = scan('This is a normal note about memory architecture and planning.');
    assert.strictEqual(result.safe, true);
    assert.deepStrictEqual(result.findings, []);
  });

  it('detects AWS access key', () => {
    const result = scan('AWS_KEY=AKIAIOSFODNN7EXAMPLE');
    assert.strictEqual(result.safe, false);
    assert.ok(result.findings.some((f) => f.id === 'aws_access_key'));
  });

  it('detects GitHub PAT classic', () => {
    const result = scan('ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD');
    assert.strictEqual(result.safe, false);
    assert.ok(result.findings.some((f) => f.id === 'github_pat_classic'));
  });

  it('detects Stripe live key', () => {
    const result = scan('sk_live_51234567890abcdefghijklmnop');
    assert.strictEqual(result.safe, false);
    assert.ok(result.findings.some((f) => f.id === 'stripe_live'));
  });

  it('detects Slack token', () => {
    const result = scan('xoxb-1234567890123-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx');
    assert.strictEqual(result.safe, false);
    assert.ok(result.findings.some((f) => f.id === 'slack_token'));
  });

  it('detects private key PEM', () => {
    const result = scan('-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----');
    assert.strictEqual(result.safe, false);
    assert.ok(result.findings.some((f) => f.id === 'private_key_pem'));
  });

  it('detects bearer token with base64-like value', () => {
    const result = scan('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0');
    assert.strictEqual(result.safe, false);
    assert.ok(result.findings.some((f) => f.id === 'bearer_token'));
  });

  it('detects api_key_assignment', () => {
    const result = scan('api_key: abcdefghijklmnopqrstuvwxyz123456');
    // api_key_assignment is MEDIUM severity — safe stays true
    assert.strictEqual(result.safe, true);
    assert.ok(result.findings.some((f) => f.id === 'api_key_assignment'));
  });

  it('does NOT trigger on "my API is fast"', () => {
    const result = scan('my API is fast');
    assert.strictEqual(result.safe, true);
  });

  it('does NOT trigger on "bearer of bad tidings"', () => {
    const result = scan('bearer of bad tidings');
    assert.strictEqual(result.safe, true);
  });

  it('does NOT trigger on "172.16 is too low" (incomplete private IP)', () => {
    const result = scan('172.16 is too low');
    assert.strictEqual(result.safe, true);
  });

  it('does NOT trigger on "hello world"', () => {
    const result = scan('hello world');
    assert.strictEqual(result.safe, true);
  });

  it('does NOT trigger on "the api_keyname is descriptive"', () => {
    const result = scan('the api_keyname is descriptive');
    assert.strictEqual(result.safe, true);
  });

  it('does NOT trigger on bare Bearer without long token', () => {
    const result = scan('Bearer of course');
    assert.strictEqual(result.safe, true);
  });

  it('returns line numbers in findings', () => {
    const text = 'line one\nline two with AKIAIOSFODNN7EXAMPLE key\nline three';
    const result = scan(text);
    const aws = result.findings.find((f) => f.id === 'aws_access_key');
    assert.strictEqual(aws.line, 2);
  });

  it('hasHighFindings returns true for HIGH severity', () => {
    const result = scan('AKIAIOSFODNN7EXAMPLE');
    assert.strictEqual(hasHighFindings(result), true);
  });

  it('hasHighFindings returns false for MEDIUM-only', () => {
    const result = scan('api_key: abcdefghijklmnopqrstuvwxyz123456');
    assert.strictEqual(hasHighFindings(result), false);
  });

  it('hasHighFindings returns false for no findings', () => {
    const result = scan('hello world');
    assert.strictEqual(hasHighFindings(result), false);
  });

  it('all 12 patterns are defined with severity HIGH or MEDIUM', () => {
    for (const p of SECRET_PATTERNS) {
      assert.ok(p.id, `pattern missing id: ${JSON.stringify(p)}`);
      assert.ok(p.pattern instanceof RegExp, `pattern ${p.id} is not a RegExp`);
      assert.ok(p.severity === 'HIGH' || p.severity === 'MEDIUM', `invalid severity for ${p.id}`);
    }
    assert.strictEqual(SECRET_PATTERNS.length, 12);
  });
});
