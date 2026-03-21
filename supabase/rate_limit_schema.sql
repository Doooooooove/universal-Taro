-- ============================================
-- Universal Tarot AI - AI Usage Rate Limiting
-- ============================================

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spread_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for counting daily usage efficiently
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date 
ON ai_usage_logs(user_id, spread_id, DATE(created_at AT TIME ZONE 'UTC'));

-- Optional: Enable RLS to prevent unauthorized access
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage logs" ON ai_usage_logs 
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify usage logs" ON ai_usage_logs
    FOR ALL USING (false); -- Prevent frontend from tampering/inserting usage logs
