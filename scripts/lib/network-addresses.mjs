import { networkInterfaces } from "node:os";

const VIRTUAL_INTERFACE = /^(?:br-|docker|veth|virbr|podman|tun|tap|wg)/i;

/** 開発端末へ自動割当された、LANアクセス向けIPv4アドレスを列挙する。 */
export function discoverLanAddresses(interfaces = networkInterfaces()) {
  const addresses = [];
  const seen = new Set();
  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === "IPv4" || entry.family === 4;
      if (!isIpv4 || entry.internal || entry.address.startsWith("169.254.")) continue;
      if (seen.has(entry.address)) continue;
      seen.add(entry.address);
      addresses.push({ interface: name, address: entry.address });
    }
  }
  return addresses;
}

export function developmentServerUrls(port, interfaces = networkInterfaces()) {
  return [
    { kind: "Local", url: `http://127.0.0.1:${port}/` },
    ...discoverLanAddresses(interfaces).map(({ interface: name, address }) => ({
      kind: `Network (${name})`,
      url: `http://${address}:${port}/`
    }))
  ];
}
