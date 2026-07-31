import { describe, it, expect } from 'vitest';
import { isPrivateIpv4 } from './net';

describe('isPrivateIpv4 (SSRF guard)', () => {
  it('accepts RFC1918 private ranges', () => {
    expect(isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateIpv4('10.255.255.255')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.31.255.254')).toBe(true);
    expect(isPrivateIpv4('192.168.88.1')).toBe(true);
    expect(isPrivateIpv4('  192.168.5.1  ')).toBe(true); // trims
  });

  it('rejects public addresses', () => {
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('1.1.1.1')).toBe(false);
    expect(isPrivateIpv4('172.15.0.1')).toBe(false); // just below the /12
    expect(isPrivateIpv4('172.32.0.1')).toBe(false); // just above the /12
    expect(isPrivateIpv4('192.169.0.1')).toBe(false);
  });

  it('rejects loopback and link-local/metadata', () => {
    expect(isPrivateIpv4('127.0.0.1')).toBe(false);
    expect(isPrivateIpv4('169.254.169.254')).toBe(false); // cloud metadata
  });

  it('rejects malformed / non-IPv4 input', () => {
    expect(isPrivateIpv4('')).toBe(false);
    expect(isPrivateIpv4('192.168.1')).toBe(false);
    expect(isPrivateIpv4('192.168.1.256')).toBe(false); // octet out of range
    expect(isPrivateIpv4('router.local')).toBe(false); // hostnames not allowed
    expect(isPrivateIpv4('10.0.0.1abc')).toBe(false);
  });
});
