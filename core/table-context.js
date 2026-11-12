// Uses table headings and field labels as context for values that a detector
// already found, and recovers names when a clear name/company column contains
// a value the free-text heuristics would not recognize.
(function (g) {
  'use strict';
  const P = g.PIIRA;
  const U = P.util;

  const HEADERS = new Map();
  const bearerSample = P.detectors.flatMap((detector) =>
    detector.detect('Authorization: Bearer xxxxx.yyyyy.zzzzz')).find((d) => d.rule === 'key-bearer');
  if (!bearerSample || !P.typeInfo(bearerSample.label)) throw new Error('Bearer token detector type is not configured');
  const BEARER_TYPE = bearerSample.label;
  const aliases = (type, names) => {
    for (const name of names) HEADERS.set(normalize(name), type);
  };

  function normalize(value) {
    return value.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  for (const type of P.TYPES) HEADERS.set(normalize(type.name), type.name);

  aliases(BEARER_TYPE, ['bearer token', 'authorization token']);
  aliases('Person Name', ['name', 'full name', 'person name', 'customer name', 'client name', 'applicant name',
    'employee name', 'patient name', 'student name', 'candidate name', 'account holder', 'account holder name',
    'nominee name', 'beneficiary name', 'contact person', 'first name', 'last name', 'surname']);
  aliases('Business Name', ['company', 'company name', 'business', 'business name', 'firm', 'firm name',
    'employer', 'merchant', 'vendor', 'supplier', 'seller', 'buyer bill to', 'organisation', 'organization']);
  aliases('Email Address', ['email', 'email address', 'e mail', 'mail id']);
  aliases('Contact Number', ['phone', 'phone number', 'mobile', 'mobile number', 'contact number', 'contact',
    'telephone', 'tel']);
  aliases('Address', ['address', 'billing address', 'shipping address', 'delivery address', 'residential address']);
  aliases('Date of Birth', ['dob', 'date of birth', 'birth date']);
  aliases('Date', ['date', 'invoice date', 'issue date', 'dated']);
  aliases('Indian GSTIN', ['gstin', 'gstin uin', 'gst uin', 'gst number', 'goods and services tax identification number']);
  aliases('Indian PAN (Individual)', ['individual pan', 'pan individual']);
  aliases('Indian PAN (Business)', ['company pan', 'company s pan', 'business pan', 'pan business']);
  aliases('Indian TAN', ['tan', 'tax deduction account number']);
  aliases('Indian CIN', ['cin', 'corporate identification number']);
  aliases('Indian UAN', ['uan', 'universal account number', 'pf uan']);
  aliases('Indian Aadhaar Number', ['aadhaar', 'aadhaar number', 'aadhar', 'aadhar number', 'uid']);
  aliases('Indian Voter ID', ['voter id', 'voter identification number', 'epic number']);
  aliases('Passport Number', ['passport', 'passport number']);
  aliases('Driver Licence Number', ['driver licence', 'driver license', 'driving licence', 'driving license']);
  aliases('Indian IFSC Code', ['ifsc', 'ifsc code']);
  aliases('Indian UPI ID', ['upi', 'upi id', 'vpa']);
  aliases('Bank Account Number', ['bank account', 'bank account number', 'account number', 'account no',
    'a c number', 'a c no', 'acct number']);
  aliases('US Social Security Number', ['ssn', 'social security number']);
  aliases('US Employer Identification Number', ['ein', 'employer identification number']);
  aliases('Brazilian CPF', ['cpf', 'cpf number']);
  aliases('Brazilian CNPJ', ['cnpj', 'cnpj number']);
  aliases('Indonesian NIK', ['nik', 'nik number']);
  aliases('Indonesian NPWP', ['npwp', 'npwp number']);
  aliases('Vehicle Number Plate', ['vehicle number', 'vehicle registration', 'license plate', 'licence plate']);
  aliases('IP Address', ['ip address', 'ip']);
  aliases('URL/Link', ['url', 'website', 'web address']);
  aliases('Person Username', ['username', 'user name', 'login id', 'user id']);

  const normalizeCell = (value) => normalize(value.replace(/^\s*:\s*/, '').replace(/\s*:\s*$/, ''));
  const HEADER_PATTERN = [...HEADERS.keys()].sort((a, b) => b.length - a.length)
    .map((name) => U.escapeRe(name).replace(/ /g, '[ \\t]+')).join('|');

  function splitRow(line, offset) {
    const delimiter = line.includes('|') ? '|' : line.includes('\t') ? '\t' : line.includes(',') ? ',' : null;
    if (!delimiter) return null;
    const cells = [];
    let start = 0;
    let quoted = false;
    for (let i = 0; i <= line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { i++; continue; }
        quoted = !quoted;
      }
      if (i === line.length || (ch === delimiter && !quoted)) {
        let a = start;
        let b = i;
        while (a < b && /\s/.test(line[a])) a++;
        while (b > a && /\s/.test(line[b - 1])) b--;
        if (line[a] === '"' && line[b - 1] === '"') { a++; b--; }
        cells.push({ start: offset + a, end: offset + b, text: line.slice(a, b) });
        start = i + 1;
      }
    }
    return cells.length > 1 ? { delimiter, cells } : null;
  }

  function rows(text) {
    const out = [];
    let start = 0;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      const row = splitRow(text.slice(start, end).replace(/\r$/, ''), start);
      if (row) {
        row.lineStart = start;
        row.lineEnd = end;
        row.separator = row.cells.every((c) => /^:?-{3,}:?$/.test(c.text.trim()));
        out.push(row);
      }
      start = end + 1;
    }
    return out;
  }

  function headerType(value) {
    const text = normalizeCell(value);
    if (HEADERS.has(text)) return HEADERS.get(text);
    return null;
  }

  // Form and schema words in a "name" column ("fields", "street", "zipcode") and code identifiers
  // ("form.name", "user.first_name") are not names.
  const FIELD_WORDS = new Set(('name names first last middle full street city state zip zipcode postcode pincode country ' +
    'email phone mobile address field fields form forms value values key keys label labels id type string text input').split(' '));
  function validName(value) {
    const cleaned = P.cleanPersonName(value.replace(/\s*\(cid:\d+\)\s*/gi, ' '));
    if (cleaned.split(/[ \t]+/).every((w) => FIELD_WORDS.has(w.toLowerCase()))) return false;
    if (TYPE_WORDS.has(cleaned.toLowerCase())) return false; // "name: str", "owner: string": a type in code, not a value
    if (/^[a-z_$][\w$]*\.[a-z_$][\w$.]*$/.test(cleaned)) return false;
    if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(cleaned)) return false; // "payments-secrets", "user_service": a resource name
    // A lowercase phrase ("whole word or not", "except"): not a name. A lowercase name stays ("sanchit", "ravi kumar").
    const words = cleaned.split(/[ \t]+/);
    if (words.every((w) => w === w.toLowerCase()) && (words.some((w) => COMMON_LOWER.has(w)) ||
      (words.length >= 3 && !words.every((w) => P.names && P.names.kind(w.charAt(0).toUpperCase() + w.slice(1)))))) return false;
    return cleaned.length > 0 && cleaned.length <= 100 &&
      /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*(?:[ \t]+[\p{L}\p{M}][\p{L}\p{M}'’.-]*){0,5}$/u.test(cleaned) &&
      !P.knownNames.lookup(cleaned);
  }

  const COMMON_LOWER = new Set(('a an the and or not no yes of to in on at for by with from as is are was be it this that ' +
    'except only all any each every some none whole word words other others same true false etc misc tbd').split(' '));

  // Types in code and schemas ("name: str", "title: String", "owner VARCHAR(100)"): never a person's name.
  const TYPE_WORDS = new Set(('str string int integer float double long short bool boolean bytes byte char varchar text dict ' +
    'list tuple set map array object any none null optional number decimal date datetime timestamp uuid void').split(' '));

  function validBusiness(value) {
    const cleaned = value.trim();
    return cleaned.length > 1 && cleaned.length <= 140 && /[\p{L}]/u.test(cleaned) &&
      /^[\p{L}\p{M}\p{N}&'’.,()\/ -]+$/u.test(cleaned) && !P.knownNames.lookup(cleaned);
  }

  function makeValue(text, cell, type, out) {
    const start = cell.start;
    const end = cell.end;
    const value = text.slice(start, end).trim();
    if (!value || !P.typeInfo(type)) return;

    const overlapping = out.filter((d) => d.start < end && d.end > start);
    if (overlapping.length) {
      for (const d of overlapping) {
        if (d.start >= start && d.end <= end && P.broadLabel(d.label) === P.broadLabel(type)) {
          d.confidence = Math.max(d.confidence, 0.88);
          d.rule = 'table-header';
        }
      }
      return;
    }

    let s = start;
    let e = end;
    if (type === 'Person Name') {
      const match = /^[\s:]*([\p{L}\p{M}][\p{L}\p{M}'’.-]*(?:[ \t]+[\p{L}\p{M}][\p{L}\p{M}'’.-]*){0,5})/u.exec(value);
      if (!match || !validName(match[1])) return;
      s += value.indexOf(match[1]);
      e = s + match[1].length;
    } else if (type === 'Business Name') {
      if (!validBusiness(value)) return;
      s = start + text.slice(start, end).search(/\S/);
      e = s + value.length;
    } else if (type === BEARER_TYPE) {
      const match = /^(?:Bearer[ \t]+)?([A-Za-z0-9._~+/-]{16,}=*)$/i.exec(value);
      if (!match) return;
      s = start + value.indexOf(match[1]);
      e = s + match[1].length;
    } else {
      return;
    }
    out.push(U.make(text, s, e, type, 0.82, 'heuristic', 'table-header'));
  }

  function addInlineFieldValues(text, out) {
    const re = new RegExp(
      String.raw`(?:^|[|,\t])\s*(${HEADER_PATTERN})\s*[:=]\s*([^|,\t\n]{1,160}?)(?=\s+(?:[.;]\s*)?(?:${HEADER_PATTERN})\s*[:=]|[|,\t\n]|$)`,
      'gimdu'
    );
    let match;
    while ((match = re.exec(text)) !== null) {
      const type = headerType(match[1]);
      if (!type) continue;
      const value = match[2].trim();
      const valueIndex = match.indices[2][0];
      const offset = valueIndex + (match[2].length - match[2].trimStart().length);
      makeValue(text, { start: offset, end: offset + value.length }, type, out);
    }
  }

  function apply(text, detections) {
    const out = detections.slice();
    const tableRows = rows(text);
    addInlineFieldValues(text, out);
    for (let i = 0; i < tableRows.length; i++) {
      const row = tableRows[i];
      if (row.separator) continue;
      const headers = row.cells.map((cell) => headerType(cell.text));
      if (!headers.some(Boolean)) continue;
      const nextData = tableRows.slice(i + 1).find((candidate) =>
        !candidate.separator && candidate.delimiter === row.delimiter);
      const isHeaderRow = headers.filter(Boolean).length > 1 ||
        (headers.some(Boolean) && row.cells.some((cell, j) => !headers[j] && cell.text.trim() === '')) ||
        Boolean(nextData && nextData.cells.length === row.cells.length &&
          !nextData.cells.some((cell) => headerType(cell.text)));
      if (!isHeaderRow) {
        for (let col = 0; col < headers.length; col++) {
          if (!headers[col]) continue;
          const value = row.cells.slice(col + 1).find((cell) => cell.text.trim() && !headerType(cell.text));
          if (value) makeValue(text, value, headers[col], out);
        }
      }
      if (!isHeaderRow) continue;

      for (let j = i + 1; j < tableRows.length; j++) {
        const dataRow = tableRows[j];
        if (dataRow.lineStart - row.lineEnd > 500) break;
        if (dataRow.delimiter !== row.delimiter) break;
        if (dataRow.separator) continue;
        if (dataRow.cells.some((cell) => headerType(cell.text))) break;
        for (let col = 0; col < headers.length && col < dataRow.cells.length; col++) {
          if (headers[col]) makeValue(text, dataRow.cells[col], headers[col], out);
        }
      }
    }
    return out;
  }

  P.tableContext = { apply };
})(globalThis);
