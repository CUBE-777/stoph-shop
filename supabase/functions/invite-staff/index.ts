// OPTIONAL (Phase 2): Edge Function that e-mails an invitation to a new staff member.
// NOT deployed or tested in the build environment. Without it, invite people from
// Supabase Dashboard > Authentication > Users > "Invite user", then add them in /admin/staff.
//
// Security: the caller's JWT is checked in the database (has_permission('staff.manage')), and the
// role assignment itself goes through register_staff_by_email(), which re-applies every rule
// (no self-grant, only roles you already hold, owner role owner-only). The service_role key lives
// only here (injected by Supabase), never in the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: allowed } = await caller.rpc('has_permission', { p_key: 'staff.manage' });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  let body: { email?: string; full_name?: string; role_ids?: string[]; redirect_to?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !Array.isArray(body.role_ids) || body.role_ids.length === 0) {
    return json({ error: 'invalid_body' }, 400);
  }

  // Dry-run the permission rules BEFORE sending any e-mail is not possible without the user existing,
  // so: invite first (idempotent for existing users), then register through the rule-enforcing RPC.
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: body.redirect_to });
  if (inviteError && !/already|registered|exists/i.test(inviteError.message)) return json({ error: 'invite_failed' }, 400);

  const { error } = await caller.rpc('register_staff_by_email', {
    p_email: email, p_full_name: body.full_name ?? '', p_role_ids: body.role_ids,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
