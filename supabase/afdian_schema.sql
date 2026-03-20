-- ============================================
-- 爱发电支付集成 - 数据库表
-- ============================================

-- 1. 爱发电订单记录（Webhook 回调写入）
CREATE TABLE IF NOT EXISTS afdian_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  out_trade_no TEXT UNIQUE NOT NULL,
  afdian_user_id TEXT,
  plan_id TEXT,
  month INTEGER DEFAULT 1,
  total_amount DECIMAL(10,2),
  status INTEGER,                           -- 2=已支付
  raw_data JSONB,
  matched_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_afdian_orders_plan ON afdian_orders(plan_id);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_afdian_user ON afdian_orders(afdian_user_id);

ALTER TABLE afdian_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on afdian_orders" ON afdian_orders FOR ALL USING (true);

-- 2. 订阅意向（用户点击"订阅"时写入）
CREATE TABLE IF NOT EXISTS subscription_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,                    -- 爱发电 plan_id
  plan_type TEXT NOT NULL,                  -- 'plus' / 'pro'
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'expired')),
  matched_order_id UUID REFERENCES afdian_orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intents_user ON subscription_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_intents_status ON subscription_intents(status);

ALTER TABLE subscription_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own intents" ON subscription_intents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on intents" ON subscription_intents FOR ALL USING (true);

-- 3. 用户订阅状态
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL DEFAULT 'free',
  afdian_plan_id TEXT,
  expires_at TIMESTAMPTZ,
  last_order_no TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscription" ON user_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on subscriptions" ON user_subscriptions FOR ALL USING (true);

-- 4. 爱发电用户绑定（afdian_user_id ↔ app_user_id 映射）
CREATE TABLE IF NOT EXISTS afdian_user_bindings (
  afdian_user_id TEXT PRIMARY KEY,
  app_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE afdian_user_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bindings" ON afdian_user_bindings FOR ALL USING (true);
