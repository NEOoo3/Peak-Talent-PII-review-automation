// IP Address types: Public IPv4 Address, Private IP Address (10.x, 172.16-31.x, 192.168.x,
// 127.x, 169.254.x, fc00::/7, fe80::), IPv6 Address and MAC Address.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;
  const isPrivateV4 = (v) => {
    const [a, b] = v.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  };
  const isPrivateV6 = (v) => /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(v) || v === '::1';
  // 00:1A:2B:3C:4D:5E · 00-1A-2B-3C-4D-5E · 001a.2b3c.4d5e (Cisco)
  const MAC = /(?<![\w:-])[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}(?![\w:-])/gd;
  const MAC_DOTTED = /(?<![\w.])[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}(?![\w.])/gd;

  const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
  // Not preceded by a word char or "." (so "v1.2.3.4" and "1.2.3.4.5" are skipped),
  // not followed by a word char or ".digit".
  const IPV4 = new RegExp(`(?<![\\w.])(?:${OCTET}\\.){3}${OCTET}(?!\\w|\\.\\d)`, 'gd');

  // Loose IPv6 candidate; the validator below decides.
  const IPV6 = /(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])/gd;

  const GROUP = /^[0-9A-Fa-f]{1,4}$/;

  function ipv6Groups(s) {
    const doubles = s.split('::').length - 1;
    if (doubles > 1) return -1;
    if (doubles === 0) {
      const parts = s.split(':');
      return parts.length === 8 && parts.every((p) => GROUP.test(p)) ? 8 : -1;
    }
    const [a, b] = s.split('::');
    const pa = a ? a.split(':') : [];
    const pb = b ? b.split(':') : [];
    const all = pa.concat(pb);
    if (!all.length || all.some((p) => !GROUP.test(p)) || all.length > 7) return -1;
    return all.length;
  }

  function detect(text) {
    // This computer (127.x loopback, 0.0.0.0 "any address") identifies nobody.
    const v4 = U.collect(text, IPV4, 'Public IPv4 Address', (v) => (/^(?:127\.|0\.0\.0\.0$)/.test(v) ? null : 0.95), 'regex', { rule: 'ipv4' });
    for (const d of v4) if (isPrivateV4(d.text)) { d.label = 'Private IP Address'; d.rule = 'ipv4-private'; }
    const v6 = U.collect(text, IPV6, 'IPv6 Address', (v) => {
      const groups = ipv6Groups(v);
      if (groups < 0) return null;
      // Needs at least one hex letter or "::" to be distinguishable from times/ratios.
      if (!/[a-f]/i.test(v) && !v.includes('::')) return null;
      return groups >= 3 || v.includes('::') ? 0.9 : 0.6;
    }, 'regex', { rule: 'ipv6' });
    // The PII type list: "internal_ip" is a private IPv4 address; every IPv6 address is "ipv6".
    for (const d of v6) if (isPrivateV6(d.text)) d.rule = 'ipv6-private';
    const loopback = v6.filter((d) => d.text === '::1'); // this computer, like 127.0.0.1
    for (const d of loopback) v6.splice(v6.indexOf(d), 1);
    const mac = [
      ...U.collect(text, MAC, 'MAC Address', 0.92, 'regex', { rule: 'mac' }),
      ...U.collect(text, MAC_DOTTED, 'MAC Address', (v) => (/[a-f]/i.test(v) ? 0.85 : null), 'regex', { rule: 'mac-dotted' }),
    ];
    return v4.concat(v6, mac);
  }

  U.register('IP Address', detect);
  P.ipv6Groups = ipv6Groups;
})(globalThis);
