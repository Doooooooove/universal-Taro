import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://hdxgxgyzbpaeuvcdegmf.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkeGd4Z3l6YnBhZXV2Y2RlZ21mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NjM4NjUsImV4cCI6MjA4NTMzOTg2NX0.nZ-IgW6FtNt5xya3HXTsbKO3UoP5CM_ii4e6ogVyeH0');
const USER_ID = '4419b3b4-df72-497f-9ecc-ebae8fcb3e43';
const plan = process.argv[2]; // free, plus, pro
if (!['free', 'plus', 'pro'].includes(plan)) {
    console.log('用法: node switch_plan.mjs <free|plus|pro>');
    process.exit(1);
}
if (plan === 'free') {
    await supabase.from('user_subscriptions').delete().eq('user_id', USER_ID);
    console.log(`✅ 已切换为 Free (删除订阅记录)`);
} else {
    const { data } = await supabase.from('user_subscriptions').select('user_id').eq('user_id', USER_ID);
    if (data && data.length > 0) {
        await supabase.from('user_subscriptions').update({ plan_type: plan, expires_at: '2099-12-31T23:59:59+00:00' }).eq('user_id', USER_ID);
    } else {
        await supabase.from('user_subscriptions').insert({ user_id: USER_ID, plan_type: plan, expires_at: '2099-12-31T23:59:59+00:00' });
    }
    console.log(`✅ 已切换为 ${plan.toUpperCase()}`);
}
const { data: result } = await supabase.from('user_subscriptions').select('*').eq('user_id', USER_ID);
console.log('当前状态:', JSON.stringify(result, null, 2));
