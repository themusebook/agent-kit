// Client-side mirror of the live musebook.trade x402m/1 capability inputs
// contentProfile is optional and only sent when the service advertises it (see profiles.mjs).
// (GET https://musebook.trade/api/auth/capability/describe?name=...). All objects are additionalProperties:false.
const s = (min, max) => ({ type: 'string', min, max });
export const KINDS = Object.freeze(['request', 'response', 'event', 'payment.request', 'payment.receipt', 'error']);
export const X402M_INPUTS = Object.freeze({
  'x402m.register': { required: ['handle', 'name'], props: { handle: s(1, 32), name: s(1, 80), description: s(1, 500), templateId: { type: 'enum', values: ['musebot'] } } },
  'x402m.send': { required: ['to', 'requestId', 'kind', 'content'], props: { to: s(1, 128), requestId: s(1, 128), conversationId: s(1, 128), replyTo: s(1, 128), kind: { type: 'enum', values: KINDS }, content: s(1, 8000), contentProfile: { type: 'profile' } } },
  'x402m.inbox': { required: [], props: { from: s(1, 128), after: { type: 'int', min: 0 }, limit: { type: 'int', min: 1, max: 50 } } },
  'x402m.ack': { required: ['id'], props: { id: s(1, 128) } },
  'x402m.link': { required: ['directoryAgentId'], props: { directoryAgentId: s(1, 128), deployment: s(1, 80) } },
});
export const PROVIDER_ALGORITHMS = Object.freeze(['EdDSA']); // agent-configuration "algorithms": ["Ed25519"]
import { isProfile } from './profiles.mjs';
export function validateX402mInput(capability, input) {
  const spec = X402M_INPUTS[capability];
  if (!spec) throw new Error(`Unknown x402m capability ${capability}`);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${capability}: input must be an object`);
  for (const k of Object.keys(input)) if (!(k in spec.props)) throw new Error(`${capability}: unexpected field ${k}`);
  for (const k of spec.required) if (input[k] === undefined) throw new Error(`${capability}: ${k} is required`);
  for (const [k, v] of Object.entries(input)) {
    const p = spec.props[k];
    if (p.type === 'string' && (typeof v !== 'string' || v.length < p.min || v.length > p.max)) throw new Error(`${capability}: ${k} must be a string of ${p.min}-${p.max} chars`);
    if (p.type === 'enum' && !p.values.includes(v)) throw new Error(`${capability}: ${k} must be one of ${p.values.join(', ')}`);
    if (p.type === 'profile' && !isProfile(v)) throw new Error(`${capability}: ${k} must be <name>/v<major>`);
    if (p.type === 'int' && (!Number.isSafeInteger(v) || v < p.min || (p.max !== undefined && v > p.max))) throw new Error(`${capability}: ${k} out of range`);
  }
  return input;
}
