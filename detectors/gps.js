// GPS Coordinates (labeled Address): a latitude, longitude pair.
//   - decimal: 12.971599, 77.594566 — both with 4+ decimals (fewer only after a GPS keyword)
//   - with hemispheres: 12.9716° N, 77.5946° E
//   - degrees, minutes, seconds: 12°58'17.8"N 77°35'40.6"E
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const DECIMAL = /(?<![\w.-])(-?\d{1,2}\.(\d{2,8}))°?[ \t]*([NS])?[ \t]*,[ \t]*(-?\d{1,3}\.(\d{2,8}))°?[ \t]*([EW])?(?![\w.])/gd;
  const DMS = /\b\d{1,2}°[ \t]*\d{1,2}['′][ \t]*\d{1,2}(?:\.\d+)?(?:"|″|'')[ \t]*[NS][ \t,]*\d{1,3}°[ \t]*\d{1,2}['′][ \t]*\d{1,2}(?:\.\d+)?(?:"|″|'')[ \t]*[EW]\b/gd;
  const GPS_KW = /\b(?:gps|coordinates?|co-ordinates?|lat(?:itude)?|long(?:itude)?|lng|location|geo(?:location)?|map|pin)\b/i;

  function detect(text) {
    return [
      ...U.collect(text, DECIMAL, 'GPS Coordinates', (v, m, s, e) => {
        const lat = Math.abs(+m[1]);
        const lon = Math.abs(+m[4]);
        if (lat > 90 || lon > 180) return null;
        if (m[3] || m[6]) return 0.92;
        const kw = U.near(text, s, e, GPS_KW, 40, 0);
        if (m[2].length >= 4 && m[5].length >= 4) return kw ? 0.95 : 0.85;
        return kw ? 0.85 : null;
      }, 'regex', { rule: 'gps-decimal' }),
      ...U.collect(text, DMS, 'GPS Coordinates', 0.95, 'regex', { rule: 'gps-dms' }),
    ];
  }

  U.register('GPS Coordinates', detect);
})(globalThis);
