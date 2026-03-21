import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import md5 from "https://esm.sh/blueimp-md5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * 验证订阅状态
 * 
 * 用户点击"我已付款"后调用
 * 1. 先在本地 DB 尝试匹配 intent + order
 * 2. 如果没匹配到，调用爱发电 API 查询最近订单补充数据
 * 3. 返回当前订阅状态
 */

// plan_id → plan_type
function getPlanType(planId: string): string | null {
  const planMap: Record<string, string> = {
    "86c452fa1bc711f1a5365254001e7c00": "plus",
    "e6afd64e1d4d11f187f452540025c377": "pro",
  };
  return planMap[planId] || null;
}

// 生成爱发电 API 签名
function generateAfdianSign(token: string, params: string, ts: number, userId: string): string {
  // sign = md5(token + "params" + paramsJson + "ts" + timestamp + "user_id" + userId)
  const raw = `${token}params${params}ts${ts}user_id${userId}`;
  return md5(raw);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 验证用户
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid user" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 查找用户最近的 pending intent
    const { data: pendingIntent } = await supabaseAdmin
      .from("subscription_intents")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let matched = false;

    if (pendingIntent) {
      // 尝试在 afdian_orders 中寻找匹配的订单
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      // 先通过 afdian_user_bindings 精确匹配
      const { data: binding } = await supabaseAdmin
        .from("afdian_user_bindings")
        .select("afdian_user_id")
        .eq("app_user_id", user.id)
        .single();

      let matchQuery = supabaseAdmin
        .from("afdian_orders")
        .select("*")
        .eq("plan_id", pendingIntent.plan_id)
        .eq("status", 2)
        .is("matched_user_id", null)
        .gte("created_at", thirtyMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(1);

      // 如果有绑定，优先按 afdian_user_id 匹配
      if (binding) {
        matchQuery = matchQuery.eq("afdian_user_id", binding.afdian_user_id);
      }

      const { data: matchedOrder } = await matchQuery.single();

      if (matchedOrder) {
        // 匹配成功！
        matched = true;

        // 更新 intent
        await supabaseAdmin
          .from("subscription_intents")
          .update({ status: "matched", matched_order_id: matchedOrder.id })
          .eq("id", pendingIntent.id);

        // 更新 order
        await supabaseAdmin
          .from("afdian_orders")
          .update({ matched_user_id: user.id })
          .eq("id", matchedOrder.id);

        // 创建/更新绑定
        await supabaseAdmin
          .from("afdian_user_bindings")
          .upsert({
            afdian_user_id: matchedOrder.afdian_user_id,
            app_user_id: user.id,
          });

        // 获取当前订阅
        const { data: currentSub } = await supabaseAdmin
          .from("user_subscriptions")
          .select("expires_at")
          .eq("user_id", user.id)
          .single();

        // 激活订阅
        const planType = getPlanType(matchedOrder.plan_id);
        if (planType) {
          const now = new Date();
          const baseDate = (currentSub?.expires_at && new Date(currentSub.expires_at) > now) 
            ? new Date(currentSub.expires_at) 
            : now;
            
          const expiresAt = new Date(baseDate);
          expiresAt.setMonth(expiresAt.getMonth() + (matchedOrder.month || 1));

          await supabaseAdmin
            .from("user_subscriptions")
            .upsert({
              user_id: user.id,
              plan_type: planType,
              afdian_plan_id: matchedOrder.plan_id,
              expires_at: expiresAt.toISOString(),
              last_order_no: matchedOrder.out_trade_no,
              updated_at: new Date().toISOString(),
            });
        }

        console.log("Verified and activated subscription for user:", user.id);
      }
    }

    // 如果本地没匹配到，尝试调用爱发电 API 查询
    if (!matched) {
      const afdianToken = Deno.env.get("AFDIAN_TOKEN");
      const afdianUserId = Deno.env.get("AFDIAN_USER_ID");

      if (afdianToken && afdianUserId) {
        try {
          const ts = Math.floor(Date.now() / 1000);
          const params = JSON.stringify({ page: 1 });
          const sign = generateAfdianSign(afdianToken, params, ts, afdianUserId);

          const apiResponse = await fetch("https://afdian.com/api/open/query-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: afdianUserId,
              params,
              ts,
              sign,
            }),
          });

          const apiResult = await apiResponse.json();
          console.log("Afdian API response:", JSON.stringify(apiResult));

          if (apiResult.ec === 200 && apiResult.data?.list) {
            // 把 API 返回的订单同步到本地
            for (const order of apiResult.data.list) {
              if (order.status !== 2) continue;

              // upsert 订单
              await supabaseAdmin
                .from("afdian_orders")
                .upsert(
                  {
                    out_trade_no: order.out_trade_no,
                    afdian_user_id: order.user_id,
                    plan_id: order.plan_id,
                    month: order.month || 1,
                    total_amount: parseFloat(order.total_amount) || 0,
                    status: order.status,
                    raw_data: order,
                  },
                  { onConflict: "out_trade_no" }
                );
            }

            // 再次尝试匹配
            if (pendingIntent) {
              const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

              const { data: retryOrder } = await supabaseAdmin
                .from("afdian_orders")
                .select("*")
                .eq("plan_id", pendingIntent.plan_id)
                .eq("status", 2)
                .is("matched_user_id", null)
                .gte("created_at", thirtyMinutesAgo)
                .order("created_at", { ascending: false })
                .limit(1)
                .single();

              if (retryOrder) {
                matched = true;

                await supabaseAdmin
                  .from("subscription_intents")
                  .update({ status: "matched", matched_order_id: retryOrder.id })
                  .eq("id", pendingIntent.id);

                await supabaseAdmin
                  .from("afdian_orders")
                  .update({ matched_user_id: user.id })
                  .eq("id", retryOrder.id);

                await supabaseAdmin
                  .from("afdian_user_bindings")
                  .upsert({
                    afdian_user_id: retryOrder.afdian_user_id,
                    app_user_id: user.id,
                  });

                const planType = getPlanType(retryOrder.plan_id);
                if (planType) {
                  const { data: currentSub } = await supabaseAdmin
                    .from("user_subscriptions")
                    .select("expires_at")
                    .eq("user_id", user.id)
                    .single();
                    
                  const now = new Date();
                  const baseDate = (currentSub?.expires_at && new Date(currentSub.expires_at) > now) 
                    ? new Date(currentSub.expires_at) 
                    : now;
                    
                  const expiresAt = new Date(baseDate);
                  expiresAt.setMonth(expiresAt.getMonth() + (retryOrder.month || 1));

                  await supabaseAdmin
                    .from("user_subscriptions")
                    .upsert({
                      user_id: user.id,
                      plan_type: planType,
                      afdian_plan_id: retryOrder.plan_id,
                      expires_at: expiresAt.toISOString(),
                      last_order_no: retryOrder.out_trade_no,
                      updated_at: new Date().toISOString(),
                    });
                }

                console.log("Verified via API and activated for user:", user.id);
              }
            }
          }
        } catch (apiError) {
          console.error("Afdian API error:", apiError);
        }
      }
    }

    // 返回当前订阅状态
    const { data: subscription } = await supabaseAdmin
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    return new Response(
      JSON.stringify({
        matched,
        subscription: subscription || { plan_type: "free" },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Verify error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
