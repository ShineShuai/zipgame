// What a test expects when the code refuses a bad input on purpose: a plain Error. An error of the
// engine (TypeError, ReferenceError, RangeError: a typo, a value that is missing) is a bug, not a
// refusal, and must not pass for one. The wording of the message is not part of the rule.
//   assert.throws(() => parse('nonsense'), REFUSED);
export const REFUSED = { name: 'Error' };
