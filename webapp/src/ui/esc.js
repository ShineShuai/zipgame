// Text for HTML: element content and quoted attribute values. One helper for the whole app
// (the apps used to carry three copies, one of them without the quotes).
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = text => String(text).replace(/[&<>"']/g, c => ESCAPES[c]);

// Also line breaks, for an attribute that carries several lines (a tooltip).
export const escLines = text => esc(text).replace(/\n/g, '&#10;');
