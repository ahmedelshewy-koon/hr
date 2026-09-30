import test from "node:test";
import assert from "node:assert/strict";
import { allowsLocalPortalLogin } from "../app/local-platform-access.ts";

test("private IPv4 addresses allow portal login only during development", () => {
  for (const host of ["192.168.105.6", "10.0.0.1", "172.16.0.1", "172.31.255.254"]) {
    assert.equal(allowsLocalPortalLogin(host, "development"), true);
    for (const mode of ["production", "test", undefined]) {
      assert.equal(allowsLocalPortalLogin(host, mode), false);
    }
  }
});

test("public and malformed hosts cannot bypass platform access", () => {
  for (const host of ["example.com", "192.168.1.1.example.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.168.1.999", "10.1"]) {
    assert.equal(allowsLocalPortalLogin(host, "development"), false);
  }
  for (const host of ["localhost", "127.0.0.1"]) {
    assert.equal(allowsLocalPortalLogin(host, "development"), true);
  }
});
