// Supabase Edge Function: tarot-interpret
// 代理调用硅基流动 AI API，保护 API Key 不暴露给前端

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 从 Supabase Secrets 获取 API Key
const SILICONFLOW_API_KEY = Deno.env.get('SILICONFLOW_API_KEY') || ''
const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions'

// 按订阅等级选择模型
const PLAN_MODEL_MAP: Record<string, string> = {
  free: 'Qwen/Qwen3-8B',
  plus: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  pro: 'deepseek-ai/DeepSeek-V3',
}
const DEFAULT_MODEL = 'Qwen/Qwen3-8B'

const SYSTEM_PROMPT = `你是一位经验丰富、洞察人心的塔罗占卜师。你不做绝对判断，也不预测具体事件的发生时间，而是通过牌的象征意义，引导提问者理解当下的状态、内在的情绪，以及可能的发展方向。

你的语言应当：
- 温和、神秘、富有象征意味
- 像是在解读命运的暗示，而不是给出理性分析报告
- 让人感到被理解、被看见，而不是被说教

解牌时请遵循以下原则：
1. 先描述牌面所代表的核心能量与情绪状态
2. 再结合提问者的处境，解释这张牌在当前问题中的含义
3. 给出启示性的建议，而不是具体行动指令
4. 避免使用"一定""必然""绝对"等确定性词语
5. 不否定提问者的感受，不制造恐惧或焦虑

你的目标不是"算准"，而是让提问者在阅读解牌后：
- 感到内心被安抚
- 对当下有新的理解
- 对未来保持开放与希望

请始终保持塔罗占卜师的身份，不要提及自己是 AI，也不要解释模型或算法。

重要规则：
- 你只负责解读牌面，不要在回复末尾向用户提出任何问题或追问。
- 不要使用"你愿意分享一下..."、"你觉得..."、"你是否..."等引导用户回答的句式。
- 解读结束后给出总结和建议即可，不要留下话题的钩子。`

interface TarotCard {
  name: string
  nameEn: string
  desc: string
  descEn: string
  isUpright: boolean
}

interface RequestBody {
  spreadId: string
  spreadName: string
  question: string
  cards: TarotCard[]
  positions: string[]
  lang: 'zh' | 'en'
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 验证用户身份
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 验证 Supabase JWT token
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 解析请求体
    const { spreadId, spreadName, question, cards, positions, lang = 'zh' }: RequestBody = await req.json()

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No cards provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 获取用户订阅状态来决定模型
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    let planType = 'free'
    try {
      const { data: sub } = await supabaseAdmin
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (sub && sub.expires_at && new Date(sub.expires_at) > new Date()) {
        planType = sub.plan_type || 'free'
      }
    } catch (e) {
      console.warn('Failed to fetch subscription, defaulting to free', e)
    }

    const modelName = PLAN_MODEL_MAP[planType] || DEFAULT_MODEL
    console.log(`User ${user.id} has plan ${planType}, using model: ${modelName} for spread: ${spreadId}`)

    // 构建 prompt
    let prompt = `请为用户解读以下牌阵。\n\n`
    prompt += `语言要求: ${lang === 'zh' ? '中文(简体)' : 'English'}。你必须用${lang === 'zh' ? '中文' : '英文'}回复。\n`
    prompt += `牌阵类型: ${spreadName}\n`
    prompt += `用户问题: ${question}\n\n`
    prompt += `抽取的牌：\n`

    cards.forEach((card, index) => {
      prompt += `${index + 1}. 位置: ${positions[index] || '通用'} - 牌: ${card.name} (${card.isUpright ? '正位' : '逆位'})\n`
      prompt += `   含义: ${card.desc}\n`
    })

    prompt += `\n请提供一个全面、富有同理心和神秘感的解读。重点关注牌与用户问题的联系。`
    prompt += `清晰地组织回复，为每个牌位提供解释，最后给出综合建议。`
    prompt += `\n\n格式要求：不要使用 Markdown 语法（不要用 * # ** 等符号），直接用纯文本分段即可。`
    prompt += `\n\n严禁在回复末尾向用户提问或追问。直接给出解读和建议即可。`

    // 调用硅基流动 API
    const aiResponse = await fetch(SILICONFLOW_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 2000
      })
    })

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => ({}))
      console.error('AI API Error:', aiResponse.status, errorData)
      return new Response(
        JSON.stringify({ error: 'AI service error', details: errorData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiData = await aiResponse.json()
    
    if (aiData.choices && aiData.choices[0] && aiData.choices[0].message) {
      return new Response(
        JSON.stringify({ interpretation: aiData.choices[0].message.content }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'No content in AI response' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
