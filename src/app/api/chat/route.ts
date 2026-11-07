import { NextResponse } from 'next/server';
import { geocodeArea, PLACE_ID_PATTERN } from '@/lib/places';
import { evaluateWithMapsGrounding, type Candidate, type Requirement } from '@/lib/grounding';

// AI 評估時最多送幾家候選店家給 Google 地圖工具
const MAX_EVAL_CANDIDATES = 5;

// 需求清單由第一階段（只看對話、不接觸任何 Google 地圖內容）產生，
// 第二階段只能照這份清單判斷，評論內容無法改寫需求。
function sanitizeRequirements(list: unknown): Requirement[] {
  return (Array.isArray(list) ? list : [])
    .filter((r: any) => typeof r?.label === 'string' && r.label.trim())
    .map((r: any) => ({ label: r.label.trim().slice(0, 16), isEssential: r.isEssential === true }))
    .filter((r, i, arr) => arr.findIndex((x) => x.label === r.label) === i)
    .slice(0, 4);
}

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ reply: "❌ Vercel 尚未設定 GEMINI_API_KEY 環境變數。" });
    }

    const selectedModel = 'gemini-3.7-flash';
    const body = await req.json();
    const { prompt, petProfile, contextStores, history, isEvaluationPhase } = body;

    const historyText = history && history.length > 0 
      ? history.map((m: any) => `${m.role === 'model' ? 'AI助理' : '家長'}：${m.content}`).join('\n')
      : '無';

    let systemPrompt = '';
    
    if (!isEvaluationPhase) {
      // 階段 1：需求釐清階段
      systemPrompt = `你現在是 PetHub 的「專業寵物照護助理」。
服務毛孩：${petProfile?.name || '毛孩'} (${petProfile?.type === 'dog' ? '狗狗' : '貓咪'})
品種：${petProfile?.breed || '未填寫'}
特別註記：${petProfile?.notes || '無'}

【任務指令：需求釐清】
家長正在尋找服務。請參考【對話歷史紀錄】，判斷家長的需求是否已經夠明確。
例如找「住宿」時，必須確認：
1. 是毛孩單獨住的寄宿，還是人寵同住的友善飯店？
2. 地點要在附近，還是指定其他縣市？

【極重要規則】
* 若資訊【不足】，請親切提問。⚠️【一次只能問 1 個問題】，絕對不要同時問兩個重點！
* 若資訊【充足】，請將 action 設為 "search"，並給予精準 keyword（例如「台中市西區 寵物友善餐廳」）。
* 【跨區搜尋】：若家長有明確指定「其他縣市/地區」（例如：台中、信義區），請在 targetArea 填入完整地名（例如「台中市西區」、「台北市信義區」），系統會自行查詢座標，你不需要提供經緯度。如果沒指定地區或是說「附近」，targetArea 請設為 null。
* 【需求清單】：action 為 "search" 時，從對話整理 requirements（最多 4 項，每項 2 到 8 個字，例如「不關籠」「可攜寵用餐」「接受大型犬」）。家長明確要求的標 isEssential: true；毛孩特別註記中和這次服務有關的可列入並標 false。地點、服務類型本身已經用在搜尋，不要列入。

請回傳純 JSON 格式：
{
  "action": "chat" 或 "search",
  "replyText": "你的回覆內容（一次只問一個問題）...",
  "keyword": "供 Google Maps 搜尋的關鍵字（若 action 為 search 時才填寫）",
  "targetArea": "台中市西區" 或 null,
  "requirements": [{ "label": "不關籠", "isEssential": true }]
}`;

    } else {
      // 階段 2：用 Gemini 的 Google 地圖工具（Grounding with Google Maps）評估候選店家
      const candidates: Candidate[] = (Array.isArray(contextStores) ? contextStores : [])
        .filter((c: any) => typeof c?.id === 'string' && PLACE_ID_PATTERN.test(c.id)
          && Number.isFinite(c?.lat) && Number.isFinite(c?.lng))
        .slice(0, MAX_EVAL_CANDIDATES)
        .map((c: any) => ({
          id: c.id,
          name: String(c.name || '').slice(0, 80),
          address: String(c.address || '').slice(0, 120),
          lat: c.lat,
          lng: c.lng,
        }));
      const requirements = sanitizeRequirements(body.requirements);

      if (candidates.length === 0) {
        return NextResponse.json({ reply: '抱歉，附近沒有可以評估的店家。', recommendedIds: [], evaluations: {} });
      }

      let result;
      try {
        result = await evaluateWithMapsGrounding({ apiKey, model: selectedModel, candidates, requirements, pet: petProfile || {} });
      } catch (err: any) {
        console.error('[api/chat] Maps grounding 失敗', err?.message);
        return NextResponse.json({
          reply: '抱歉，目前無法查詢店家的 Google 地圖資料，先為您列出距離最近的店家。',
          recommendedIds: [],
          evaluations: {},
        });
      }

      // 回覆由伺服器組成，不直接採用模型的文字，避免被評論內容誘導出不當訊息
      const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name || '';
      const { evaluations, recommendedIds } = result;
      let reply: string;
      if (recommendedIds.length > 0) {
        const hasUnknownEssential = recommendedIds.some((id) =>
          evaluations[id].requirements.some((r) => r.isEssential && r.status === 'unknown'));
        reply = `依 Google 地圖上的資料，為您推薦 ${recommendedIds.map(nameOf).join('、')}。`
          + (hasUnknownEssential ? '部分條件在 Google 地圖資料中查不到，出發前建議先向店家確認。' : '');
      } else {
        reply = '依 Google 地圖上的資料，附近沒有找到明確符合條件的店家。可以換個條件或地區再試試看。';
      }
      return NextResponse.json({ reply, recommendedIds, evaluations });
    }

    const finalPrompt = `${systemPrompt}\n\n【對話歷史紀錄】\n${historyText}\n\n【家長最新訊息】\n${prompt}`;

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
    const genRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          responseMimeType: "application/json",
        },
        contents: [
          {
            parts: [{ text: finalPrompt }],
          },
        ],
      }),
    });

    const genData = await genRes.json();

    if (!genRes.ok) {
      return NextResponse.json({ 
        action: 'chat',
        reply: `❌ 模型 [${selectedModel}] 生成失敗：${genData.error?.message || '未知錯誤'}` 
      });
    }

    const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let parsedResult;
    try {
      parsedResult = JSON.parse(rawText);
    } catch (e) {
      // 格式異常時不推薦任何店家，避免把未評估的店當成推薦
      parsedResult = {
        action: 'chat',
        replyText: "AI 思考格式異常，請再試一次。",
        recommendedStoreIds: []
      };
    }

    if (!isEvaluationPhase) {
      // 指定地區時由 Google 查出真實座標，不採用模型憑記憶給的經緯度。
      const targetArea = typeof parsedResult.targetArea === 'string' ? parsedResult.targetArea.trim() : '';
      let targetLocation: { lat: number; lng: number } | null = null;

      if (parsedResult.action === 'search' && targetArea) {
        const resolved = await geocodeArea(targetArea);
        if (!resolved) {
          // 家長明確指定了地區卻查不到位置：不要默默改搜目前位置（會出現錯誤城市的店家），
          // 改成請家長把地區說得更明確。
          return NextResponse.json({
            action: 'chat',
            reply: `抱歉，我在地圖上找不到「${targetArea}」這個地方。可以告訴我更完整的地名嗎？例如「台中市西區」或「高雄市左營區」。`,
            keyword: '',
            targetLocation: null
          });
        }
        targetLocation = { lat: resolved.lat, lng: resolved.lng };
      }

      return NextResponse.json({
        action: parsedResult.action || 'chat',
        reply: parsedResult.replyText,
        keyword: parsedResult.keyword || '',
        targetLocation,
        requirements: parsedResult.action === 'search' ? sanitizeRequirements(parsedResult.requirements) : []
      });
    }

  } catch (error: any) {
    return NextResponse.json({ 
      action: 'chat',
      reply: `❌ 伺服器捕捉到異常：${error?.message || '未知錯誤'}` 
    });
  }
}
