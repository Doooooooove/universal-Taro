const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://hdxgxgyzbpaeuvcdegmf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkeGd4Z3l6YnBhZXV2Y2RlZ21mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NjM4NjUsImV4cCI6MjA4NTMzOTg2NX0.nZ-IgW6FtNt5xya3HXTsbKO3UoP5CM_ii4e6ogVyeH0';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const email = 'test' + Date.now() + '@example.com';
  const password = 'password123';
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
  if (authError) return console.error('Sign up error:', authError);
  
  const token = authData.session.access_token;
  const res = await fetch(supabaseUrl + '/functions/v1/create-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'apikey': supabaseKey },
    body: JSON.stringify({ planType: 'plus' })
  });
  
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Body:', text);
  
  // Cleanup
  await supabase.rpc('delete_current_user');
}
run();
