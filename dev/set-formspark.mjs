#!/usr/bin/env node
// Connects the contact form to a Formspark form.
// Usage: node dev/set-formspark.mjs <form-id>              for example: node dev/set-formspark.mjs AbCd1234
//        node dev/set-formspark.mjs https://submit-form.com/AbCd1234
// Then run npm run check and push to main. The form ID is public by design: it is in the page source.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '../site/contact.html');
const input = (process.argv[2] || '').trim();
const match = /^(?:https:\/\/submit-form\.com\/)?([A-Za-z0-9_-]+)\/?$/.exec(input);
if (!match || match[1] === 'FORMULIER-ID') {
  console.error('Give the Formspark form ID (for example AbCd1234) or its endpoint (https://submit-form.com/AbCd1234).');
  process.exit(1);
}

const endpoint = `https://submit-form.com/${match[1]}`;
const html = fs.readFileSync(file, 'utf8');
const pattern = /(<form\b[^>]*\sdata-contact-form\b[^>]*>)/g;
const forms = html.match(pattern) || [];
if (forms.length !== 1) {
  console.error(`Expected one contact form (data-contact-form) in site/contact.html, found ${forms.length}.`);
  process.exit(1);
}
const formTag = forms[0];
if (!/\saction="[^"]*"/.test(formTag)) {
  console.error('The contact form has no action attribute to replace.');
  process.exit(1);
}
const updated = formTag.replace(/\saction="[^"]*"/, ` action="${endpoint}"`);
fs.writeFileSync(file, html.replace(formTag, updated));
console.log(`site/contact.html: the contact form now posts to ${endpoint}`);
console.log('Next: npm run check, commit and push to main. After the deploy, send one test message from');
console.log('the live contact page and check that it arrives. If the page says it was not sent, compare');
console.log('the form ID with the one in the Formspark dashboard.');
