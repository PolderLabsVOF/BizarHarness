/**
 * Release signature verification (audit #83, milestone 4).
 *
 * Minisign is the chosen signature scheme — it produces compact
 * detached signatures using ed25519 (96-byte sig + 8-byte sig id).
 * This module is the JS-side glue that:
 *
 *   1. Reads a `*.minisig` signature blob (the base64-decoded inner
 *      blob — see the `MinisignSignature` interface).
 *   2. Reconstructs the signed message that minisign produces
 *      (`<trusted-comment>\n<message>` is the *signed* envelope; the
 *      base64 blob signs that).
 *   3. Verifies the ed25519 signature against the pinned ed25519
 *      public key from `KNOWN_GOOD_RELEASES`.
 *
 * The actual minisign binary is invoked for **signing** (operator
 * workflow); verification here is pure JS so it does not require
 * `minisign` to be installed at install time.
 *
 * Why ed25519 + minisign: both are tiny, both ship in coreutils on
 * most platforms, and ed25519 signatures are short enough that a
 * release manifest can carry many of them. The pinned pubkey id
 * (8 bytes) identifies which key signed the artifact; rotating keys
 * is a normal, additive change to KNOWN_GOOD_RELEASES.
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify, KeyObject } from "node:crypto";

export interface MinisignSignature {
  /** Key id (first 8 bytes of the public key, hex). */
  readonly keyId: string;
  /** ed25519 signature (hex). */
  readonly signature: string;
  /** Trusted comment (the human-readable line that minisign prints). */
  readonly trustedComment?: string;
  /** Untrusted comment (a free-form annotation, NOT signed). */
  readonly untrustedComment?: string;
}

export interface SignatureVerificationOk {
  readonly ok: true;
  readonly keyId: string;
}

export interface SignatureVerificationFail {
  readonly ok: false;
  readonly reason:
    | "SIGNATURE_MISMATCH"
    | "INVALID_SIGNATURE_BLOB"
    | "INVALID_PUBLIC_KEY"
    | "TRUSTED_COMMENT_MISMATCH";
  readonly detail?: string;
}

export type SignatureVerificationResult = SignatureVerificationOk | SignatureVerificationFail;

/**
 * Parse a `*.minisig` text blob into structured fields. The format
 * is line-oriented:
 *
 *     untrusted comment: <free text>
 *     <base64 signature>
 *     trusted comment: <free text>
 *     <base64 trusted-comment message>
 *
 * The `minisign -S` command produces this layout.
 */
export function parseMinisign(text: string): MinisignSignature | { ok: false; reason: "INVALID_SIGNATURE_BLOB" } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const untrustedLine = lines.find((l) => l.startsWith("untrusted comment: "));
  const trustedLine = lines.find((l) => l.startsWith("trusted comment: "));
  const base64Lines = lines.filter((l) => l && !l.startsWith("comment:") && !l.startsWith("untrusted comment:") && !l.startsWith("trusted comment:"));
  if (base64Lines.length < 2) return { ok: false, reason: "INVALID_SIGNATURE_BLOB" };
  const signatureB64 = base64Lines[0];
  const trustedB64 = base64Lines[1];
  if (!signatureB64 || !trustedB64) return { ok: false, reason: "INVALID_SIGNATURE_BLOB" };

  let sigBin: Buffer;
  try {
    sigBin = Buffer.from(signatureB64, "base64");
    // Trusted-comment base64 blob is part of the minisign layout but
    // not used in JS-side verification (we reconstruct the trusted
    // comment from the artifact's sha256). Read it for shape parity.
    Buffer.from(trustedB64, "base64");
  } catch {
    return { ok: false, reason: "INVALID_SIGNATURE_BLOB" };
  }

  // Minisign signature blob layout (unencrypted): 2-byte sig
  // header + 64-byte sig + 8-byte key id = 74 bytes total. The
  // header is opaque to us; the parser skips the first 2 bytes.
  if (sigBin.length < 74) return { ok: false, reason: "INVALID_SIGNATURE_BLOB" };
  const keyId = sigBin.subarray(sigBin.length - 8).toString("hex");
  const signature = sigBin.subarray(2, 2 + 64).toString("hex");

  return {
    keyId,
    signature,
    trustedComment: trustedLine?.slice("trusted comment: ".length),
    untrustedComment: untrustedLine?.slice("untrusted comment: ".length),
  };
}

/**
 * Sign a message with an ed25519 private key in PEM form. Returns
 * the hex-encoded 64-byte ed25519 signature. The caller is expected
 * to wrap it with the minisign 76-byte layout (`02 00 <sig 64> <keyId 8>`).
 *
 * This is used by the `bizar release-provenance` CLI when minisign
 * is not available — the operator's pipeline still needs to sign
 * something. Pure-JS signing keeps the SDK self-contained.
 */
export function signWithEd25519(message: Buffer, privateKeyPem: string, keyId: Buffer): string {
  const keyObject = createPrivateKey({ key: privateKeyPem, format: "pem" });
  const sig = sign(null, message, keyObject);
  const prefix = Buffer.from([0x02, 0x00]); // minisign sig num + type
  return Buffer.concat([prefix, sig, keyId.subarray(0, 8)]).toString("base64");
}

/**
 * Verify a minisign-style detached signature. The `publicKeyPem`
 * must be a SPKI PEM containing an ed25519 public key. The signed
 * message is the trusted-comment line + the trusted-comment body.
 *
 * For `*.minisig` verification at install, the caller passes:
 *
 *   1. The artifact bytes (the tarball) — used to compute the
 *      trusted-comment body that minisign signs.
 *   2. The signature blob.
 *   3. The pinned public key.
 */
export function verifyMinisign(
  artifactBytes: Buffer,
  signatureBlob: MinisignSignature,
  publicKeyPem: string,
  expectedTrustedComment?: string,
): SignatureVerificationResult {
  // Reconstruct what minisign signed:
  //   trusted-comment line + body
  // For minisign, the signed payload is the trusted-comment base64
  // decoded, prefixed with the raw "trusted comment: " header line.
  // We rebuild the trusted comment from the artifact's sha256 (the
  // minisign CLI prints this as the trusted-comment body).
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const trustedComment = `trusted comment: signed by bizar ${signatureBlob.keyId} sha256=${artifactSha256}\n`;

  if (expectedTrustedComment && trustedComment.trim() !== expectedTrustedComment.trim()) {
    return {
      ok: false,
      reason: "TRUSTED_COMMENT_MISMATCH",
      detail: `expected "${expectedTrustedComment}", got "${trustedComment.trim()}"`,
    };
  }

  let pubKey: KeyObject;
  try {
    pubKey = createPublicKey({ key: publicKeyPem, format: "pem" });
  } catch (err) {
    return {
      ok: false,
      reason: "INVALID_PUBLIC_KEY",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Reconstruct the 64-byte ed25519 signature from the minisign blob.
  const sigBuf = Buffer.from(signatureBlob.signature, "hex");
  if (sigBuf.length !== 64) {
    return { ok: false, reason: "INVALID_SIGNATURE_BLOB", detail: `expected 64-byte sig, got ${sigBuf.length}` };
  }
  const message = Buffer.from(trustedComment, "utf8");
  const verified = verify(null, message, pubKey, sigBuf);
  if (!verified) return { ok: false, reason: "SIGNATURE_MISMATCH" };
  return { ok: true, keyId: signatureBlob.keyId };
}