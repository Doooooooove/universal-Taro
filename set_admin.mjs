import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://hdxgxgyzbpaeuvcdegmf.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkeGd4Z3l6YnBhZXV2Y2RlZ21mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NjM4NjUsImV4cCI6MjA4NTMzOTg2NX0.nZ-IgW6FtNt5xya3HXTsbKO3UoP5CM_ii4e6ogVyeH0'
);

const USER_ID = '4419b3b4-df72-497f-9ecc-ebae8fcb3e43';

// 升级为 pro，过期时间设为 2099 年
const { error } = await supabase
    .from('user_subscriptions')
    .update({
        plan_type: 'pro',
        expires_at: '2099-12-31T23:59:59.000+00:00'
    })
    .eq('user_id', USER_ID);

if (error) {
    console.error('Update failed:', error);
} else {
    console.log('✅ User upgraded to PRO with unlimited expiry!');
}

// 验证
const { data } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', USER_ID);
console.log('Current status:', JSON.stringify(data, null, 2));
