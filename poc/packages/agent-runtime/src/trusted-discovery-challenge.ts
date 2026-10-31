/**
 * R151.34: independently originated 256-bit Gateway challenges have two
 * canonical encodings. Discovery inspector uses lowercase hex (64 chars),
 * while normal Gateway Prepare uses unpadded base64url (43 chars).
 *
 * Both have exactly 32 bytes. Reject padded/noncanonical/short/oversized
 * inputs; accepting a valid encoding NEVER authenticates its provenance.
 * The Gateway and Rust Core still bind each challenge to an exact request.
 */
const HEX=/^[a-f0-9]{64}$/u;
const BASE64URL=/^[A-Za-z0-9_-]{43}$/u;
export function isTrustedDiscoveryChallenge(value:unknown):value is string{
 if(typeof value!=="string")return false;
 if(HEX.test(value))return true;
 if(!BASE64URL.test(value))return false;
 const raw=Buffer.from(value,"base64url");
 return raw.length===32&&raw.toString("base64url")===value;
}
