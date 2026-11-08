import { NextResponse } from 'next/server';
import { geocodeArea } from '@/lib/places';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ reply: "❌ Vercel 尚未設定 GEMINI_API_KEY 環境變數。" });
    }

    // 模型可用環境變數 GEMINI_MODEL 切換；未設定時用 gemini-3.8-flash
    // （gemini-3.7-flash 已於 2026-10-08 棄用）
    const selectedModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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

請回傳純 JSON 格式：
{
  "action": "chat" 或 "search",
  "replyText": "你的回覆內容（一次只問一個問題）...",
  "keyword": "供 Google Maps 搜尋的關鍵字（若 action 為 search 時才填寫）",
  "targetArea": "台中市西區" 或 null
}`;

    } else {
      // 階段 2：店家評估與推薦階段
      const simplifiedStores = contextStores ? contextStores.map((s: any) => ({
        id: s.id, name: s.name, address: s.address, rating: s.rating, features: s.aiSummary
      })) : [];

      systemPrompt = `你現在是 PetHub 的「專業寵物照護助理」。
服務毛孩：${petProfile?.name || '毛孩'}

【任務指令：店家評估與卡片聯動】
家長的需求已經確認。系統剛為你搜尋到以下周邊店家：
${simplifiedStores.length > 0 ? JSON.stringify(simplifiedStores, null, 2) : '無'}

1. 根據【對話歷史紀錄】中家長確認過的條件，從上方店家清單挑選最適合的推薦。
2. 嚴格剔除不符合條件的店家。
3. 【重要】你的回覆 (replyText) 必須「極度簡潔」，只要用一句話告訴家長你推薦了畫面上哪幾家店即可。絕對不要在對話中列出店家的特色、距離或營業時間！詳細原因保留給前端店家卡片展示。

請回傳純 JSON 格式：
{
  "replyText": "極度簡潔的推薦文字...",
  "recommendedStoreIds": ["符合條件的店家ID 1", "店家ID 2"]
}`;
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
      parsedResult = {
        action: 'chat',
        replyText: "AI 思考格式異常，請再試一次。",
        recommendedStoreIds: contextStores?.map((s: any) => s.id) || []
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
        targetLocation
      });
    } else {
      return NextResponse.json({
        reply: parsedResult.replyText,
        recommendedIds: parsedResult.recommendedStoreIds || []
      });
    }

  } catch (error: any) {
    return NextResponse.json({ 
      action: 'chat',
      reply: `❌ 伺服器捕捉到異常：${error?.message || '未知錯誤'}` 
    });
  }
}
