const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hdxgxgyzbpaeuvcdegmf.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkeGd4Z3l6YnBhZXV2Y2RlZ21mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NjM4NjUsImV4cCI6MjA4NTMzOTg2NX0.nZ-IgW6FtNt5xya3HXTsbKO3UoP5CM_ii4e6ogVyeH0');

supabase.from('ai_usage_logs').select('id').limit(1).then(res => {
    console.log(JSON.stringify(res, null, 2));
}).catch(err => {
    console.error(err);
});
