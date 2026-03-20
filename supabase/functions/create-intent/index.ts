import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * 创建订阅意向
 * 
 * 前端用户点击"订阅"时调用，记录订阅意向，返回爱发电支付链接
 */

// plan_id 映射
const PLAN_MAP: Record<string, { planId: string; planType: string }> = {
  plus: { planId: "86c452fa1bc711f1a5365254001e7c00", planType: "plus" },
  pro: { planId: "e6afd64e1d4d11f187f452540025c377", planType: "pro" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 验证用户身份
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

    // 获取当前用户
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

    // 解析请求
    const { planType } = await req.json();
    const planInfo = PLAN_MAP[planType];
    if (!planInfo) {
      return new Response(
        JSON.stringify({ error: "Invalid plan type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 把该用户之前的 pending intent 过期掉（避免堆积）
    await supabaseAdmin
      .from("subscription_intents")
      .update({ status: "expired" })
      .eq("user_id", user.id)
      .eq("status", "pending");

    // 创建新的 intent
    const { data: intent, error: insertError } = await supabaseAdmin
      .from("subscription_intents")
      .insert({
        user_id: user.id,
        plan_id: planInfo.planId,
        plan_type: planInfo.planType,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to create intent:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create intent" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 返回爱发电支付链接
    const payUrl = `https://afdian.com/order/create?plan_id=${planInfo.planId}`;

    return new Response(
      JSON.stringify({
        success: true,
        intentId: intent.id,
        payUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Create intent error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
