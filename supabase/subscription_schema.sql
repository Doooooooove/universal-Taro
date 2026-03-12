-- ============================================
-- Subscription System Schema
-- 替代金币经济，改为月卡订阅模式
-- ============================================

-- ============================================
-- 1. 订阅表
-- ============================================
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('plus', 'pro')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  afdian_user_id TEXT,
  afdian_order_id TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- ============================================
-- 2. 每日使用量表
-- ============================================
CREATE TABLE daily_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, usage_date)
);

CREATE INDEX idx_daily_usage_user_date ON daily_usage(user_id, usage_date);

-- ============================================
-- 3. RLS 策略
-- ============================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own daily usage" ON daily_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Service role 才能写入（通过 Edge Function / RPC）
CREATE POLICY "Service can manage subscriptions" ON subscriptions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service can manage daily usage" ON daily_usage
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 4. 函数: 获取用户当前有效订阅
-- ============================================
CREATE OR REPLACE FUNCTION get_user_subscription(p_user_id UUID)
RETURNS TABLE (
  plan TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.plan, s.status, s.expires_at
  FROM subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
    AND s.expires_at > NOW()
  ORDER BY s.expires_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. 函数: 激活/续费订阅
-- ============================================
CREATE OR REPLACE FUNCTION activate_subscription(
  p_user_id UUID,
  p_plan TEXT,
  p_months INTEGER DEFAULT 1,
  p_afdian_user_id TEXT DEFAULT NULL,
  p_afdian_order_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_expires TIMESTAMPTZ;
  v_new_expires TIMESTAMPTZ;
BEGIN
  -- 检查当前是否有有效订阅
  SELECT expires_at INTO v_current_expires
  FROM subscriptions
  WHERE user_id = p_user_id
    AND status = 'active'
    AND expires_at > NOW()
  ORDER BY expires_at DESC
  LIMIT 1;

  -- 如果有有效订阅，在到期时间上续期；否则从当前时间开始
  IF v_current_expires IS NOT NULL THEN
    -- 如果是升级计划（从 plus 到 pro），从现在开始
    -- 如果是续费同类型，从到期时间续
    v_new_expires := GREATEST(v_current_expires, NOW()) + (p_months || ' months')::INTERVAL;
    
    -- 将旧订阅标记为过期（如果是不同计划）
    UPDATE subscriptions
    SET status = 'expired'
    WHERE user_id = p_user_id
      AND status = 'active'
      AND plan != p_plan;
  ELSE
    v_new_expires := NOW() + (p_months || ' months')::INTERVAL;
  END IF;

  -- 插入新订阅记录
  INSERT INTO subscriptions (user_id, plan, status, afdian_user_id, afdian_order_id, expires_at)
  VALUES (p_user_id, p_plan, 'active', p_afdian_user_id, p_afdian_order_id, v_new_expires);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. 函数: 增加每日用量并检查限额
-- 返回: 当前已用次数（增加后），-1 表示超限
-- ============================================
CREATE OR REPLACE FUNCTION increment_daily_usage(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_plan TEXT;
  v_limit INTEGER;
  v_current INTEGER;
BEGIN
  -- 获取用户订阅等级
  SELECT s.plan INTO v_plan
  FROM subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
    AND s.expires_at > NOW()
  ORDER BY s.expires_at DESC
  LIMIT 1;

  -- 设定每日限额
  IF v_plan = 'pro' THEN
    v_limit := 9999; -- 无限
  ELSIF v_plan = 'plus' THEN
    v_limit := 3;
  ELSE
    v_limit := 1; -- 免费用户
  END IF;

  -- 获取当前使用量
  SELECT count INTO v_current
  FROM daily_usage
  WHERE user_id = p_user_id AND usage_date = CURRENT_DATE;

  IF v_current IS NULL THEN
    v_current := 0;
  END IF;

  -- 检查是否超限
  IF v_current >= v_limit THEN
    RETURN -1;
  END IF;

  -- 增加使用量（upsert）
  INSERT INTO daily_usage (user_id, usage_date, count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET count = daily_usage.count + 1;

  RETURN v_current + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. 函数: 获取今日使用情况
-- ============================================
CREATE OR REPLACE FUNCTION get_daily_usage_info(p_user_id UUID)
RETURNS TABLE (
  plan TEXT,
  daily_used INTEGER,
  daily_limit INTEGER
) AS $$
DECLARE
  v_plan TEXT;
  v_used INTEGER;
  v_limit INTEGER;
BEGIN
  -- 获取订阅
  SELECT s.plan INTO v_plan
  FROM subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
    AND s.expires_at > NOW()
  ORDER BY s.expires_at DESC
  LIMIT 1;

  IF v_plan IS NULL THEN
    v_plan := 'free';
  END IF;

  -- 获取今日用量
  SELECT COALESCE(d.count, 0) INTO v_used
  FROM daily_usage d
  WHERE d.user_id = p_user_id AND d.usage_date = CURRENT_DATE;

  IF v_used IS NULL THEN
    v_used := 0;
  END IF;

  -- 设定限额
  IF v_plan = 'pro' THEN
    v_limit := 9999;
  ELSIF v_plan = 'plus' THEN
    v_limit := 3;
  ELSE
    v_limit := 1;
  END IF;

  RETURN QUERY SELECT v_plan, v_used, v_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
