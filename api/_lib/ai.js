// Claude helpers for the builder dashboard. Every feature has a plain (non-AI) fallback so the
// product works without ANTHROPIC_API_KEY; the AI version just reads and writes more naturally.
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';

export const MODEL = 'claude-opus-5-5';

// ── DISPOSABLE (local dev only) ──────────────────────────────────────────────
// With AI_DEV_CLI=1 and no API key, calls go through the local `claude` CLI (print mode) so the
// AI features can be tried without an API key. Never active on Vercel. Delete once a key exists.
const devCli = () => !!process.env.AI_DEV_CLI && !process.env.VERCEL && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
function viaCli({ system, user, schema }) {
    return new Promise((resolve, reject) => {
        const args = ['-p', user, '--no-session-persistence', '--tools', '', '--output-format', 'json', '--system-prompt', system, '--model', 'sonnet'];
        if (schema) args.push('--json-schema', JSON.stringify(schema));
        execFile('claude', args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ANTHROPIC_API_KEY: '' } }, (err, stdout) => {
            if (err) return reject(err);
            let out; try { out = JSON.parse(stdout); } catch { return reject(new Error('claude cli: bad output')); }
            if (out.is_error) return reject(new Error(`claude cli: ${out.result}`));
            resolve(schema ? out.structured_output ?? JSON.parse(out.result) : String(out.result || '').trim());
        });
    });
}
// ── end disposable ───────────────────────────────────────────────────────────

export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) || devCli();

let client;
const getClient = () => (client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 }));

// One call, JSON out. `schema` is a JSON schema the reply must follow.
export async function askJson({ system, user, schema, maxTokens = 2000, effort = 'low' }) {
    if (devCli()) return viaCli({ system, user, schema });
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
    if (devCli()) return viaCli({ system, user });
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
