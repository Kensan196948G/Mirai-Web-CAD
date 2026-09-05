import test from "node:test";
import assert from "node:assert/strict";
import { developmentServerUrls, discoverLanAddresses } from "../scripts/lib/network-addresses.mjs";

const fixtures = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  eno1: [{ address: "192.168.0.185", family: "IPv4", internal: false }],
  wlan0: [{ address: "10.0.0.24", family: 4, internal: false }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  "br-012345": [{ address: "172.22.0.1", family: "IPv4", internal: false }],
  enp2s0: [{ address: "169.254.10.1", family: "IPv4", internal: false }]
};

test("discoverLanAddresses keeps automatically assigned physical IPv4 addresses", () => {
  assert.deepEqual(discoverLanAddresses(fixtures), [
    { interface: "eno1", address: "192.168.0.185" },
    { interface: "wlan0", address: "10.0.0.24" }
  ]);
});

test("developmentServerUrls includes loopback and detected LAN URLs", () => {
  assert.deepEqual(developmentServerUrls(4174, fixtures), [
    { kind: "Local", url: "http://127.0.0.1:4174/" },
    { kind: "Network (eno1)", url: "http://192.168.0.185:4174/" },
    { kind: "Network (wlan0)", url: "http://10.0.0.24:4174/" }
  ]);
});
