import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import md5 from "https://esm.sh/blueimp-md5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * 爱发电 Webhook 回调处理
 * 
 * 爱发电每当有订单时会 POST JSON 到此 URL
 * 需要返回 {"ec":200} 表示成功
 */

// 根据 plan_id 确定方案类型
function getPlanType(planId: string): string | null {
  const planMap: Record<string, string> = {
    "86c452fa1bc711f1a5365254001e7c00": "plus",
    "e6afd64e1d4d11f187f452540025c377": "pro",
  };
  return planMap[planId] || null;
}

// 生成爱发电 API 签名验证 Webhook 真实性
function generateAfdianSign(token: string, params: string, ts: number, userId: string): string {
  const raw = `${token}params${params}ts${ts}user_id${userId}`;
  return md5(raw);
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Afdian webhook received:", JSON.stringify(body));

    // 验证基本格式
    if (body.ec !== 200 || !body.data) {
      console.log("Invalid webhook data, ec:", body.ec);
      return new Response(
        JSON.stringify({ ec: 200 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { type, order } = body.data;

    // 只处理订单类型
    if (type !== "order" || !order) {
      console.log("Not an order webhook, type:", type);
      return new Response(
        JSON.stringify({ ec: 200 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 只处理已支付的订单 (status=2)
    if (order.status !== 2) {
      console.log("Order not paid, status:", order.status);
      return new Response(
        JSON.stringify({ ec: 200 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 防止黑客伪造 Webhook，主动调用 API 校验该订单真实性
    const afdianToken = Deno.env.get("AFDIAN_TOKEN");
    const afdianUserId = Deno.env.get("AFDIAN_USER_ID");

    if (afdianToken && afdianUserId) {
      const ts = Math.floor(Date.now() / 1000);
      const params = JSON.stringify({ out_trade_no: order.out_trade_no });
      const sign = generateAfdianSign(afdianToken, params, ts, afdianUserId);

      const apiResponse = await fetch("https://afdian.com/api/open/query-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: afdianUserId, params, ts, sign }),
      });

      const apiResult = await apiResponse.json();
      const realOrder = apiResult?.data?.list?.[0];

      if (!realOrder || realOrder.status !== 2) {
        console.warn("Security Alert: Forged webhook rejected for out_trade_no:", order.out_trade_no);
        return new Response(JSON.stringify({ ec: 200 }), { headers: corsHeaders });
      }
    }

    // 初始化 Supabase（使用 service_role 绕过 RLS）
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 检查订单是否已处理
    const { data: existingOrder } = await supabase
      .from("afdian_orders")
      .select("id")
      .eq("out_trade_no", order.out_trade_no)
      .maybeSingle();

    if (existingOrder) {
      console.log("Order already processed:", order.out_trade_no);
      return new Response(
        JSON.stringify({ ec: 200 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 存入订单记录
    const { data: newOrder, error: insertError } = await supabase
      .from("afdian_orders")
      .insert({
        out_trade_no: order.out_trade_no,
        afdian_user_id: order.user_id,
        plan_id: order.plan_id,
        month: order.month || 1,
        total_amount: parseFloat(order.total_amount) || 0,
        status: order.status,
        raw_data: body.data,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to insert order:", insertError);
      return new Response(
        JSON.stringify({ ec: 200 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Order inserted:", newOrder.id);

    // 尝试自动匹配用户

    // 方式1：通过 afdian_user_bindings 精确匹配（复购用户）
    const { data: binding } = await supabase
      .from("afdian_user_bindings")
      .select("app_user_id")
      .eq("afdian_user_id", order.user_id)
      .maybeSingle();

    let matchedUserId: string | null = binding?.app_user_id || null;

    // 方式2：通过 subscription_intents 时间窗口匹配（首次用户）
    if (!matchedUserId) {
      const fiveMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: intent } = await supabase
        .from("subscription_intents")
        .select("id, user_id")
        .eq("plan_id", order.plan_id)
        .eq("status", "pending")
        .gte("created_at", fiveMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (intent) {
        matchedUserId = intent.user_id;

        // 标记 intent 为已匹配
        await supabase
          .from("subscription_intents")
          .update({ status: "matched", matched_order_id: newOrder.id })
          .eq("id", intent.id);

        // 创建 afdian_user_id 绑定（以后精确匹配）
        await supabase
          .from("afdian_user_bindings")
          .upsert({
            afdian_user_id: order.user_id,
            app_user_id: matchedUserId,
          });

        console.log("Matched via intent:", intent.id, "user:", matchedUserId);
      }
    }

    // 如果匹配到用户，激活订阅
    if (matchedUserId) {
      // 先查询当前的订阅状态
      const { data: currentSub } = await supabase
        .from("user_subscriptions")
        .select("expires_at")
        .eq("user_id", matchedUserId)
        .maybeSingle();
        
      // 更新订单的 matched_user_id
      await supabase
        .from("afdian_orders")
        .update({ matched_user_id: matchedUserId })
        .eq("id", newOrder.id);

      const planType = getPlanType(order.plan_id);
      if (planType) {
        // 时间累加逻辑：如果当前没过期，就在当前到期时间上加；如果过期了，就从今天开始算
        const now = new Date();
        const baseDate = (currentSub?.expires_at && new Date(currentSub.expires_at) > now) 
          ? new Date(currentSub.expires_at) 
          : now;
          
        const expiresAt = new Date(baseDate);
        expiresAt.setMonth(expiresAt.getMonth() + (order.month || 1));

        await supabase
          .from("user_subscriptions")
          .upsert({
            user_id: matchedUserId,
            plan_type: planType,
            afdian_plan_id: order.plan_id,
            expires_at: expiresAt.toISOString(),
            last_order_no: order.out_trade_no,
            updated_at: new Date().toISOString(),
          });

        console.log("Subscription activated for user:", matchedUserId, "plan:", planType);
      }
    } else {
      console.log("No user matched for order:", order.out_trade_no);
    }

    return new Response(
      JSON.stringify({ ec: 200 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    // 即使出错也返回 ec:200，避免爱发电重复推送
    return new Response(
      JSON.stringify({ ec: 200 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
