// The content of this file is base on digest-fetch by Stefan Liu
// https://github.com/devfans/digest-fetch

import { Response } from "node-fetch";
import { Md5 as MD5 } from "ts-md5/dist/md5";
import * as base64 from "base-64";

const NONCE_SIZE = 32;
let nc = 0;

const parse = (raw: string, field: string, trim = true) => {
  const regex = new RegExp(`${field}=("[^"]*"|[^,]*)`, "i");
  const match = regex.exec(raw);
  if (match) {
    return trim ? match[1].replace(/[\s"]/g, "") : match[1];
  }
  return null;
};

function parseQop(rawAuth: string) {
  // Following https://en.wikipedia.org/wiki/Digest_access_authentication
  // to parse valid qop
  // Samples
  // : qop="auth,auth-init",realm=
  // : qop=auth,realm=
  const _qop = parse(rawAuth, "qop");

  if (_qop !== null) {
    const qops = _qop.split(",");
    if (qops.includes("auth")) {
      return "auth";
    } else if (qops.includes("auth-int")) {
      return "auth-int";
    }
  }
  // when not specified
  return null;
}

function makeNonce() {
  let uid = "";
  for (let i = 0; i < NONCE_SIZE; ++i) {
    uid += "abcdef0123456789"[Math.floor(Math.random() * 16)];
  }
  return uid;
}

export function computeAuth(
  resp: Response,
  user: string,
  password: string,
  method = "GET"
): string {
  const header = resp.headers.get("www-authenticate");

  if (!header || header.length < 5) {
    throw Error("Cannot authenticate: bad HTTP header");
  }

  const scheme = header.split(/\s/)[0];

  if (scheme === "Basic") {
    return "Basic " + base64.encode(`${user}:${password}`);
  }

  const realm = (parse(header, "realm", false) || "").replace(/["]/g, "");
  const qop = parseQop(header);
  const opaque = parse(header, "opaque");
  const nonce = parse(header, "nonce") || "";
  const cnonce = makeNonce();
  nc++;

  const url = resp.url;

  const _url = url.replace("//", "");
  const uri = _url.indexOf("/") === -1 ? "/" : _url.slice(_url.indexOf("/"));

  const ha1 = MD5.hashStr(`${user}:${realm}:${password}`);

  let _ha2 = "";
  if (qop === "auth-int") {
    throw Error("Canot authenticate: auth-int is not implemented");
  }
  const ha2 = MD5.hashStr(`${method}:${uri}${_ha2}`);

  const ncs = ("00000000" + nc).slice(-8);

  let _response = qop? `${ha1}:${nonce}:${ncs}:${cnonce}:${qop}:${ha2}` : `${ha1}:${nonce}:${ha2}`;
  const response = MD5.hashStr(_response);

  const opaqueString = opaque !== null ? `opaque="${opaque}",` : "";
  const qopString = qop ? `qop="${qop}",` : "";
  const digest = `${scheme} username="${user}",realm="${realm}",\
nonce="${nonce}",uri="${uri}",${opaqueString}${qopString}\
algorithm="MD5",response="${response}",nc=${ncs},cnonce="${cnonce}"`;

  return digest;
}
