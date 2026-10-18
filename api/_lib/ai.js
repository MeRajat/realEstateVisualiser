// Claude helpers for the builder dashboard. Every feature has a plain (non-AI) fallback so the
// product works without ANTHROPIC_API_KEY; the AI version just reads and writes more naturally.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';
export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client;
const getClient = () => (client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 }));

// One call, JSON out. `schema` is a JSON schema the reply must follow.
export async function askJson({ system, user, schema, maxTokens = 2000, effort = 'low' }) {
    const response = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort, format: { type: 'json_schema', schema } },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('The assistant could not answer this.'), { status: 422 });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return JSON.parse(text);
}

export async function askText({ system, user, maxTokens = 1200, effort = 'low' }) {
    const response = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('The assistant could not answer this.'), { status: 422 });
    return response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}
